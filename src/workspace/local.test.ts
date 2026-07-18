import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { WorkspacePreparationError } from "./port.ts";
import type { Workspace } from "./port.ts";
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

function makeRepo(path: string, branch = "main"): Repository {
  return {
    id: "repo-1",
    type: "repository",
    name: "sandbox",
    organization: "kanthorlabs",
    branch,
    path,
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

    const repo = makeRepo(homePath);
    const mgr = new LocalWorkspaceManager({
      root: wsRoot,
      buildRemoteUrl: () => seedDir,
    });

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
      seedDir,
      "home origin must be the built URL",
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

    // Pre-seed the home by cloning the seed repo
    await execFile("git", ["clone", seedDir, homePath]);

    const repo = makeRepo(homePath);
    const mgr = new LocalWorkspaceManager({
      root: wsRoot,
      buildRemoteUrl: () => seedDir,
    });

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

    // Clone from seed but build URL will return a different path
    await execFile("git", ["clone", seedDir, homePath]);
    const differentUrl = join(tmpRoot, "other-origin");

    const repo = makeRepo(homePath);
    const mgr = new LocalWorkspaceManager({
      root: wsRoot,
      buildRemoteUrl: () => differentUrl,
    });

    await assert.rejects(
      () => mgr.prepare("t3", repo),
      (err: unknown) => {
        assert.ok(
          err instanceof WorkspacePreparationError,
          "must be WorkspacePreparationError",
        );
        assert.ok(
          err.message.includes(differentUrl),
          `message must include expected URL: ${err.message}`,
        );
        assert.ok(
          err.message.includes(seedDir),
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

    const repo = makeRepo(homePath);
    const mgr = new LocalWorkspaceManager({
      root: wsRoot,
      buildRemoteUrl: () => seedDir,
    });

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

    // repo branch 'nonexistent' does not exist in seed
    const repo = makeRepo(homePath, "nonexistent");
    const mgr = new LocalWorkspaceManager({
      root: wsRoot,
      buildRemoteUrl: () => seedDir,
    });

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
