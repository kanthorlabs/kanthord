/**
 * 2A golden scenario — tdd@1 feature end-to-end on 2A bricks.
 * Story 001 T1 (Epic 019).
 *
 * Wires: real GitStore (Epic 012), real git verb adapters on a temp bare remote
 * (Epic 014), github.create_pr against an in-process double (Epic 015), and
 * the pi session adapter on FakePiSurface (Epic 016). Asserts the Phase-1
 * outcome fields (same shape as golden.test.ts) to prove brick substitution
 * kept the seams intact.
 */

// MUST be the first import — installs the no-network + credential guard before
// any SUT module loads (Story 001 AC, PRD §7.7).
import "../no-network-guard.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { run2aGoldenScenario } from "./2a-golden.ts";
import { harness } from "../harness.ts";
import { GitStore } from "../../store/git-store.ts";
import type { GithubHttpSeam } from "../../broker/verbs/github-create-pr.ts";
import type { FakePiSurface, PiSessionHandle } from "../../agent/pi-session.ts";

// ---------------------------------------------------------------------------
// 2A doubles — minimal, deterministic, zero-network
// ---------------------------------------------------------------------------

let githubCreatePrCallCount = 0;
const githubDouble: GithubHttpSeam = {
  async createPr(_path, _headers, _body) {
    githubCreatePrCallCount++;
    return { status: 201 as const, number: 42, url: "https://github.com/org/repo/pull/42" };
  },
  async getPr(_path, _headers) {
    return {
      number: 42,
      state: "open" as const,
      url: "https://github.com/org/repo/pull/42",
      merged: false,
    };
  },
  async listByHead(_path, _headers) {
    return [];
  },
};

let piSpawnAgentCallCount = 0;
const fakePiSurface: FakePiSurface = {
  spawnAgent(_opts): PiSessionHandle {
    piSpawnAgentCallCount++;
    return {
      abort(): void {},
      waitForIdle(): Promise<void> {
        return Promise.resolve();
      },
      reset(): void {},
      contextTokens: 100,
    };
  },
};

// ---------------------------------------------------------------------------
// Suite: src/harness/scenarios/2a-golden
// ---------------------------------------------------------------------------

test(
  "2A golden tdd@1 feature reaches complete with real git store and verb adapters",
  async () => {
    const h = await harness();

    // Temp bare remote for git.push verb
    const bareDir = await mkdtemp(join(tmpdir(), "k2a-bare-"));
    execFileSync("git", ["init", "--bare", "-b", "main"], {
      cwd: bareDir,
      stdio: "pipe",
    });

    // Real git-backed store (Epic 012)
    const gsDir = await mkdtemp(join(tmpdir(), "k2a-gs-"));
    const gitStore = new GitStore(gsDir);
    await gitStore.open();

    try {
      const result = await run2aGoldenScenario({
        clock: h.clock,
        store: h.store,
        gitWorkDir: h.gitRepo.dir,
        bareRemoteDir: bareDir,
        gitStore,
        githubDouble,
        piSurface: fakePiSurface,
      });

      assert.equal(
        result.status,
        "complete",
        "2A golden must reach feature-complete with 2A bricks — fake clock and fault injection retained",
      );
      assert.equal(
        result.brokerCompletionStatus,
        "done",
        "successful broker path must write a done completion row",
      );
      assert.equal(
        result.brokerCompletionResultJson,
        JSON.stringify({ ok: true }),
        "done completion row must persist result_json",
      );
      assert.ok(
        result.schedulerWakeupTaskIds.includes("task-alpha"),
        "scheduler resume must wake the task parked on the successful broker op",
      );
      assert.deepEqual(
        result.deployDispatches.map((d) => [d.taskId, d.outcome]),
        [
          ["feat-001-deploy-staging", "pass"],
          ["feat-001-deploy-production", "pass"],
        ],
        "deploy stages must be dispatched and passed through pollOnce lifecycle",
      );
      assert.deepEqual(
        result.deployEvents,
        [
          { event: "notify_human", stageId: "feat-001-deploy-staging" },
          { event: "notify_human", stageId: "feat-001-deploy-production" },
        ],
        "passing deploy stages must emit scheduler lifecycle wakeup events",
      );

      // --- 2A brick assertions (golden-brick-gap blocker) ---
      // Epic 015: github double must record at least one createPr call
      assert.ok(
        githubCreatePrCallCount >= 1,
        "github double must record at least one createPr call (Epic 015 brick driven)",
      );

      // Epic 016: pi surface must record at least one spawnAgent call
      assert.ok(
        piSpawnAgentCallCount >= 1,
        "pi surface must record at least one spawnAgent call (Epic 016 brick driven)",
      );

      // Epic 014: bare remote must have received at least one pushed ref
      const lsRemoteOut = execFileSync(
        "git",
        ["ls-remote", "--refs", bareDir],
        { stdio: "pipe" },
      )
        .toString()
        .trim();
      assert.ok(
        lsRemoteOut.length > 0,
        "bare remote must have at least one ref — git.push must have run (Epic 014 brick driven)",
      );
    } finally {
      await h[Symbol.asyncDispose]();
      await gitStore.close();
      await rm(bareDir, { recursive: true, force: true });
      await rm(gsDir, { recursive: true, force: true });
    }
  },
);
