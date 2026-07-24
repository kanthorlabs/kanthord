// EPIC 007.12 Story C — daemon-only broker: real git bare home + isolated clone.
// Hermetic: creates its own mkdtemp dir, no network (file:// / local paths only).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { GitObjectiveBroker } from "./git.ts";
import { LandingCASMismatchError } from "../landing/port.ts";

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

describe("GitObjectiveBroker — 007.12 Story C: daemon-only home integration", () => {
  let tmpRoot: string;

  before(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-0712c-"));
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("fetch pulls the objective commit into home without moving any ref; countCommitsSince validates exactly one commit; casUpdateRef advances the branch and rejects a stale expectedOld with LandingCASMismatchError", async () => {
    const homeDir = join(tmpRoot, "home.git");
    const cloneDir = join(tmpRoot, "clone");
    const seedDir = join(tmpRoot, "seed");

    await mkdir(homeDir, { recursive: true });
    await execFile("git", ["init", "-q", "--bare", "-b", "main"], {
      cwd: homeDir,
    });

    // Seed home with an initial commit via a scratch working clone.
    await execFile("git", ["clone", "-q", homeDir, seedDir]);
    await writeFile(join(seedDir, "base.txt"), "base\n");
    await git(seedDir, "add", "-A");
    await git(
      seedDir,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-m",
      "init",
    );
    await git(seedDir, "push", "-q", "origin", "HEAD:main");
    const parentOid = await git(homeDir, "rev-parse", "refs/heads/main");

    // Initiative branch created in home at the integration tip (Story A).
    await git(
      homeDir,
      "update-ref",
      "refs/heads/kanthord/init/init-c",
      parentOid,
    );

    // Isolated clone on the initiative branch, no origin (mirrors Story A).
    await execFile("git", [
      "clone",
      "-q",
      "--no-hardlinks",
      "--single-branch",
      "--branch",
      "kanthord/init/init-c",
      homeDir,
      cloneDir,
    ]);
    await execFile("git", ["remote", "remove", "origin"], { cwd: cloneDir });
    await writeFile(join(cloneDir, "obj-a.txt"), "objective a\n");
    await git(cloneDir, "add", "-A");
    await git(
      cloneDir,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-m",
      "objective a",
    );
    const objectiveOid = await git(cloneDir, "rev-parse", "HEAD");

    const broker = new GitObjectiveBroker();

    await broker.fetch(homeDir, cloneDir, objectiveOid);
    const branchAfterFetch = await git(
      homeDir,
      "rev-parse",
      "refs/heads/kanthord/init/init-c",
    );
    assert.equal(
      branchAfterFetch,
      parentOid,
      "fetch must only bring objects into home, not move any ref",
    );

    const count = await broker.countCommitsSince(
      homeDir,
      parentOid,
      objectiveOid,
    );
    assert.equal(
      count,
      1,
      "exactly one commit must exist between parentOid and the fetched objective commit",
    );

    await broker.casUpdateRef(
      homeDir,
      "refs/heads/kanthord/init/init-c",
      objectiveOid,
      parentOid,
    );
    const branchAfterCas = await git(
      homeDir,
      "rev-parse",
      "refs/heads/kanthord/init/init-c",
    );
    assert.equal(
      branchAfterCas,
      objectiveOid,
      "CAS update-ref must advance the initiative branch to the objective commit",
    );

    // Stale CAS: expectedOld (parentOid) no longer matches the ref's current value (objectiveOid).
    await assert.rejects(
      () =>
        broker.casUpdateRef(
          homeDir,
          "refs/heads/kanthord/init/init-c",
          objectiveOid,
          parentOid,
        ),
      LandingCASMismatchError,
      "a stale expectedOld must be rejected with LandingCASMismatchError",
    );
  });
});
