import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type {
  Repository,
  RepositoryAuth,
  Filesystem,
} from "../domain/resource.ts";
import {
  WorkspacePreparationError,
  FetchError,
  DivergenceError,
} from "./port.ts";
import type { Workspace, WorkspaceManager, CachedModePolicy } from "./port.ts";

const execFile = promisify(execFileCb);

const GIT_CONFIG = [
  "-c",
  "credential.helper=",
  "-c",
  "user.name=kanthord",
  "-c",
  "user.email=kanthord@localhost",
];

/** Keys stripped from every child git process env to prevent credential leakage via traces. */
const GIT_STRIP_KEYS = [
  "GIT_TRACE",
  "GIT_TRACE_CURL",
  "GIT_TRACE_PACK_ACCESS",
  "GIT_TRACE_PERFORMANCE",
  "GIT_TRACE_SETUP",
  "GIT_CURL_VERBOSE",
];

interface LocalWorkspaceManagerOptions {
  root: string;
  /**
   * @deprecated Unused — `LocalWorkspaceManager` reads `repo.remoteUrl` directly.
   * Kept in the type to avoid breaking pre-existing callers until the TE migrates them.
   */
  buildRemoteUrl?: (repo: Repository, name: string) => string;
  resolveCredential?: (credentialId: string) => Promise<string>;
  /** Directory for per-repo+branch exclusive lock files. When set, enables fetch+CAS before workspace clone. */
  lockDir?: string;
  /** Resolve a cached policy for a repo (used when fetch fails or divergence detected). */
  getCachedPolicy?: (repoId: string) => Promise<CachedModePolicy | undefined>;
  /** Persist a cached policy after a successful fetch (optional — callers may omit). */
  saveCachedPolicy?: (policy: CachedModePolicy) => Promise<void>;
}

/**
 * Build a sanitised env for every child git process:
 * - Strip all GIT_TRACE* and GIT_CURL_VERBOSE keys.
 * - Always set GIT_TERMINAL_PROMPT=0.
 * - For https-token auth: resolve the credential, write the token to a chmod-600
 *   temp file, create a static askpass script, and set GIT_ASKPASS.
 */
interface GitEnv {
  env: Record<string, string>;
  /** Delete both temp files (token + askpass). Idempotent; never throws. */
  cleanup: () => void;
}

async function buildGitEnv(
  auth: RepositoryAuth,
  resolveCredential?: (credentialId: string) => Promise<string>,
): Promise<GitEnv> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  for (const key of GIT_STRIP_KEYS) {
    delete env[key];
  }
  env["GIT_TERMINAL_PROMPT"] = "0";

  if (auth.kind === "https-token" && resolveCredential) {
    const token = await resolveCredential(auth.credentialId);
    const id = randomBytes(4).toString("hex");
    const tokenFile = join(tmpdir(), `kanthord-${id}.token`);
    const askpassFile = join(tmpdir(), `kanthord-${id}.askpass.sh`);

    try {
      await writeFile(tokenFile, token, { encoding: "utf8" });
      await chmod(tokenFile, 0o600);
      // Static one-liner: echoes the token file content regardless of the prompt string.
      await writeFile(askpassFile, `#!/bin/sh\ncat "${tokenFile}"\n`, {
        encoding: "utf8",
      });
      await chmod(askpassFile, 0o700);
    } catch (err) {
      // Partial-write guard: if any step fails, delete both temp files before
      // re-throwing so no secret credential file outlives a failed buildGitEnv.
      rmSync(tokenFile, { force: true });
      rmSync(askpassFile, { force: true });
      throw err;
    }

    env["GIT_ASKPASS"] = askpassFile;

    const cleanup = (): void => {
      rmSync(tokenFile, { force: true });
      rmSync(askpassFile, { force: true });
    };
    return { env, cleanup };
  }

  return { env, cleanup: () => {} };
}

/**
 * Classifies `p` via `lstat` (never `access`, which follows symlinks and
 * would misread a broken symlink as absent): `absent` (ENOENT),
 * `broken-symlink` (a symlink whose target does not resolve), `directory` (a
 * real directory, or a symlink that resolves to one), `file` (anything else).
 */
