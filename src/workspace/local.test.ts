import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
  constants,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import {
  WorkspacePreparationError,
  DivergenceError,
  FetchError,
} from "./port.ts";
import { buildDeps } from "../composition.ts";
import type { Workspace, CachedModePolicy } from "./port.ts";
import { LocalWorkspaceManager } from "./local.ts";
import type { Repository, Filesystem } from "../domain/resource.ts";

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

async function createSeedRepo(dir: string, branch = "main"): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFile("git", ["init", "-b", branch], { cwd: dir });
  await execFile("git", ["config", "user.email", "test@localhost"], {
    cwd: dir,
  });
  await execFile("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# seed");
  await execFile("git", ["add", "."], { cwd: dir });
  await execFile("git", ["commit", "-m", "initial"], { cwd: dir });
}

// remoteUrl defaults to the GitHub stub — override for tests that need a real
// local remote (pass `file://${seedDir}`).
function makeRepo(
  path: string,
  branch = "main",
  remoteUrl = "https://github.com/kanthorlabs/sandbox.git",
): Repository {
  return {
    id: "repo-1",
    type: "repository",
    name: "sandbox",
    remoteUrl,
    branch,
    path,
    auth: { kind: "ambient" },
  };
}

function makeFilesystem(path: string): Filesystem {
  return {
    id: "fs-1",
    type: "filesystem",
    name: "local-src",
    path,
  };
}

describe("LocalWorkspaceManager — repository source (T1)", () => {
  let tmpRoot: string;
  let seedDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-ws-test-"));
    seedDir = join(tmpRoot, "seed.git");
    await createSeedRepo(seedDir);
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("home missing is cloned, workspace on kanthord/t1 with baseCommit", async () => {
    const homePath = join(tmpRoot, "home-a");
    const wsRoot = join(tmpRoot, "workspaces-a");
    await mkdir(wsRoot, { recursive: true });

    // T4: remoteUrl is the file:// URL directly; no buildRemoteUrl override needed.
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    const ws: Workspace = await mgr.prepare("t1", repo);

    // home dir must exist with no .tmp- leftover
    const homeExists = await mkdir(homePath, { recursive: true })
      .then(() => false)
      .catch(() => true);
    // directory already exists means it was created by prepare
    const { stdout: originOut } = await execFile(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: homePath },
    );
    assert.equal(
      originOut.trim(),
      `file://${seedDir}`,
      "home origin must be repo.remoteUrl",
    );

    // no .tmp- leftovers inside wsRoot/homePath parent
    const { stdout: lsOut } = await execFile("ls", [tmpRoot]);
    assert.ok(!lsOut.includes(".tmp-"), "no .tmp- leftover dirs should remain");

    // workspace is on kanthord/t1
    assert.equal(ws.branch, "kanthord/t1");

    // baseCommit is a non-empty sha
    assert.ok(ws.baseCommit.length >= 7, "baseCommit should be a git sha");

    // workspace dir exists
    const { stdout: branchOut } = await execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: ws.dir },
    );
    assert.equal(branchOut.trim(), "kanthord/t1");

    // baseCommit matches HEAD of the seed repo
    const { stdout: seedHead } = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: seedDir,
    });
    assert.equal(ws.baseCommit, seedHead.trim());
  });

  test("home pre-seeded with matching origin is reused, seed repo untouched", async () => {
    const homePath = join(tmpRoot, "home-b");
    const wsRoot = join(tmpRoot, "workspaces-b");
    await mkdir(wsRoot, { recursive: true });

    // T4: pre-seed via file:// so origin matches repo.remoteUrl
    // Match production cloneIntoHome: bare clone + remotes refspec + refetch.
    await execFile("git", ["clone", "--bare", `file://${seedDir}`, homePath]);
    await execFile(
      "git",
      ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
      { cwd: homePath },
    );
    await execFile("git", ["fetch", "origin"], { cwd: homePath });

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    const ws: Workspace = await mgr.prepare("t2", repo);

    // workspace exists on kanthord/t2
    assert.equal(ws.branch, "kanthord/t2");
    assert.ok(ws.baseCommit.length >= 7);

    // seed repo is untouched (still has 1 commit)
    const { stdout: logOut } = await execFile(
      "git",
      ["rev-list", "--count", "HEAD"],
      { cwd: seedDir },
    );
    assert.equal(logOut.trim(), "1", "seed repo should be untouched");
  });

  test("home with mismatched origin throws WorkspacePreparationError naming both URLs", async () => {
    const homePath = join(tmpRoot, "home-c");
    const wsRoot = join(tmpRoot, "workspaces-c");
    await mkdir(wsRoot, { recursive: true });

    // T4: clone --bare from file:// so origin = file://${seedDir}; repo.remoteUrl is the
    // default github stub → mismatch without needing a separate differentUrl var.
    // Match production cloneIntoHome: bare clone + remotes refspec + refetch.
    await execFile("git", ["clone", "--bare", `file://${seedDir}`, homePath]);
    await execFile(
      "git",
      ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
      { cwd: homePath },
    );
    await execFile("git", ["fetch", "origin"], { cwd: homePath });

    // repo.remoteUrl defaults to the github stub (not the seedDir file:// URL)
    const repo = makeRepo(homePath);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    await assert.rejects(
      () => mgr.prepare("t3", repo),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          "must be WorkspacePreparationError",
        );
        assert.ok(
          err.message.includes("https://github.com/kanthorlabs/sandbox.git"),
          `message must include expected URL: ${err.message}`,
        );
        assert.ok(
          err.message.includes(`file://${seedDir}`),
          `message must include actual URL: ${err.message}`,
        );
        return true;
      },
    );
  });

  test("home path is a plain dir throws WorkspacePreparationError", async () => {
    const homePath = join(tmpRoot, "home-d-plain");
    const wsRoot = join(tmpRoot, "workspaces-d");
    await mkdir(homePath, { recursive: true });
    await mkdir(wsRoot, { recursive: true });
    // write a plain file so it is a non-git directory
    await writeFile(join(homePath, "not-a-git-repo.txt"), "plain");

    // T4: no buildRemoteUrl needed; the plain-dir check happens before any clone
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    await assert.rejects(
      () => mgr.prepare("t4", repo),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          "must be WorkspacePreparationError",
        );
        return true;
      },
    );
  });

  test("home missing target branch throws WorkspacePreparationError", async () => {
    const homePath = join(tmpRoot, "home-e");
    const wsRoot = join(tmpRoot, "workspaces-e");
    await mkdir(wsRoot, { recursive: true });

    // T4: file:// remote; 'nonexistent' branch does not exist in seed
    const repo = makeRepo(homePath, "nonexistent", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    await assert.rejects(
      () => mgr.prepare("t5", repo),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          "must be WorkspacePreparationError",
        );
        return true;
      },
    );
  });
});

