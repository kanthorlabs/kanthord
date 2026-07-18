import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { access, cp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Repository, Filesystem } from "../domain/resource.ts";
import { WorkspacePreparationError } from "./port.ts";
import type { Workspace, WorkspaceManager } from "./port.ts";

const execFile = promisify(execFileCb);

const GIT_CONFIG = [
  "-c",
  "user.name=kanthord",
  "-c",
  "user.email=kanthord@localhost",
];

interface LocalWorkspaceManagerOptions {
  root: string;
  buildRemoteUrl?: (repo: Repository, name: string) => string;
}

function defaultBuildRemoteUrl(repo: Repository): string {
  return `https://github.com/${repo.organization}/${repo.name}.git`;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--git-dir"], { cwd: dir });
    return true;
  } catch {
    return false;
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

async function getRemoteUrl(dir: string): Promise<string> {
  const { stdout } = await execFile("git", ["remote", "get-url", "origin"], {
    cwd: dir,
  });
  return stdout.trim();
}

export class LocalWorkspaceManager implements WorkspaceManager {
  private readonly root: string;
  private readonly buildRemoteUrl: (repo: Repository, name: string) => string;

  constructor(opts: LocalWorkspaceManagerOptions) {
    this.root = opts.root;
    this.buildRemoteUrl = opts.buildRemoteUrl ?? defaultBuildRemoteUrl;
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
    await execFile("git", ["init"], { cwd: wsDir });
    await execFile("git", [...GIT_CONFIG, "add", "-A"], { cwd: wsDir });
    await execFile(
      "git",
      [...GIT_CONFIG, "commit", "-m", "initial workspace snapshot"],
      { cwd: wsDir },
    );

    // Get the initial commit sha (baseCommit)
    const { stdout: commitOut } = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: wsDir,
    });
    const baseCommit = commitOut.trim();

    // Create and switch to the kanthord/<taskId> branch
    const kanthordBranch = `kanthord/${taskId}`;
    await execFile("git", [...GIT_CONFIG, "switch", "-c", kanthordBranch], {
      cwd: wsDir,
    });

    return { dir: wsDir, branch: kanthordBranch, baseCommit };
  }

  private async prepareFromRepository(
    taskId: string,
    repo: Repository,
  ): Promise<Workspace> {
    const remoteUrl = this.buildRemoteUrl(repo, repo.name);
    const homePath = repo.path;

    // Ensure home exists: clone if missing, validate if present
    if (!(await pathExists(homePath))) {
      // Clone into a temp dir then rename atomically
      const tmpSuffix = randomBytes(4).toString("hex");
      const tmpPath = `${homePath}.tmp-${tmpSuffix}`;
      try {
        await execFile("git", [...GIT_CONFIG, "clone", remoteUrl, tmpPath]);
        await rename(tmpPath, homePath);
      } catch (err) {
        // Clean up temp dir if it exists
        try {
          await execFile("rm", ["-rf", tmpPath]);
        } catch {
          // ignore cleanup errors
        }
        throw new WorkspacePreparationError(
          `Failed to clone ${remoteUrl} to ${homePath}: ${String(err)}`,
        );
      }
    } else {
      // home exists — validate it is a git repo
      if (!(await isGitRepo(homePath))) {
        throw new WorkspacePreparationError(
          `Home path ${homePath} exists but is not a git repository`,
        );
      }
      // Validate origin matches expected URL
      let actualUrl: string;
      try {
        actualUrl = await getRemoteUrl(homePath);
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
    }

    // Verify the requested branch exists in the home repo
    try {
      await execFile(
        "git",
        ["rev-parse", "--verify", `refs/heads/${repo.branch}`],
        { cwd: homePath },
      );
    } catch {
      throw new WorkspacePreparationError(
        `Branch '${repo.branch}' does not exist in home repo at ${homePath}`,
      );
    }

    // Clone home into workspace
    const wsDir = join(this.root, taskId);

    // Wipe existing workspace if present (wipe-on-retry)
    if (await pathExists(wsDir)) {
      await rm(wsDir, { recursive: true, force: true });
    }

    try {
      await execFile("git", [
        ...GIT_CONFIG,
        "clone",
        "--branch",
        repo.branch,
        homePath,
        wsDir,
      ]);
    } catch (err) {
      throw new WorkspacePreparationError(
        `Failed to clone home repo to workspace: ${String(err)}`,
      );
    }

    // Get the base commit (HEAD of the branch in workspace)
    const { stdout: baseCommitOut } = await execFile(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: wsDir },
    );
    const baseCommit = baseCommitOut.trim();

    // Create the kanthord branch
    const kanthordBranch = `kanthord/${taskId}`;
    await execFile("git", [...GIT_CONFIG, "switch", "-c", kanthordBranch], {
      cwd: wsDir,
    });

    return {
      dir: wsDir,
      branch: kanthordBranch,
      baseCommit,
    };
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