async function inspectPath(
  p: string,
): Promise<"absent" | "directory" | "file" | "broken-symlink"> {
  let entry;
  try {
    entry = await lstat(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw err;
  }
  if (entry.isSymbolicLink()) {
    try {
      const target = await stat(p);
      return target.isDirectory() ? "directory" : "file";
    } catch {
      return "broken-symlink";
    }
  }
  return entry.isDirectory() ? "directory" : "file";
}

type CheckoutInspection =
  | { kind: "root-checkout" }
  | { kind: "enclosing-checkout"; toplevel: string }
  | { kind: "bare" }
  | { kind: "not-a-repo" }
  | { kind: "git-error"; cause: unknown };

/**
 * Inspects `dir` (already confirmed to be a directory) against git's own view
 * — this replaces the old boolean `isGitRepo()` (`git rev-parse --git-dir`),
 * which succeeds from ANY dir nested inside a worktree and so misreads the
 * ENCLOSING repo as "home exists". Discriminates a genuine root checkout from
 * that enclosing-checkout bug case, a bare repo, no repo at all, or an
 * indeterminate git/spawn failure — never masked as one of the others.
 * Symlink-acceptance policy: `dir` itself may be a symlink to the checkout
 * root and still classify as `root-checkout`, because both sides of the
 * comparison are passed through `realpath`.
 */
async function inspectCheckout(
  dir: string,
  env?: Record<string, string>,
): Promise<CheckoutInspection> {
  let bareOut: string;
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "--is-bare-repository"],
      { cwd: dir, env },
    );
    bareOut = stdout.trim();
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? err);
    if (/not a git repository/i.test(stderr)) {
      return { kind: "not-a-repo" };
    }
    return { kind: "git-error", cause: err };
  }

  if (bareOut === "true") {
    return { kind: "bare" };
  }

  let toplevelOut: string;
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      env,
    });
    toplevelOut = stdout.trim();
  } catch (err) {
    return { kind: "git-error", cause: err };
  }

  const [resolvedToplevel, resolvedDir] = await Promise.all([
    realpath(toplevelOut),
    realpath(dir),
  ]);

  return resolvedToplevel === resolvedDir
    ? { kind: "root-checkout" }
    : { kind: "enclosing-checkout", toplevel: resolvedToplevel };
}

/** Clone `remoteUrl` as a BARE repo into a temp dir beside `homePath`, then
 * rename atomically onto `homePath` — works whether `homePath` is absent or an
 * already-existing empty directory (POSIX `rename` onto an empty dir target
 * replaces it). Configures `remote.origin.fetch` to the standard non-bare
 * refspec so `refs/remotes/origin/*` tracks remote heads, keeping
 * `refs/heads/*` only for the local branch state managed by the fetch+CAS
 * logic. */
