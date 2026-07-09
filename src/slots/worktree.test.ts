/**
 * Tests for src/slots/worktree
 * Story 001 — Repo Slots & Worktrees
 * Task T2 — Worktree lifecycle + lease-capped concurrency
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import {
  dispatchWorktree,
  completeWorktree,
  parkWorktree,
  WorktreeConflictError,
  WorktreeRemoveError,
  _resetLeases,
  type WorktreeDispatchOpts,
  type RunWorktreeGitFn,
} from "./worktree.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create and init a temporary git repo with an initial commit. */
async function makeTempGitRepo(base: string): Promise<string> {
  const repoDir = join(base, "repo");
  await mkdir(repoDir, { recursive: true });
  execSync("git init -q", { cwd: repoDir });
  execSync('git config user.email "t@t.com"', { cwd: repoDir });
  execSync('git config user.name "T"', { cwd: repoDir });
  // Create an initial commit so the repo has a HEAD reference
  execSync("git commit --allow-empty -m init -q", { cwd: repoDir });
  return repoDir;
}

/**
 * Fake RunWorktreeGitFn that shells out to real git.
 * Tests that verify real worktree filesystem behaviour use this.
 */
const realGit: RunWorktreeGitFn = async (args, opts) => {
  const { cwd } = opts;
  try {
    const out = execSync(`git ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { kind: "success", stdout: out, stderr: "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return {
      kind: "terminal",
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/slots/worktree", () => {
  // -------------------------------------------------------------------------
  // (a) dispatch creates worktree on sanitized branch; complete removes worktree,
  //     branch survives
  // -------------------------------------------------------------------------

  describe("dispatchWorktree + completeWorktree — lifecycle", () => {
    test("dispatch creates a worktree on a sanitized task-named branch", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-a1-"));
      try {
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const opts: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId: "task/abc-123",
          runGit: realGit,
        };

        const result = await dispatchWorktree(opts);

        // The worktree directory must exist
        const { statSync } = await import("node:fs");
        assert.ok(
          statSync(result.worktreePath).isDirectory(),
          "worktree directory must exist",
        );

        // Branch name must be sanitized (no slashes)
        assert.match(result.branchName, /^[a-zA-Z0-9_.-]+$/, "branch name must be sanitized");
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    test("completeWorktree removes the worktree directory but the branch survives", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-a2-"));
      try {
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const opts: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId: "task-complete-test",
          runGit: realGit,
        };

        const dispatched = await dispatchWorktree(opts);
        await completeWorktree({ ...dispatched, repoPath, runGit: realGit });

        // Worktree directory must be gone
        const { existsSync } = await import("node:fs");
        assert.ok(
          !existsSync(dispatched.worktreePath),
          "worktree directory must be removed on complete",
        );

        // Branch must still exist in the repo
        const branchOut = execSync(
          `git branch --list ${dispatched.branchName}`,
          { cwd: repoPath, encoding: "utf8" },
        );
        assert.ok(
          branchOut.includes(dispatched.branchName),
          "branch must survive worktree removal",
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (b) parkWorktree keeps the worktree with uncommitted file intact
  // -------------------------------------------------------------------------

  describe("parkWorktree — keeps worktree", () => {
    test("parking keeps the worktree directory and uncommitted changes intact", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-b-"));
      try {
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const opts: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId: "task-park-test",
          runGit: realGit,
        };

        const dispatched = await dispatchWorktree(opts);

        // Write an uncommitted file in the worktree
        const uncommittedFile = join(dispatched.worktreePath, "wip.txt");
        await writeFile(uncommittedFile, "work in progress", "utf8");

        await parkWorktree({ ...dispatched, repoPath, runGit: realGit });

        // Worktree directory must still exist
        const { existsSync } = await import("node:fs");
        assert.ok(
          existsSync(dispatched.worktreePath),
          "worktree directory must survive park",
        );

        // Uncommitted file must still be there
        assert.ok(
          existsSync(uncommittedFile),
          "uncommitted file must survive park",
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (c) max_concurrent_tasks: 1 serializes two tasks via the lease
  // -------------------------------------------------------------------------

  describe("dispatchWorktree — lease concurrency cap", () => {
    test("second dispatch on a slot with max_concurrent_tasks:1 waits until first releases", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-c-"));
      try {
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const slotCapabilityKey = "slot:" + repoPath;

        // Dispatch task-1, occupying the single slot
        const opts1: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId: "task-1",
          slotCapabilityKey,
          maxConcurrentTasks: 1,
          runGit: realGit,
        };
        await dispatchWorktree(opts1);

        // Dispatch task-2 — slot is full; must not create a worktree
        const opts2: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId: "task-2",
          slotCapabilityKey,
          maxConcurrentTasks: 1,
          runGit: realGit,
        };
        const result2 = await dispatchWorktree(opts2);
        assert.strictEqual(
          result2.queued,
          true,
          "second dispatch must be queued (not dispatched) when slot is full",
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (d) re-dispatch after a simulated crash reuses/recreates same worktree
  // -------------------------------------------------------------------------

  describe("dispatchWorktree — crash re-dispatch idempotency", () => {
    test("re-dispatching the same taskId after a crash does not throw and reuses the worktree", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-d-"));
      try {
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const opts: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId: "task-crash",
          runGit: realGit,
        };

        const first = await dispatchWorktree(opts);

        // Simulate crash: do NOT call completeWorktree; dispatch again
        const second = await dispatchWorktree(opts);

        // Must not throw; the worktree path must be the same
        assert.strictEqual(
          second.worktreePath,
          first.worktreePath,
          "re-dispatch must reuse the same worktree path",
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (e) foreign same-name branch is a typed WorktreeConflictError
  // -------------------------------------------------------------------------

  describe("dispatchWorktree — foreign branch collision", () => {
    test("a pre-existing branch owned by a different task is a WorktreeConflictError", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-e-"));
      try {
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const taskId = "task-collision";

        // Manually create the branch in the repo as if owned by someone else
        const branchName = taskId.replace(/[^a-zA-Z0-9._-]/g, "-");
        execSync(`git branch ${branchName}`, { cwd: repoPath });

        // Dispatch with a fake git that has no active worktree record for this task
        const opts: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId,
          runGit: realGit,
          // No prior dispatch record => foreign branch
          treatExistingBranchAsConflict: true,
        };

        await assert.rejects(
          () => dispatchWorktree(opts),
          (err: unknown) => {
            assert.ok(
              err instanceof WorktreeConflictError,
              `must throw WorktreeConflictError; got ${String(err)}`,
            );
            return true;
          },
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (f) blocked removal is a typed WorktreeRemoveError + escalation signal
  // -------------------------------------------------------------------------

  describe("completeWorktree — blocked removal", () => {
    test("a failed worktree removal throws WorktreeRemoveError (not a silent force-delete)", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-f-"));
      try {
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const opts: WorktreeDispatchOpts = {
          repoPath,
          worktreesBase,
          taskId: "task-blocked",
          runGit: realGit,
        };

        const dispatched = await dispatchWorktree(opts);

        // Inject a failing git seam that simulates a locked/dirty worktree
        const failingGit: RunWorktreeGitFn = async (args) => {
          if (args[0] === "worktree" && args[1] === "remove") {
            return {
              kind: "terminal",
              stdout: "",
              stderr: "fatal: worktree is dirty, refusing to remove",
            };
          }
          return realGit(args, { cwd: repoPath });
        };

        await assert.rejects(
          () =>
            completeWorktree({
              ...dispatched,
              repoPath,
              runGit: failingGit,
            }),
          (err: unknown) => {
            assert.ok(
              err instanceof WorktreeRemoveError,
              `must throw WorktreeRemoveError; got ${String(err)}`,
            );
            return true;
          },
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // (g) completeWorktree releases the lease so a subsequent task can dispatch
  // -------------------------------------------------------------------------

  describe("completeWorktree — releases lease", () => {
    test("completing a task releases the slot lease so the next task dispatches (not queued)", async () => {
      const base = await mkdtemp(join(tmpdir(), "kwt-t2-g-"));
      try {
        _resetLeases();
        const repoPath = await makeTempGitRepo(base);
        const worktreesBase = join(base, "worktrees");
        await mkdir(worktreesBase, { recursive: true });

        const slotCapabilityKey = "slot:release-test:" + repoPath;

        // Dispatch task-1, occupying the single slot
        const dispatched1 = await dispatchWorktree({
          repoPath,
          worktreesBase,
          taskId: "task-release-1",
          slotCapabilityKey,
          maxConcurrentTasks: 1,
          runGit: realGit,
        });
        assert.strictEqual(dispatched1.queued, false, "task-1 must dispatch (not queued)");

        // Complete task-1 — must release the lease
        await completeWorktree({ ...dispatched1, repoPath, runGit: realGit, slotCapabilityKey, taskId: "task-release-1" });

        // Dispatch task-2 — slot should now be free
        const dispatched2 = await dispatchWorktree({
          repoPath,
          worktreesBase,
          taskId: "task-release-2",
          slotCapabilityKey,
          maxConcurrentTasks: 1,
          runGit: realGit,
        });
        assert.strictEqual(
          dispatched2.queued,
          false,
          "task-2 must not be queued after task-1 completion released the lease",
        );
      } finally {
        _resetLeases();
        await rm(base, { recursive: true, force: true });
      }
    });
  });
});