describe("LocalWorkspaceManager — filesystem source (T2)", () => {
  let tmpRoot: string;
  let srcDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-ws-fs-test-"));
    srcDir = join(tmpRoot, "source-files");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "hello.txt"), "hello world");
    await writeFile(join(srcDir, "main.ts"), "console.log('hi');");
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("filesystem source copies files into a git repo on kanthord/<id> with clean working tree", async () => {
    const wsRoot = join(tmpRoot, "workspaces-fs-a");
    await mkdir(wsRoot, { recursive: true });

    const fs = makeFilesystem(srcDir);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    const ws: Workspace = await mgr.prepare("fs-task-1", fs);

    // workspace exists and is a git repo on the kanthord branch
    assert.equal(ws.branch, "kanthord/fs-task-1");
    assert.ok(ws.baseCommit.length >= 7, "baseCommit must be a git sha");

    // working tree is clean (all files committed)
    const { stdout: statusOut } = await execFile(
      "git",
      ["status", "--porcelain"],
      { cwd: ws.dir },
    );
    assert.equal(
      statusOut.trim(),
      "",
      "working tree must be clean after prepare",
    );

    // source files are present in workspace
    const { stdout: lsOut } = await execFile("ls", [ws.dir]);
    assert.ok(lsOut.includes("hello.txt"), "hello.txt must be in workspace");
    assert.ok(lsOut.includes("main.ts"), "main.ts must be in workspace");
  });

  test("second prepare for same taskId wipes previous workspace and returns clean result", async () => {
    const wsRoot = join(tmpRoot, "workspaces-fs-b");
    await mkdir(wsRoot, { recursive: true });

    const fs = makeFilesystem(srcDir);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    // First prepare — creates the workspace
    const ws1: Workspace = await mgr.prepare("fs-task-2", fs);

    // Write a marker file into the workspace to simulate work done
    await writeFile(join(ws1.dir, "attempt-1-marker.txt"), "marker");

    // Second prepare for the same taskId — must wipe and recreate
    const ws2: Workspace = await mgr.prepare("fs-task-2", fs);

    // The marker file from attempt-1 must be gone
    let markerExists = false;
    try {
      const { stdout } = await execFile("ls", [ws2.dir]);
      markerExists = stdout.includes("attempt-1-marker.txt");
    } catch {
      // dir not readable is also fine (fresh), but we check below
    }
    assert.ok(!markerExists, "attempt-1 marker file must be gone after retry");

    // The result must still be a valid workspace
    assert.equal(ws2.branch, "kanthord/fs-task-2");
    assert.ok(
      ws2.baseCommit.length >= 7,
      "baseCommit must be a git sha on second prepare",
    );
  });

  test("filesystem source path missing throws WorkspacePreparationError naming the path", async () => {
    const wsRoot = join(tmpRoot, "workspaces-fs-c");
    await mkdir(wsRoot, { recursive: true });

    const missingPath = join(tmpRoot, "does-not-exist");
    const fs = makeFilesystem(missingPath);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    await assert.rejects(
      () => mgr.prepare("fs-task-3", fs),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          "must be WorkspacePreparationError",
        );
        assert.ok(
          err.message.includes(missingPath),
          `message must name the missing path: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// T4 — secure git env: GIT_ASKPASS injection + env sanitization
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — T4 secure git env", () => {
  let tmpRoot: string;
  let seedDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-ws-t4-"));
    seedDir = join(tmpRoot, "seed.git");
    await createSeedRepo(seedDir);
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("D2 clean-git-env contract: GIT_CONFIG constant clears credential.helper= alongside GIT_TERMINAL_PROMPT=0", () => {
    // D2 locked contract: every child git process must have credential.helper cleared
    // (via -c credential.helper=) so that a user's global credential manager cannot
    // intercept or override the GIT_ASKPASS token injection path.
    // GIT_CONFIG is a module-level constant (not exported); assert via source scan —
    // the smallest observable seam available per the dispatch contract.
    const src = readFileSync(new URL("./local.ts", import.meta.url), {
      encoding: "utf8",
    });

    assert.ok(
      src.includes('"credential.helper="'),
      'local.ts GIT_CONFIG must contain "-c", "credential.helper=" to clear any global credential helper (D2 contract)',
    );

    // Also verify GIT_TERMINAL_PROMPT=0 is enforced (both are required D2 items).
    assert.ok(
      src.includes("GIT_TERMINAL_PROMPT"),
      "local.ts buildGitEnv must set GIT_TERMINAL_PROMPT=0 (D2 contract)",
    );
  });

  test("S4 partial-write token-leak guard: buildGitEnv cleans both temp files in a catch block on write failure", () => {
    // S4 regression guard: if writeFile(askpassFile) or any prior step throws,
    // buildGitEnv must rmSync both tokenFile AND askpassFile before re-throwing —
    // so no credential file outlives a failed buildGitEnv call.
    // buildGitEnv is not exported; source scan is the smallest observable seam.
    //
    // S5 precision: the broad src.includes() scan would pass even if the S4 catch
    // block were deleted, because the same rmSync calls also appear in the S1
    // cleanup closure that follows the try/catch. Instead, extract specifically
    // the catch-block region (from the unique "// Partial-write guard:" comment
    // that opens the catch body to the first "throw err;" that closes it) and
    // assert that BOTH rmSync calls appear within that region.
    // Sensitivity: deleting the catch block (while keeping the cleanup closure)
    // makes the "// Partial-write guard:" anchor disappear → first assert fails.
    const src = readFileSync(new URL("./local.ts", import.meta.url), {
      encoding: "utf8",
    });

    // Unique anchor: the comment the SE placed at the top of the catch body.
    const CATCH_ANCHOR = "// Partial-write guard:";
    const catchStart = src.indexOf(CATCH_ANCHOR);
    assert.ok(
      catchStart !== -1,
      `local.ts must contain the '${CATCH_ANCHOR}' comment inside the buildGitEnv catch block (S4 contract) — deleting the catch block will fail this assertion`,
    );

    // The catch block terminates with 'throw err;' — find the first occurrence
    // after the anchor (which is within the catch body, before the cleanup closure).
    const THROW_MARKER = "throw err;";
    const throwEnd = src.indexOf(THROW_MARKER, catchStart);
    assert.ok(
      throwEnd !== -1,
      "local.ts buildGitEnv catch block must contain 'throw err;' after the partial-write guard comment (S4 contract)",
    );

    // Extract only the catch-block region; the cleanup closure (rmSync calls that
    // follow the try/catch on the success path) is intentionally excluded.
    const catchRegion = src.slice(catchStart, throwEnd + THROW_MARKER.length);

    assert.ok(
      catchRegion.includes("rmSync(tokenFile"),
      "buildGitEnv catch block must rmSync(tokenFile, ...) before re-throwing (S4 contract)",
    );
    assert.ok(
      catchRegion.includes("rmSync(askpassFile"),
      "buildGitEnv catch block must rmSync(askpassFile, ...) before re-throwing (S4 contract)",
    );
  });

  test("prepare strips GIT_TRACE from child git env (trace file absent after clone)", async () => {
    const traceFile = join(tmpRoot, "git-trace-output.txt");
    const homePath = join(tmpRoot, "home-t4-c");
    const wsRoot = join(tmpRoot, "ws-t4-c");
    await mkdir(wsRoot, { recursive: true });

    const repo: Repository = {
      id: "r-t4c",
      type: "repository",
      name: "test",
      remoteUrl: `file://${seedDir}`,
      branch: "main",
      path: homePath,
      auth: { kind: "ambient" },
    };

    // Inject GIT_TRACE so that — if inherited by the child process — git writes
    // a trace file.  After T4, LocalWorkspaceManager must strip GIT_TRACE*
    // from the child env so the file is never created.
    const savedTrace = process.env["GIT_TRACE"];
    process.env["GIT_TRACE"] = traceFile;
    try {
      const mgr = new LocalWorkspaceManager({ root: wsRoot });
      await mgr.prepare("t4-trace", repo);
    } finally {
      if (savedTrace === undefined) {
        delete process.env["GIT_TRACE"];
      } else {
        process.env["GIT_TRACE"] = savedTrace;
      }
    }

    // If the env was inherited, git would have written to traceFile.
    const traceCreated = await access(traceFile)
      .then(() => true)
      .catch(() => false);
    assert.equal(
      traceCreated,
      false,
      "GIT_TRACE must be stripped from child git env — trace file must not be created",
    );
  });

  test("prepare with https-token auth accepts resolveCredential and token is absent from remote URL", async () => {
    const TOKEN = "super-secret-token-abc999";
    const homePath = join(tmpRoot, "home-t4-b");
    const wsRoot = join(tmpRoot, "ws-t4-b");
    await mkdir(wsRoot, { recursive: true });

    const repo: Repository = {
      id: "r-t4b",
      type: "repository",
      name: "test-https",
      remoteUrl: `file://${seedDir}`,
      branch: "main",
      path: homePath,
      auth: { kind: "https-token", credentialId: "cred-1" },
    };

    // LocalWorkspaceManager must accept a resolveCredential option so the
    // token is retrieved without embedding it in the argv or remote URL.
    // RED today (two reasons):
    // 1. TypeScript: resolveCredential is not in LocalWorkspaceManagerOptions.
    // 2. Runtime: resolveCredential is never called (option ignored) → spy fails.
    let resolveCalledWith: string | undefined;
    const mgr = new LocalWorkspaceManager({
      root: wsRoot,
      resolveCredential: async (id: string) => {
        resolveCalledWith = id;
        return TOKEN;
      },
    });
    const ws = await mgr.prepare("t4-token", repo);
    assert.ok(ws.baseCommit.length >= 7, "must return a valid workspace");

    // resolveCredential must have been called with the credentialId from auth
    assert.equal(
      resolveCalledWith,
      "cred-1",
      "resolveCredential must be called with the auth.credentialId",
    );

    // The token must NOT appear embedded in the configured remote URL.
    const { stdout: originUrl } = await execFile(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: homePath },
    );
    assert.ok(
      !originUrl.includes(TOKEN),
      "token must not be embedded in git remote URL",
    );
  });
});