async function cloneIntoHome(
  remoteUrl: string,
  homePath: string,
  env: Record<string, string> | undefined,
): Promise<void> {
  const tmpSuffix = randomBytes(4).toString("hex");
  const tmpPath = `${homePath}.tmp-${tmpSuffix}`;
  try {
    await execFile(
      "git",
      [...GIT_CONFIG, "clone", "--bare", remoteUrl, tmpPath],
      { env },
    );
    // Configure fetch refspec so remotes track to refs/remotes/origin/*.
    await execFile(
      "git",
      ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
      { cwd: tmpPath, env },
    );
    // Fetch to populate refs/remotes/origin/ under the new refspec.
    await execFile("git", ["fetch", "origin"], { cwd: tmpPath, env });
    await rename(tmpPath, homePath);
  } catch (err) {
    try {
      await execFile("rm", ["-rf", tmpPath]);
    } catch {
      // ignore cleanup errors
    }
    throw new WorkspacePreparationError(
      `Failed to clone ${remoteUrl} to ${homePath}: ${String(err)}`,
    );
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function getRemoteUrl(
  dir: string,
  env?: Record<string, string>,
): Promise<string> {
  const { stdout } = await execFile("git", ["remote", "get-url", "origin"], {
    cwd: dir,
    env,
  });
  return stdout.trim();
}

/**
 * Returns true if `sha` is an ancestor-or-equal of `ref` in the repo at `cwd`.
 * Both `sha` and `ref` must be commit SHAs or refs resolvable in `cwd`.
 */
async function isGitAncestor(
  cwd: string,
  sha: string,
  ref: string,
  env?: Record<string, string>,
): Promise<boolean> {
  try {
    await execFile("git", ["merge-base", "--is-ancestor", sha, ref], {
      cwd,
      env,
    });
    return true;
  } catch {
    return false;
  }
}

/** Acquire an exclusive lock file with exponential backoff (up to maxWaitMs). */
async function acquireLock(
  lockPath: string,
  maxWaitMs = 30_000,
): Promise<FileHandle> {
  const start = Date.now();
  let delay = 50;
  for (;;) {
    try {
      return await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;
      if (Date.now() - start >= maxWaitMs) {
        throw new Error(
          `LocalWorkspaceManager: could not acquire lock at ${lockPath} after ${maxWaitMs} ms`,
        );
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, delay + Math.floor(Math.random() * 50)),
      );
      delay = Math.min(Math.floor(delay * 1.5), 2_000);
    }
  }
}

/**
 * The managed home (`repository.path`) is a **bare, kanthord-owned cache** —
 * never a developer checkout (EPIC 007.11). It holds only git objects and refs;
 * kanthord provisions it with `git clone --bare` and keeps `refs/heads/*` in
 * sync with the remote via fetch + CAS `update-ref`. There is no working tree,
 * so it cannot drift out of sync. Read landed work by cloning fresh or with
 * `git show <ref>:<path>`. A non-bare home is refused, not silently converted:
 * remove it and let kanthord recreate it as a bare clone. Per-task workspaces
 * are separate non-bare clones taken from this bare home.
 */
export class LocalWorkspaceManager implements WorkspaceManager {
  private readonly root: string;
  private readonly resolveCredential?: (
    credentialId: string,
  ) => Promise<string>;
  private readonly lockDir?: string;
  private readonly getCachedPolicy?: (
    repoId: string,
  ) => Promise<CachedModePolicy | undefined>;
  private readonly saveCachedPolicy?: (
    policy: CachedModePolicy,
  ) => Promise<void>;
  /** repoId → canonical local mirror path, populated during prepare(). */
  readonly #homes = new Map<string, string>();

  constructor(opts: LocalWorkspaceManagerOptions) {
    this.root = resolve(opts.root);
    this.resolveCredential = opts.resolveCredential;
    this.lockDir = opts.lockDir;
    this.getCachedPolicy = opts.getCachedPolicy;
    this.saveCachedPolicy = opts.saveCachedPolicy;
  }

  /**
   * Returns the canonical local mirror path the manager cloned a repository's
   * `remoteUrl` into (the repository's configured `path`), stable for a given
   * `repoId`. Distinct from any per-task workspace dir built as
   * `join(root, <taskId>)`. Populated by `prepare()` from a repository source.
   */
  homeDir(repoId: string): string {
    return this.#homes.get(repoId) ?? "";
  }

  async prepare(
    taskId: string,
    source: Repository | Filesystem,
  ): Promise<Workspace> {
    if (source.type === "filesystem") {
      return this.prepareFromFilesystem(taskId, source);
    }
    return this.prepareFromRepository(taskId, source);
  }

  private async prepareFromFilesystem(
    taskId: string,
    source: Filesystem,
  ): Promise<Workspace> {
    const { env, cleanup } = await buildGitEnv({ kind: "ambient" });
    try {
      if (!(await pathExists(source.path))) {
        throw new WorkspacePreparationError(
          `Filesystem source path does not exist: ${source.path}`,
        );
      }

      const wsDir = join(this.root, taskId);

      // Wipe existing workspace if present (wipe-on-retry)
      if (await pathExists(wsDir)) {
        await rm(wsDir, { recursive: true, force: true });
      }

      // Copy source files into workspace dir
      await cp(source.path, wsDir, { recursive: true });

      // Init a git repo, commit all files
      await execFile("git", ["init"], { cwd: wsDir, env });
      await execFile("git", [...GIT_CONFIG, "add", "-A"], { cwd: wsDir, env });
      await execFile(
        "git",
        [...GIT_CONFIG, "commit", "-m", "initial workspace snapshot"],
        { cwd: wsDir, env },
      );

      // Get the initial commit sha (baseCommit)
      const { stdout: commitOut } = await execFile(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: wsDir, env },
      );
      const baseCommit = commitOut.trim();

      // Create and switch to the kanthord/<taskId> branch
      const kanthordBranch = `kanthord/${taskId}`;
      await execFile("git", [...GIT_CONFIG, "switch", "-c", kanthordBranch], {
        cwd: wsDir,
        env,
      });

      return { dir: wsDir, branch: kanthordBranch, baseCommit };
    } finally {
      cleanup();
    }
  }

  private async prepareFromRepository(
    taskId: string,
    repo: Repository,
  ): Promise<Workspace> {
    const { env, cleanup } = await buildGitEnv(
      repo.auth,
      this.resolveCredential,
    );
    try {
      const remoteUrl = repo.remoteUrl;
      const homePath = repo.path;
      const branch = repo.branch;
      // Record the canonical mirror path so homeDir(repoId) resolves it later.
      this.#homes.set(repo.id, homePath);

      // Acquire per-repo+branch lock when lockDir is configured
      let lockFh: FileHandle | undefined;
      let lockPath: string | undefined;
      if (this.lockDir) {
        lockPath = join(this.lockDir, `${repo.id}-${branch}.lock`);
        lockFh = await acquireLock(lockPath);
      }

      try {
        // canonicalSHA is the resolved SHA to use as workspace baseCommit.
        // Only set when lockDir is active (fetch+CAS logic runs).
        let canonicalSHA: string | undefined;

        // Classify homePath before any clone action (lstat, never access, so
        // a broken symlink is never misread as absent).
        const pathState = await inspectPath(homePath);

        if (pathState === "broken-symlink") {
          throw new WorkspacePreparationError(
            `Home path ${homePath} is a broken symlink (its target does not exist)`,
          );
        }
        if (pathState === "file") {
          throw new WorkspacePreparationError(
            `Home path ${homePath} exists and is not a directory`,
          );
        }

        let clonedFresh = false;

        if (pathState === "absent") {
          await cloneIntoHome(remoteUrl, homePath, env);
          clonedFresh = true;
        } else {
          // Inspect the checkout ROOT, not just "is it inside a repo" —
          // `git rev-parse --git-dir` succeeds from any dir nested inside a
          // worktree and would misread the ENCLOSING repo as "home exists".
          const inspection = await inspectCheckout(homePath, env);

          if (inspection.kind === "git-error") {
            throw new WorkspacePreparationError(
              `Home path ${homePath}: git inspection failed: ${String(inspection.cause)}`,
            );
          }
          if (inspection.kind === "bare") {
            // Bare home — validate origin URL matches expected remoteUrl.
            let actualUrl: string;
            try {
              actualUrl = await getRemoteUrl(homePath, env);
            } catch {
              throw new WorkspacePreparationError(
                `Home path ${homePath} has no remote named origin`,
              );
            }
            if (actualUrl !== remoteUrl) {
              throw new WorkspacePreparationError(
                `Home path ${homePath} has origin ${actualUrl} but expected ${remoteUrl}`,
              );
            }
            // Falls through to the shared fetch/CAS block below.
          } else if (inspection.kind !== "root-checkout") {
            // not-a-repo or enclosing-checkout: only safe to clone fresh when
            // the dir is confirmed empty (zero entries, hidden files count) —
            // otherwise report the real problem instead of masking it as a
            // wrong-origin mismatch.
            const entries = await readdir(homePath);
            if (entries.length === 0) {
              await cloneIntoHome(remoteUrl, homePath, env);
              clonedFresh = true;
            } else if (inspection.kind === "enclosing-checkout") {
              throw new WorkspacePreparationError(
                `Home path ${homePath} is not a git checkout of ${remoteUrl}; it is nested inside ${inspection.toplevel}`,
              );
            } else {
              throw new WorkspacePreparationError(
                `Home path ${homePath} exists and is not empty`,
              );
            }
          } else {
            // root-checkout (non-bare) — always refused per migration policy
            throw new WorkspacePreparationError(
              `Home path ${homePath} is a non-bare git checkout; kanthord requires a bare repository. Remove the directory and let kanthord recreate it as a bare clone.`,
            );
          }
        }

        if (clonedFresh) {
          // After a fresh clone, canonical SHA is the local branch HEAD
          if (this.lockDir) {
            const { stdout } = await execFile(
              "git",
              ["rev-parse", `refs/heads/${branch}`],
              { cwd: homePath, env },
            );
            canonicalSHA = stdout.trim();
          }
        } else {
          // Fetch + CAS when lockDir is configured (root-checkout or bare home)
          if (this.lockDir) {
            let fetchSucceeded = true;
            let fetchErr: unknown;
            try {
              await execFile("git", ["fetch", "origin"], {
                cwd: homePath,
                env,
              });
            } catch (err) {
              fetchSucceeded = false;
              fetchErr = err;
            }

            if (!fetchSucceeded) {
              // Fetch failed — fall back to cached policy or error
              const policy = this.getCachedPolicy
                ? await this.getCachedPolicy(repo.id)
                : undefined;
              if (!policy) throw new FetchError(repo.id, fetchErr);
              canonicalSHA = policy.baseSHA;
            } else {
              // Fetch succeeded — resolve local vs origin SHAs
              const { stdout: localOut } = await execFile(
                "git",
                ["rev-parse", `refs/heads/${branch}`],
                { cwd: homePath, env },
              );
              const localSHA = localOut.trim();

              const { stdout: originOut } = await execFile(
                "git",
                ["rev-parse", `refs/remotes/origin/${branch}`],
                { cwd: homePath, env },
              );
              const originSHA = originOut.trim();

              if (localSHA === originSHA) {
                // In sync
                canonicalSHA = localSHA;
              } else if (
                await isGitAncestor(homePath, localSHA, originSHA, env)
              ) {
                // Local is behind origin → fast-forward advance local branch
                await execFile(
                  "git",
                  ["update-ref", `refs/heads/${branch}`, originSHA],
                  { cwd: homePath, env },
                );
                canonicalSHA = originSHA;
              } else if (
                await isGitAncestor(homePath, originSHA, localSHA, env)
              ) {
                // Local is ahead of origin → keep local
                canonicalSHA = localSHA;
              } else {
                // Diverged — check cached policy
                const policy = this.getCachedPolicy
                  ? await this.getCachedPolicy(repo.id)
                  : undefined;
                if (!policy)
                  throw new DivergenceError(repo.id, localSHA, originSHA);
                canonicalSHA = policy.baseSHA;
              }
            }
          }
        }

        // Verify the requested branch exists in the home repo
        try {
          await execFile(
            "git",
            ["rev-parse", "--verify", `refs/heads/${branch}`],
            { cwd: homePath, env },
          );
        } catch {
          throw new WorkspacePreparationError(
            `Branch '${branch}' does not exist in home repo at ${homePath}`,
          );
        }

        // Clone home into workspace
        const wsDir = join(this.root, taskId);

        // Wipe existing workspace if present (wipe-on-retry)
        if (await pathExists(wsDir)) {
          await rm(wsDir, { recursive: true, force: true });
        }

        const kanthordBranch = `kanthord/${taskId}`;

        if (canonicalSHA !== undefined) {
          // lockDir mode: clone home and create kanthord branch at canonical SHA.
          // This handles ff-advance, ahead, and cached-policy cases uniformly.
          try {
            await execFile("git", [...GIT_CONFIG, "clone", homePath, wsDir], {
              env,
            });
          } catch (err) {
            throw new WorkspacePreparationError(
              `Failed to clone home repo to workspace: ${String(err)}`,
            );
          }
          await execFile(
            "git",
            [...GIT_CONFIG, "switch", "-c", kanthordBranch, canonicalSHA],
            { cwd: wsDir, env },
          );
          return {
            dir: wsDir,
            branch: kanthordBranch,
            baseCommit: canonicalSHA,
          };
        } else {
          // No-lockDir mode: existing behaviour — clone with --branch.
          try {
            await execFile(
              "git",
              [...GIT_CONFIG, "clone", "--branch", branch, homePath, wsDir],
              { env },
            );
          } catch (err) {
            throw new WorkspacePreparationError(
              `Failed to clone home repo to workspace: ${String(err)}`,
            );
          }

          // Get the base commit (HEAD of the branch in workspace)
          const { stdout: baseCommitOut } = await execFile(
            "git",
            ["rev-parse", "HEAD"],
            { cwd: wsDir, env },
          );
          const baseCommit = baseCommitOut.trim();

          // Create the kanthord branch
          await execFile(
            "git",
            [...GIT_CONFIG, "switch", "-c", kanthordBranch],
            {
              cwd: wsDir,
              env,
            },
          );

          return {
            dir: wsDir,
            branch: kanthordBranch,
            baseCommit,
          };
        }
      } finally {
        // Always release the lock file
        if (lockFh !== undefined && lockPath !== undefined) {
          try {
            await lockFh.close();
            await unlink(lockPath);
          } catch {
            // ignore cleanup errors
          }
        }
      }
    } finally {
      // Always delete temp credential files so they never outlive the git operation
      cleanup();
    }
  }
}

/**
 * Promotes the `kanthord/<taskId>` branch in `dir` to point at `proposalCommit`
 * using `git update-ref` (bypasses git's "cannot force-update current branch"
 * safety check that `git branch -f` enforces when the branch is checked out).
 * Throws if the commit does not exist.
 */
export async function promoteProposal(
  dir: string,
  taskId: string,
  proposalCommit: string,
): Promise<void> {
  await execFile(
    "git",
    ["update-ref", `refs/heads/kanthord/${taskId}`, proposalCommit],
    { cwd: dir },
  );
}
