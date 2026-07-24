/**
 * EPIC 007.13 Story A — GitRepositoryPublisher adapter.
 *
 * All git-facing tests use real git in temp dirs (file:// bare remotes, no
 * network). Each test is hermetic: creates its own mkdtemp dir and removes it
 * in finally.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { GitRepositoryPublisher } from "./git.ts";
import { PublishDivergedError } from "./port.ts";

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

async function initBare(dir: string): Promise<void> {
  await execFile("git", ["init", "-q", "--bare", "-b", "main", dir]);
}

/** Clones `bareDir`, commits a file, pushes back to `bareDir` main. Returns new HEAD SHA. */
async function commitAndPush(
  bareDir: string,
  scratchDir: string,
  filename: string,
  content: string,
): Promise<string> {
  await execFile("git", ["clone", "-q", bareDir, scratchDir]);
  await execFile("git", ["config", "user.email", "test@localhost"], {
    cwd: scratchDir,
  });
  await execFile("git", ["config", "user.name", "Test"], { cwd: scratchDir });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(scratchDir, filename), content);
  await execFile("git", ["add", filename], { cwd: scratchDir });
  await execFile("git", ["commit", "-q", "-m", `add ${filename}`], {
    cwd: scratchDir,
  });
  await execFile("git", ["push", "-q", "origin", "HEAD:main"], {
    cwd: scratchDir,
  });
  return git(scratchDir, "rev-parse", "HEAD");
}

test("GitRepositoryPublisher: fast-forward push advances the remote ref to the local (home) tip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-pub-"));
  try {
    const remoteDir = join(dir, "remote.git");
    const homeDir = join(dir, "home.git");
    await initBare(remoteDir);
    await initBare(homeDir);

    // Seed remote with a base commit.
    const base = await commitAndPush(
      remoteDir,
      join(dir, "seed"),
      "base.txt",
      "base\n",
    );

    // Home starts from the same base, then gets an additional local commit —
    // home is ahead of the remote by one commit.
    const homeHead = await commitAndPush(
      homeDir,
      join(dir, "home-seed"),
      "landed.txt",
      "landed\n",
    );
    assert.notEqual(homeHead, base);

    const publisher = new GitRepositoryPublisher();
    const result = await publisher.publish({
      homeDir,
      branch: "main",
      remoteUrl: `file://${remoteDir}`,
      auth: { kind: "ambient" },
      expectedRemoteOID: base,
    });

    assert.equal(result.pushedOID, homeHead);
    assert.equal(result.remoteOID, homeHead);

    const remoteTip = await git(remoteDir, "rev-parse", "main");
    assert.equal(remoteTip, homeHead);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("GitRepositoryPublisher: diverged remote throws PublishDivergedError carrying the remote OID and does not overwrite the remote", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-pub-"));
  try {
    const remoteDir = join(dir, "remote.git");
    const homeDir = join(dir, "home.git");
    await initBare(remoteDir);
    await initBare(homeDir);

    const base = await commitAndPush(
      remoteDir,
      join(dir, "seed"),
      "base.txt",
      "base\n",
    );

    // Home advances with its own commit (unknown to the remote's future state).
    const homeHead = await commitAndPush(
      homeDir,
      join(dir, "home-seed"),
      "landed.txt",
      "landed\n",
    );

    // Meanwhile someone else pushes a different, divergent commit straight to
    // the remote — remote is now ahead of what publish() believes it is
    // (`expectedRemoteOID: base` is now stale).
    const divergedRemoteTip = await commitAndPush(
      remoteDir,
      join(dir, "other-seed"),
      "other.txt",
      "other\n",
    );
    assert.notEqual(divergedRemoteTip, base);

    const publisher = new GitRepositoryPublisher();

    await assert.rejects(
      () =>
        publisher.publish({
          homeDir,
          branch: "main",
          remoteUrl: `file://${remoteDir}`,
          auth: { kind: "ambient" },
          expectedRemoteOID: base,
        }),
      (err: unknown) => {
        assert.ok(err instanceof PublishDivergedError);
        assert.equal(err.remoteOID, divergedRemoteTip);
        return true;
      },
    );

    // Remote history must not have been rewritten/force-pushed.
    const remoteTipAfter = await git(remoteDir, "rev-parse", "main");
    assert.equal(remoteTipAfter, divergedRemoteTip);
    assert.notEqual(remoteTipAfter, homeHead);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("GitRepositoryPublisher: auth 'ambient' pushes to a writable file:// remote without askpass wiring", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-pub-"));
  try {
    const remoteDir = join(dir, "remote.git");
    const homeDir = join(dir, "home.git");
    await initBare(remoteDir);
    await initBare(homeDir);

    const homeHead = await commitAndPush(
      homeDir,
      join(dir, "home-seed"),
      "landed.txt",
      "landed\n",
    );

    // No resolveCredential is wired — ambient auth must not need one.
    const publisher = new GitRepositoryPublisher();
    const result = await publisher.publish({
      homeDir,
      branch: "main",
      remoteUrl: `file://${remoteDir}`,
      auth: { kind: "ambient" },
      expectedRemoteOID: null,
    });

    assert.equal(result.pushedOID, homeHead);
    assert.equal(result.remoteOID, homeHead);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