// ---------------------------------------------------------------------------
// T3 — Story 12 D5: fetch + CAS + clone at canonical SHA
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — T3 fetch + CAS + canonical SHA", () => {
  // Clone from a file:// URL and configure git user in the clone so commits work.
  async function cloneBare(from: string, to: string): Promise<void> {
    // Match production cloneIntoHome: bare clone + remotes refspec + refetch.
    await execFile("git", ["clone", "--bare", `file://${from}`, to]);
    await execFile(
      "git",
      ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
      { cwd: to },
    );
    await execFile("git", ["fetch", "origin"], { cwd: to });
  }

  // Write a file, stage, commit, return new HEAD SHA.
  async function addAndCommit(
    dir: string,
    file: string,
    content: string,
    msg: string,
  ): Promise<string> {
    await writeFile(join(dir, file), content);
    await execFile("git", ["add", "-A"], { cwd: dir });
    await execFile("git", ["commit", "-m", msg], { cwd: dir });
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: dir,
    });
    return stdout.trim();
  }

  test("(a) home behind origin: ff-advances main, workspace baseCommit = new canonical SHA", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "kanthord-t3a-"));
    try {
      const lockDir = join(tmp, "locks");
      await mkdir(lockDir, { recursive: true });
      const wsRoot = join(tmp, "ws");
      await mkdir(wsRoot, { recursive: true });

      const originDir = join(tmp, "origin");
      await createSeedRepo(originDir);

      const homeDir = join(tmp, "home");
      await cloneBare(originDir, homeDir);

      // advance origin → homeDir is behind by one commit
      const c2Sha = await addAndCommit(originDir, "extra.txt", "extra", "c2");

      const repo = makeRepo(homeDir, "main", `file://${originDir}`);
      const mgr = new LocalWorkspaceManager({ root: wsRoot, lockDir });

      const ws = await mgr.prepare("task-a", repo);

      // After ff-advance, home/main must be at c2Sha
      const homeSha = await git(homeDir, "rev-parse", "main");
      assert.equal(
        homeSha,
        c2Sha,
        "home/main must ff-advance to origin/main SHA",
      );
      // Workspace baseCommit must be the canonical SHA (c2Sha), not the stale c1Sha
      assert.equal(
        ws.baseCommit,
        c2Sha,
        "workspace baseCommit must equal canonical SHA",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("(b) home ahead of origin: keeps local main, workspace baseCommit = local SHA (characterization)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "kanthord-t3b-"));
    try {
      const lockDir = join(tmp, "locks");
      await mkdir(lockDir, { recursive: true });
      const wsRoot = join(tmp, "ws");
      await mkdir(wsRoot, { recursive: true });

      const originDir = join(tmp, "origin");
      await createSeedRepo(originDir);

      const homeDir = join(tmp, "home");
      // Bare home: push a commit via a workdir to simulate local landing
      await cloneBare(originDir, homeDir);
      const workDir = join(tmp, "work");
      await execFile("git", ["clone", `file://${originDir}`, workDir]);
      await execFile("git", ["config", "user.email", "test@localhost"], {
        cwd: workDir,
      });
      await execFile("git", ["config", "user.name", "Test"], { cwd: workDir });
      const c2Sha = await addAndCommit(
        workDir,
        "landed.txt",
        "landed",
        "local-landed",
      );
      await execFile("git", ["push", homeDir, "HEAD:main"], { cwd: workDir });

      const repo = makeRepo(homeDir, "main", `file://${originDir}`);
      const mgr = new LocalWorkspaceManager({ root: wsRoot, lockDir });

      const ws = await mgr.prepare("task-b", repo);

      // home/main must remain at c2Sha (ahead → keep local, no reset)
      const homeSha = await git(homeDir, "rev-parse", "main");
      assert.equal(
        homeSha,
        c2Sha,
        "home/main must not change when already ahead",
      );
      assert.equal(
        ws.baseCommit,
        c2Sha,
        "workspace baseCommit must be local SHA (ahead case)",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("(c) diverged + no cached policy: prepare throws DivergenceError", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "kanthord-t3c-"));
    try {
      const lockDir = join(tmp, "locks");
      await mkdir(lockDir, { recursive: true });
      const wsRoot = join(tmp, "ws");
      await mkdir(wsRoot, { recursive: true });

      const originDir = join(tmp, "origin");
      await createSeedRepo(originDir);

      const homeDir = join(tmp, "home");
      await cloneBare(originDir, homeDir);

      // diverge both sides from c1 (the shared base)
      const workDir = join(tmp, "work");
      await execFile("git", ["clone", `file://${originDir}`, workDir]);
      await execFile("git", ["config", "user.email", "test@localhost"], {
        cwd: workDir,
      });
      await execFile("git", ["config", "user.name", "Test"], { cwd: workDir });
      await addAndCommit(workDir, "local.txt", "local", "home-only");
      await execFile("git", ["push", homeDir, "HEAD:main"], { cwd: workDir });
      await addAndCommit(originDir, "remote.txt", "remote", "origin-only");

      const repo = makeRepo(homeDir, "main", `file://${originDir}`);
      const mgr = new LocalWorkspaceManager({ root: wsRoot, lockDir });

      await assert.rejects(
        () => mgr.prepare("task-c", repo),
        (err: unknown) => {
          assert.ok(
            err instanceof DivergenceError,
            `must be DivergenceError; got: ${String(err)}`,
          );
          assert.equal(
            err.repoId,
            repo.id,
            "DivergenceError must carry repoId",
          );
          return true;
        },
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("(d) diverged + CachedModePolicy: prepare uses stored baseSHA, skips live fetch", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "kanthord-t3d-"));
    try {
      const lockDir = join(tmp, "locks");
      await mkdir(lockDir, { recursive: true });
      const wsRoot = join(tmp, "ws");
      await mkdir(wsRoot, { recursive: true });

      const originDir = join(tmp, "origin");
      await createSeedRepo(originDir);
      const c1Sha = await git(originDir, "rev-parse", "HEAD");

      const homeDir = join(tmp, "home");
      await cloneBare(originDir, homeDir);

      // diverge both sides
      const workDir = join(tmp, "work");
      await execFile("git", ["clone", `file://${originDir}`, workDir]);
      await execFile("git", ["config", "user.email", "test@localhost"], {
        cwd: workDir,
      });
      await execFile("git", ["config", "user.name", "Test"], { cwd: workDir });
      await addAndCommit(workDir, "local.txt", "local", "home-only");
      await execFile("git", ["push", homeDir, "HEAD:main"], { cwd: workDir });
      await addAndCommit(originDir, "remote.txt", "remote", "origin-only");

      const cachedPolicy: CachedModePolicy = {
        repoId: "repo-1",
        lastFetchedOriginSHA: c1Sha,
        fetchTime: new Date().toISOString(),
        baseSHA: c1Sha,
      };

      const repo = makeRepo(homeDir, "main", `file://${originDir}`);
      const mgr = new LocalWorkspaceManager({
        root: wsRoot,
        lockDir,
        getCachedPolicy: async (_repoId: string) => cachedPolicy,
      });

      const ws = await mgr.prepare("task-d", repo);
      // Workspace must be cloned at the cached baseSHA (c1Sha), not the diverged local HEAD
      assert.equal(
        ws.baseCommit,
        c1Sha,
        "workspace baseCommit must be cached baseSHA, not diverged local HEAD",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("(e) fetch fails + no cached policy: prepare throws FetchError", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "kanthord-t3e-"));
    try {
      const lockDir = join(tmp, "locks");
      await mkdir(lockDir, { recursive: true });
      const wsRoot = join(tmp, "ws");
      await mkdir(wsRoot, { recursive: true });

      const originDir = join(tmp, "origin");
      await createSeedRepo(originDir);

      const homeDir = join(tmp, "home");
      await cloneBare(originDir, homeDir);

      // Remove origin so any fetch attempt fails
      await rm(originDir, { recursive: true, force: true });

      const repo = makeRepo(homeDir, "main", `file://${originDir}`);
      const mgr = new LocalWorkspaceManager({ root: wsRoot, lockDir });

      await assert.rejects(
        () => mgr.prepare("task-e", repo),
        (err: unknown) => {
          assert.ok(
            err instanceof FetchError,
            `must be FetchError; got: ${String(err)}`,
          );
          assert.equal(err.repoId, repo.id, "FetchError must carry repoId");
          return true;
        },
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("(f) lock contention: concurrent prepares both get canonical SHA from fetched origin", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "kanthord-t3f-"));
    try {
      const lockDir = join(tmp, "locks");
      await mkdir(lockDir, { recursive: true });
      const wsRoot = join(tmp, "ws");
      await mkdir(wsRoot, { recursive: true });

      const originDir = join(tmp, "origin");
      await createSeedRepo(originDir);

      const homeDir = join(tmp, "home");
      await cloneBare(originDir, homeDir);

      // advance origin → both concurrent prepares must see c2Sha after fetch
      const c2Sha = await addAndCommit(originDir, "extra.txt", "extra", "c2");

      const repo = makeRepo(homeDir, "main", `file://${originDir}`);
      const mgr1 = new LocalWorkspaceManager({ root: wsRoot, lockDir });
      const mgr2 = new LocalWorkspaceManager({ root: wsRoot, lockDir });

      const [ws1, ws2] = await Promise.all([
        mgr1.prepare("task-f1", repo),
        mgr2.prepare("task-f2", repo),
      ]);

      assert.equal(
        ws1.baseCommit,
        c2Sha,
        "ws1.baseCommit must equal canonical SHA from fetched origin",
      );
      assert.equal(
        ws2.baseCommit,
        c2Sha,
        "ws2.baseCommit must equal canonical SHA from fetched origin",
      );

      // No stale lock files must remain after both prepares complete
      const lockFiles = await readdir(lockDir);
      assert.deepEqual(
        lockFiles.filter((f) => f.endsWith(".lock")),
        [],
        "no stale .lock files must remain after both prepares complete",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Story 05 T1 — homeDir(repoId) accessor (canonical mirror path)
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — Story 05 T1 homeDir(repoId) accessor", () => {
  let tmpRoot: string;
  let seedDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-ws-homedir-"));
    seedDir = join(tmpRoot, "seed.git");
    await createSeedRepo(seedDir);
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("homeDir returns the canonical mirror path: stable and distinct from a task workspace dir", async () => {
    const homePath = join(tmpRoot, "home-hd");
    const wsRoot = join(tmpRoot, "workspaces-hd");
    await mkdir(wsRoot, { recursive: true });

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    // prepare clones the home to repo.path and a task workspace to wsRoot/<taskId>
    const ws = await mgr.prepare("t-hd", repo);

    const home = mgr.homeDir(repo.id);

    // returns a non-empty path string
    assert.ok(
      typeof home === "string" && home.length > 0,
      "homeDir must return a path string",
    );
    // stable across calls (the same canonical mirror for the repoId)
    assert.equal(
      home,
      mgr.homeDir(repo.id),
      "homeDir must be stable for the same repoId",
    );
    // distinct from the task workspace dir the manager creates for a task
    assert.notEqual(
      home,
      ws.dir,
      "homeDir must not equal a task workspace dir",
    );
  });
});

// ---------------------------------------------------------------------------
// Story 06 T1 (F3) — shared per-repo+branch lock wired into LocalWorkspaceManager
// and shared with GitRepositoryLanding so prepare-fetch and land serialize.
//
// RED today (both prove the wiring gap):
//  1. `CliDeps.workspaces` is not exposed by buildDeps yet → `deps.workspaces`
//     is undefined (typecheck error + runtime TypeError on `.prepare`).
//  2. Even with the seam, `buildDeps` constructs `LocalWorkspaceManager` with
//     `{ root }` only (no lockDir), so `prepare` never acquires the shared lock
//     and does NOT serialize with `repoLanding.land` on the same repo+branch.
// The shared lock path is `<lockDir>/<repoId>-<branch>.lock` where lockDir is
// dirname(dbPath) — exactly the path GitRepositoryLanding uses — so holding that
// file must block a buildDeps-wired prepare.
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — Story 06 T1 shared lock wiring", () => {
  let tmpRoot: string;
  let seedDir: string;
  let homeDir: string;
  let mainSha: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-ws-lock-"));
    seedDir = join(tmpRoot, "seed.git");
    await createSeedRepo(seedDir);
    // Pre-clone the canonical home mirror so `land`'s already-landed candidate
    // is valid and `prepare` takes the home-exists fetch+CAS path.
    homeDir = join(tmpRoot, "home");
    await execFile("git", ["clone", `file://${seedDir}`, homeDir]);
    mainSha = await git(homeDir, "rev-parse", "main");
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  function lockPathFor(dbPath: string, repoId: string, branch: string): string {
    return join(dirname(dbPath), `${repoId}-${branch}.lock`);
  }

  async function lockHeld(lockPath: string): Promise<boolean> {
    return access(lockPath)
      .then(() => true)
      .catch(() => false);
  }

  test("(a) buildDeps wires lockDir into the workspace manager: prepare blocks on the shared lock at dirname(dbPath)", async () => {
    const dbDir = join(tmpRoot, "db-a");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "kanthord.db");

    const deps = buildDeps(dbPath);
    // SE must expose `workspaces` on CliDeps (RED today: undefined).
    const mgr = deps.workspaces;
    const repo = makeRepo(homeDir, "main", `file://${seedDir}`);

    const lockPath = lockPathFor(dbPath, repo.id, repo.branch);
    // Manually hold the shared lock at the exact path GitRepositoryLanding uses.
    const fh = await open(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );

    let settled = false;
    const p = mgr.prepare("t-lock-a", repo).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      settled,
      false,
      "prepare must block on the shared lock (lockDir = dirname(dbPath) wired into buildDeps)",
    );
    // Release and confirm prepare completes cleanly with no orphan lock.
    await fh.close();
    await unlink(lockPath);
    await p;
    assert.equal(
      await lockHeld(lockPath),
      false,
      "no orphan .lock left after prepare completes",
    );
  });

  test("(b) prepare-fetch blocks on the shared lock; land (object path) is lock-free; no orphan .lock", async () => {
    const dbDir = join(tmpRoot, "db-b");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "kanthord.db");
    const deps = buildDeps(dbPath);
    const mgr = deps.workspaces;
    const repo = makeRepo(homeDir, "main", `file://${seedDir}`);

    const wsClone = join(tmpRoot, "wsclone-b");
    await execFile("git", ["clone", `file://${seedDir}`, wsClone]);

    // candidateSHA == current main HEAD, target == main.
    const candidate = {
      id: "c-t1-b",
      taskId: "t-lock-b",
      repoId: repo.id,
      baseSHA: mainSha,
      candidateSHA: mainSha,
      ref: "kanthord/t-lock-b",
      target: "main",
      workspace: wsClone,
    };

    const lockPath = lockPathFor(dbPath, repo.id, repo.branch);
    const fh = await open(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );

    let prepareSettled = false;
    let landSettled = false;
    const pPrepare = mgr.prepare("t-lock-b", repo).then(
      () => {
        prepareSettled = true;
      },
      () => {
        prepareSettled = true;
      },
    );
    // The object path (resolveTargetOID → preview → landPreviewed) is lock-free:
    // the old land() acquired the lock internally, but landPreviewed uses direct CAS update-ref.
    const pLand = (async () => {
      const targetOID = await deps.repoLanding.resolveTargetOID(
        homeDir,
        candidate.target,
      );
      const previewOutcome = await deps.repoLanding.preview(
        homeDir,
        candidate,
        targetOID,
      );
      return deps.repoLanding.landPreviewed(
        homeDir,
        candidate,
        previewOutcome,
        targetOID,
      );
    })().then(
      () => {
        landSettled = true;
      },
      () => {
        landSettled = true;
      },
    );

    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      prepareSettled,
      false,
      "prepare must block on the shared lock while it is held",
    );
    // landPreviewed is lock-free (the old land() was the one that acquired the lock).
    // landSettled may be true or false — we don't assert on it.

    // Release the lock; both must now complete.
    await fh.close();
    await unlink(lockPath);
    await Promise.all([pPrepare, pLand]);

    assert.equal(
      await lockHeld(lockPath),
      false,
      "no orphan .lock left after both operations complete",
    );
  });
});

// ---------------------------------------------------------------------------
// EPIC 007.4 S1 — relative root resolved to absolute ws.dir
// RED today: LocalWorkspaceManager stores root as-is (no resolve()), so
// ws.dir = join(relativeRoot, taskId) is still relative.
// GREEN after: constructor calls resolve(root) once, making every ws.dir absolute.
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — 007.4 S1: relative root resolved to absolute ws.dir", () => {
  let tmpRoot: string;
  let srcDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-ws-s1rel-"));
    srcDir = join(tmpRoot, "source");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "hello.txt"), "hello");
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("relative root produces absolute ws.dir (isAbsolute === true)", async () => {
    // Compute a relative path from process.cwd() into tmpRoot — this simulates
    // the default-install scenario where workspaceRoot = join(dirname(dbPath), "workspaces")
    // and dbPath is the relative ".data/kanthord.db".
    const absoluteWsRoot = join(tmpRoot, "ws-rel");
    const relativeRoot = relative(process.cwd(), absoluteWsRoot);
    assert.ok(
      !isAbsolute(relativeRoot),
      `precondition: relativeRoot must be relative for this test to be meaningful; got: "${relativeRoot}"`,
    );

    const mgr = new LocalWorkspaceManager({ root: relativeRoot });
    const fs = makeFilesystem(srcDir);
    const ws = await mgr.prepare("task-s1-rel", fs);

    assert.ok(
      isAbsolute(ws.dir),
      `ws.dir must be absolute even when root is relative; got: "${ws.dir}"`,
    );
  });
});

