import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  open,
  readdir,
  rm,
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
    await execFile("git", ["clone", `file://${seedDir}`, homePath]);

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

    // T4: clone from file:// so origin = file://${seedDir}; repo.remoteUrl is the
    // default github stub → mismatch without needing a separate differentUrl var.
    await execFile("git", ["clone", `file://${seedDir}`, homePath]);

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
  async function cloneAndCfg(from: string, to: string): Promise<void> {
    await execFile("git", ["clone", `file://${from}`, to]);
    await execFile("git", ["config", "user.email", "test@localhost"], {
      cwd: to,
    });
    await execFile("git", ["config", "user.name", "Test"], { cwd: to });
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
      await cloneAndCfg(originDir, homeDir);

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
      await cloneAndCfg(originDir, homeDir);
      // homeDir is AHEAD of origin (simulates a local landing)
      const c2Sha = await addAndCommit(
        homeDir,
        "landed.txt",
        "landed",
        "local-landed",
      );

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
      await cloneAndCfg(originDir, homeDir);

      // diverge both sides from c1 (the shared base)
      await addAndCommit(homeDir, "local.txt", "local", "home-only");
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
      await cloneAndCfg(originDir, homeDir);

      // diverge both sides
      await addAndCommit(homeDir, "local.txt", "local", "home-only");
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
      await cloneAndCfg(originDir, homeDir);

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
      await cloneAndCfg(originDir, homeDir);

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

  test("(b) prepare-fetch and a land serialize on the shared lock (one waits; both complete; no orphan .lock)", async () => {
    const dbDir = join(tmpRoot, "db-b");
    await mkdir(dbDir, { recursive: true });
    const dbPath = join(dbDir, "kanthord.db");
    const deps = buildDeps(dbPath);
    const mgr = deps.workspaces;
    const repo = makeRepo(homeDir, "main", `file://${seedDir}`);

    // A clone of the home used purely as the candidate's workspace source so
    // `land`'s fetch is a normal local fetch.
    const wsClone = join(tmpRoot, "wsclone-b");
    await execFile("git", ["clone", `file://${seedDir}`, wsClone]);

    // already-landed candidate: candidateSHA == current main HEAD, target == main.
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
    const pLand = deps.repoLanding.land(homeDir, candidate).then(
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
    assert.equal(
      landSettled,
      false,
      "land must block on the shared lock while it is held",
    );

    // Release the lock; both must now complete (one waits for the other).
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
