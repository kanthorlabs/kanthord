/**
 * src/daemon/commits-ahead — RED test (Story 003 / Task T1)
 *
 * Builds a real temp git repo to verify the makeCommitsAhead factory.
 * No network: all git calls go to a local temp repo.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeCommitsAhead } from "./commits-ahead.ts";
import { runGit as execRunGit } from "../git/exec.ts";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<void> {
  await exec("git", args, { cwd });
}

describe("src/daemon/commits-ahead", () => {
  let tmpDir: string;
  let repoDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "commits-ahead-test-"));
    repoDir = join(tmpDir, "repo");
    await exec("git", ["init", "--initial-branch=main", repoDir], { cwd: tmpDir });
    await git(["config", "user.email", "test@test.com"], repoDir);
    await git(["config", "user.name", "Test"], repoDir);
    // base commit on main
    await git(["commit", "--allow-empty", "-m", "base"], repoDir);
    // task branch with 2 extra commits
    await git(["checkout", "-b", "task/feature-1"], repoDir);
    await git(["commit", "--allow-empty", "-m", "commit 1"], repoDir);
    await git(["commit", "--allow-empty", "-m", "commit 2"], repoDir);
    // return to main for the empty-branch test
    await git(["checkout", "main"], repoDir);
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("task branch with 2 extra commits returns 2", async () => {
    const commitsAhead = makeCommitsAhead({ cwd: repoDir, runGit: execRunGit });
    const count = await commitsAhead("task/feature-1", "main");
    assert.equal(count, 2);
  });

  it("fresh branch off base with no extra commits returns 0", async () => {
    await git(["checkout", "-b", "task/empty"], repoDir);
    await git(["checkout", "main"], repoDir);
    const commitsAhead = makeCommitsAhead({ cwd: repoDir, runGit: execRunGit });
    const count = await commitsAhead("task/empty", "main");
    assert.equal(count, 0);
  });

  it("non-existent branch rejects with a typed error (not 0)", async () => {
    const commitsAhead = makeCommitsAhead({ cwd: repoDir, runGit: execRunGit });
    await assert.rejects(
      () => commitsAhead("no-such-branch", "main"),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must be an Error");
        assert.strictEqual(
          (err as NodeJS.ErrnoException).code,
          "GIT_REVLIST_FAILED",
          "thrown error code must be GIT_REVLIST_FAILED",
        );
        return true;
      },
    );
  });
});