// ---------------------------------------------------------------------------
// EPIC 007.9 Story 01 — workspace-prep inspects the checkout ROOT, not
// "inside a repo" (e2e-0079 bug reproduction + hardening).
//
// RED today: LocalWorkspaceManager's `isGitRepo()` runs `git rev-parse
// --git-dir`, which succeeds from ANY dir nested inside a git worktree —
// resolving to the ENCLOSING repo, not homePath's own. `pathExists()` uses
// `access()` (follows symlinks) instead of `lstat`. These five cases pin the
// discriminated-state contract from Story 01 that fixes both.
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — 007.9 Story 01: checkout-root inspection", () => {
  let tmpRoot: string;
  let seedDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-ws-checkoutroot-"));
    seedDir = join(tmpRoot, "seed.git");
    await createSeedRepo(seedDir);
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("(A) empty dir nested inside an outer repo clones fresh — the e2e-0079 bug reproduction", async () => {
    const outerDir = join(tmpRoot, "outer-a");
    await mkdir(outerDir, { recursive: true });
    await execFile("git", ["init", "-q"], { cwd: outerDir });

    const homePath = join(outerDir, "nested", "home");
    await mkdir(homePath, { recursive: true });

    // Guard: prove `--show-toplevel` from inside the empty nested dir really
    // does resolve to the OUTER repo — this is the exact precondition that
    // made run e2e-0079 misread "home exists" as "wrong origin".
    const { stdout: toplevelOut } = await execFile(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: homePath },
    );
    const resolvedToplevel = await realpath(toplevelOut.trim());
    const resolvedOuter = await realpath(outerDir);
    assert.equal(
      resolvedToplevel,
      resolvedOuter,
      "precondition: --show-toplevel from the empty nested dir must resolve to the OUTER repo (proves the bug setup)",
    );

    const wsRoot = join(tmpRoot, "workspaces-a");
    await mkdir(wsRoot, { recursive: true });
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    const ws = await mgr.prepare("t-checkoutroot-a", repo);

    assert.ok(
      ws.baseCommit.length >= 7,
      "must return a valid prepared workspace (no throw)",
    );
    const { stdout: originOut } = await execFile(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: homePath },
    );
    assert.equal(
      originOut.trim(),
      `file://${seedDir}`,
      "the nested empty dir must be cloned fresh with the EXPECTED origin, not the outer repo's",
    );
  });

  test("(B) enclosing-checkout: non-empty dir with no .git of its own, inside an outer repo, errors naming the real problem (not 'wrong origin')", async () => {
    const outerDir = join(tmpRoot, "outer-b");
    await mkdir(outerDir, { recursive: true });
    await execFile("git", ["init", "-q"], { cwd: outerDir });
    await execFile(
      "git",
      ["remote", "add", "origin", "file:///nonexistent-outer-origin.git"],
      { cwd: outerDir },
    );

    const homePath = join(outerDir, "nested", "home");
    await mkdir(homePath, { recursive: true });
    await writeFile(join(homePath, "some-file.txt"), "content");

    const wsRoot = join(tmpRoot, "workspaces-b");
    await mkdir(wsRoot, { recursive: true });
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    const resolvedOuter = await realpath(outerDir);
    await assert.rejects(
      () => mgr.prepare("t-checkoutroot-b", repo),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          "must be WorkspacePreparationError",
        );
        assert.ok(
          err.message.includes("nested inside"),
          `message must name the real problem ("nested inside"), not a wrong-origin mismatch: ${err.message}`,
        );
        assert.ok(
          err.message.includes(resolvedOuter) || err.message.includes(outerDir),
          `message must name the enclosing checkout root: ${err.message}`,
        );
        assert.ok(
          !err.message.includes("nonexistent-outer-origin"),
          `message must NOT read the outer repo's origin as if it were home's own: ${err.message}`,
        );
        return true;
      },
    );
  });

  test("(C) non-empty non-repo dir (a lone hidden file) errors 'not empty'; dir left untouched", async () => {
    const homePath = await mkdtemp(join(tmpdir(), "kanthord-ws-nonempty-"));
    await writeFile(join(homePath, ".hidden-marker"), "x");

    const wsRoot = join(tmpRoot, "workspaces-c");
    await mkdir(wsRoot, { recursive: true });
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    try {
      await assert.rejects(
        () => mgr.prepare("t-checkoutroot-c", repo),
        (err: unknown) => {
          assert.ok(
            err instanceof WorkspacePreparationError,
            "must be WorkspacePreparationError",
          );
          assert.ok(
            err.message.toLowerCase().includes("not empty"),
            `message must say the dir is not empty (hidden files count as entries): ${err.message}`,
          );
          return true;
        },
      );
      const entries = await readdir(homePath);
      assert.deepEqual(
        entries,
        [".hidden-marker"],
        "dir must be left untouched — hidden file still present, nothing removed",
      );
    } finally {
      await rm(homePath, { recursive: true, force: true });
    }
  });

  test("(D) git-error (permission-denied home dir) propagates the underlying failure, not masked as 'not a git repository'", async () => {
    const homePath = await mkdtemp(join(tmpdir(), "kanthord-ws-giterr-"));
    await writeFile(join(homePath, "placeholder.txt"), "x");
    await chmod(homePath, 0o000);

    const wsRoot = join(tmpRoot, "workspaces-d");
    await mkdir(wsRoot, { recursive: true });
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    try {
      await assert.rejects(
        () => mgr.prepare("t-checkoutroot-d", repo),
        (err: unknown) => {
          assert.ok(
            err instanceof WorkspacePreparationError,
            "must be WorkspacePreparationError",
          );
          assert.ok(
            err.message.toLowerCase().includes("eacces"),
            `message must preserve the underlying git/spawn failure (EACCES), not a generic "not a git repository": ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await chmod(homePath, 0o755);
      await rm(homePath, { recursive: true, force: true });
    }
  });

  test("(E) broken-symlink homePath is classified via lstat, not treated as absent (no clone-then-crash)", async () => {
    const parentDir = await mkdtemp(join(tmpdir(), "kanthord-ws-symlink-"));
    const homePath = join(parentDir, "broken-link");
    await symlink(join(parentDir, "does-not-exist"), homePath);

    const wsRoot = join(tmpRoot, "workspaces-e");
    await mkdir(wsRoot, { recursive: true });
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    try {
      await assert.rejects(
        () => mgr.prepare("t-checkoutroot-e", repo),
        (err: unknown) => {
          assert.ok(
            err instanceof WorkspacePreparationError,
            "must be WorkspacePreparationError",
          );
          assert.ok(
            !err.message.includes("Failed to clone"),
            `a broken symlink must be classified up front (lstat) as a distinct non-absent state, not treated as absent and clone-attempted then crashed on rename: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// EPIC 007.11 Stories A+B — bare managed home creation + bare-aware prep
//
// RED today: cloneIntoHome creates a non-bare clone → home is not bare.
// After Stories A+B: fresh prepare creates a bare home, fetch/CAS targets
// the bare git dir, per-task clone remains a non-bare checkout.
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — 007.11 A+B: bare managed home", () => {
  let tmpRoot: string;
  let seedDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-0711ab-"));
    seedDir = join(tmpRoot, "seed.git");
    await createSeedRepo(seedDir);
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // Helper: write file, stage, commit, return new HEAD SHA.
  async function addAndCommit(
    dir: string,
    file: string,
    content: string,
    msg: string,
  ): Promise<string> {
    await writeFile(join(dir, file), content);
    await execFile("git", ["add", "-A"], { cwd: dir });
    await execFile("git", ["commit", "-m", msg], { cwd: dir });
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: dir,
    });
    return stdout.trim();
  }

  test("(a) fresh prepare on absent home creates a bare home with refs/heads + refs/remotes, no working-tree files", async () => {
    const homePath = join(tmpRoot, "home-a");
    const wsRoot = join(tmpRoot, "ws-a");
    await mkdir(wsRoot, { recursive: true });

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    const ws = await mgr.prepare("t-a", repo);

    // Workspace is usable
    assert.equal(ws.branch, "kanthord/t-a");
    assert.ok(ws.baseCommit.length >= 7, "baseCommit must be a git sha");

    // Home is bare
    const { stdout: bareOut } = await execFile(
      "git",
      ["rev-parse", "--is-bare-repository"],
      { cwd: homePath },
    );
    assert.equal(bareOut.trim(), "true", "home must be a bare repository");

    // Has refs/heads/main
    const { stdout: headOut } = await execFile(
      "git",
      ["rev-parse", "refs/heads/main"],
      { cwd: homePath },
    );
    assert.ok(
      headOut.trim().length >= 7,
      "refs/heads/main must exist in bare home",
    );

    // Has refs/remotes/origin/main
    const { stdout: remoteOut } = await execFile(
      "git",
      ["rev-parse", "refs/remotes/origin/main"],
      { cwd: homePath },
    );
    assert.ok(
      remoteOut.trim().length >= 7,
      "refs/remotes/origin/main must exist in bare home",
    );

    // No working-tree files at the home root (bare repo has only git internals)
    const { stdout: lsOut } = await execFile("ls", [homePath]);
    assert.ok(
      !lsOut.includes("src/"),
      "bare home must not have a src/ working-tree directory",
    );
    assert.ok(lsOut.includes("HEAD"), "bare home must contain HEAD");
    assert.ok(lsOut.includes("objects"), "bare home must contain objects/");

    // Workspace is a non-bare checkout
    const { stdout: wsBare } = await execFile(
      "git",
      ["rev-parse", "--is-bare-repository"],
      { cwd: ws.dir },
    );
    assert.equal(
      wsBare.trim(),
      "false",
      "workspace clone must be a non-bare checkout",
    );
  });

  test("(b) bare home: remote advance fast-forwards refs/heads/<branch> on second prepare", async () => {
    const homePath = join(tmpRoot, "home-b");
    const wsRoot = join(tmpRoot, "ws-b");
    await mkdir(wsRoot, { recursive: true });
    const lockDir = join(tmpRoot, "locks-b");
    await mkdir(lockDir, { recursive: true });

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);

    // First prepare creates the bare home (clones from seed)
    {
      const mgr = new LocalWorkspaceManager({ root: wsRoot, lockDir });
      await mgr.prepare("t-b1", repo);
    }

    // Advance the remote by one commit
    const c2Sha = await addAndCommit(seedDir, "extra.txt", "extra", "c2");

    // Second prepare must see the new remote commit and ff-advance
    const mgr2 = new LocalWorkspaceManager({ root: wsRoot, lockDir });
    const ws2 = await mgr2.prepare("t-b2", repo);

    // Bare home's refs/heads/main must have advanced
    const homeMain = await git(homePath, "rev-parse", "refs/heads/main");
    assert.equal(
      homeMain,
      c2Sha,
      "bare home refs/heads/main must ff-advance to the new origin commit",
    );

    // Workspace baseCommit equals the bare home branch tip
    assert.equal(
      ws2.baseCommit,
      c2Sha,
      "workspace baseCommit must equal the bare home branch tip",
    );
  });

  test("(c) divergent bare home still raises DivergenceError", async () => {
    const homePath = join(tmpRoot, "home-c");
    const wsRoot = join(tmpRoot, "ws-c");
    await mkdir(wsRoot, { recursive: true });
    const lockDir = join(tmpRoot, "locks-c");
    await mkdir(lockDir, { recursive: true });

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);

    // First prepare creates home at c1 (non-bare before A+B, bare after A+B)
    {
      const mgr = new LocalWorkspaceManager({ root: wsRoot, lockDir });
      await mgr.prepare("t-c1", repo);
    }

    // --- Create a local-only commit on the home using env-based plumbing ---
    // Uses GIT_INDEX_FILE + hash-object -w + write-tree + commit-tree so all
    // objects land in homePath's ODB regardless of whether it's bare or not.
    const parentSha = await git(homePath, "rev-parse", "refs/heads/main");

    const tmpWt = join(tmpRoot, "tmp-wt-c");
    await mkdir(tmpWt, { recursive: true });
    await writeFile(join(tmpWt, "local.txt"), "local diverge");

    // Write blob into homePath's ODB
    const { stdout: blobSha } = await execFile(
      "git",
      ["hash-object", "-w", join(tmpWt, "local.txt")],
      { cwd: homePath },
    );

    // Build a tree in homePath's ODB via temp index
    const tmpIdx = join(tmpRoot, "tmp-idx-c");
    const addEnv = { ...process.env, GIT_INDEX_FILE: tmpIdx };
    await execFile(
      "git",
      [
        "update-index",
        "--add",
        "--cacheinfo",
        "100644",
        blobSha.trim(),
        "local.txt",
      ],
      { env: addEnv, cwd: homePath },
    );
    const { stdout: treeSha } = await execFile("git", ["write-tree"], {
      env: addEnv,
      cwd: homePath,
    });

    // Create commit object in homePath's ODB
    const { stdout: commitSha } = await execFile(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@localhost",
        "commit-tree",
        treeSha.trim(),
        "-p",
        parentSha,
        "-m",
        "local diverge",
      ],
      { cwd: homePath },
    );
    await execFile("git", ["update-ref", "refs/heads/main", commitSha.trim()], {
      cwd: homePath,
    });
    await rm(tmpWt, { recursive: true, force: true });
    await rm(tmpIdx, { recursive: true, force: true });

    // --- Origin also diverges ---
    await addAndCommit(seedDir, "remote.txt", "remote", "origin-only");

    // Second prepare on the divergent pair must raise DivergenceError
    const repo2 = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr2 = new LocalWorkspaceManager({ root: wsRoot, lockDir });
    await assert.rejects(
      () => mgr2.prepare("t-c2", repo2),
      (err: unknown) => {
        assert.ok(
          err instanceof DivergenceError,
          `must be DivergenceError; got: ${String(err)}`,
        );
        assert.equal(err.repoId, repo2.id, "DivergenceError must carry repoId");
        return true;
      },
    );
  });

  test("(d) bare home lifecycle: home not initialized until prepare is called (regression — BLOCKER B1)", async () => {
    const homePath = join(tmpRoot, "home-d");
    const wsRoot = join(tmpRoot, "ws-d");
    await mkdir(wsRoot, { recursive: true });

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);

    // Before prepare: home path must NOT exist on the filesystem
    // (proves the lifecycle ordering — the EPIC proof's Story A block must
    // run AFTER prepare/daemon, not before, or it checks a non-existent home)
    let homeExistsBefore: boolean;
    try {
      await access(homePath);
      homeExistsBefore = true;
    } catch {
      homeExistsBefore = false;
    }
    assert.equal(
      homeExistsBefore,
      false,
      "home path must not exist before prepare is called — lifecycle: only prepare() initializes the bare home",
    );

    // Now call prepare — this must create the bare home
    const mgr = new LocalWorkspaceManager({ root: wsRoot });
    const ws = await mgr.prepare("t-d", repo);

    // After prepare: home must exist and be bare
    const { stdout: bareOut } = await execFile(
      "git",
      ["rev-parse", "--is-bare-repository"],
      { cwd: homePath },
    );
    assert.equal(
      bareOut.trim(),
      "true",
      "home must be a bare repository after prepare",
    );

    // Workspace is a usable non-bare checkout
    assert.equal(ws.branch, "kanthord/t-d");
    assert.ok(ws.baseCommit.length >= 7, "baseCommit must be a git sha");
  });
});

// ---------------------------------------------------------------------------
// EPIC 007.11 Story D — existing-home migration policy
//
// A non-bare home (root-checkout) is the "unexpected" shape — the policy must
// refuse it with a clear WorkspacePreparationError (never silently accept or
// convert a non-bare checkout). A bare home is untouched and succeeds.
// RED today: the code accepts non-bare root-checkout homes silently.
// ---------------------------------------------------------------------------
describe("LocalWorkspaceManager — 007.11 D: existing-home migration policy", () => {
  let tmpRoot: string;
  let seedDir: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-0711d-"));
    seedDir = join(tmpRoot, "seed.git");
    await createSeedRepo(seedDir);
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("(a) non-bare clean home is refused (WorkspacePreparationError)", async () => {
    const homePath = join(tmpRoot, "home-a");
    const wsRoot = join(tmpRoot, "ws-a");
    await mkdir(wsRoot, { recursive: true });

    // Create a non-bare git repo (root-checkout) at homePath, with matching origin
    await execFile("git", ["clone", `file://${seedDir}`, homePath]);

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    await assert.rejects(
      () => mgr.prepare("t-d-a", repo),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          `must be WorkspacePreparationError; got: ${String(err)}`,
        );
        assert.ok(
          err.message.includes(homePath),
          `message must name the home path: ${err.message}`,
        );
        assert.ok(
          err.message.toLowerCase().includes("bare") ||
            err.message.toLowerCase().includes("recreate") ||
            err.message.toLowerCase().includes("remove"),
          `message must mention bare/recreate/remove: ${err.message}`,
        );
        return true;
      },
    );

    // Home must still exist (not deleted)
    const { stdout: lsOut } = await execFile("ls", [homePath]);
    assert.ok(
      lsOut.includes("README.md"),
      "non-bare home must still exist after refusal",
    );
  });

  test("(b) non-bare dirty home is refused; dirty file preserved", async () => {
    const homePath = join(tmpRoot, "home-b");
    const wsRoot = join(tmpRoot, "ws-b");
    await mkdir(wsRoot, { recursive: true });

    // Create a non-bare git repo at homePath
    await execFile("git", ["clone", `file://${seedDir}`, homePath]);

    // Create a dirty file in the working tree (untracked, not committed)
    await writeFile(join(homePath, "dirty-local.txt"), "local changes");

    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });

    await assert.rejects(
      () => mgr.prepare("t-d-b", repo),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          `must be WorkspacePreparationError; got: ${String(err)}`,
        );
        return true;
      },
    );

    // The dirty file must still be present (home not modified)
    const dirtyContent = await readFile(
      join(homePath, "dirty-local.txt"),
      "utf8",
    ).catch(() => null);
    assert.equal(
      dirtyContent,
      "local changes",
      "dirty file must be preserved after refusal",
    );
  });

  test("(c) bare home is untouched, prepare succeeds", async () => {
    const homePath = join(tmpRoot, "home-c");
    const wsRoot = join(tmpRoot, "ws-c");
    await mkdir(wsRoot, { recursive: true });

    // First prepare creates a bare home
    const repo = makeRepo(homePath, "main", `file://${seedDir}`);
    const mgr = new LocalWorkspaceManager({ root: wsRoot });
    await mgr.prepare("t-d-c1", repo);

    // Record the bare home's main SHA
    const mainShaBefore = await git(homePath, "rev-parse", "refs/heads/main");

    // Second prepare — bare home must be untouched, succeeds
    const mgr2 = new LocalWorkspaceManager({ root: wsRoot });
    const ws = await mgr2.prepare("t-d-c2", repo);

    // Bare home ref is unchanged
    const mainShaAfter = await git(homePath, "rev-parse", "refs/heads/main");
    assert.equal(
      mainShaAfter,
      mainShaBefore,
      "bare home main ref must be unchanged",
    );

    // Workspace is usable
    assert.equal(ws.branch, "kanthord/t-d-c2");
    assert.ok(ws.baseCommit.length >= 7, "baseCommit must be a git sha");
  });
});
