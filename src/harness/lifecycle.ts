/**
 * Lifecycle scenarios — Story 002 T1 (Epic 010).
 *
 * Composes harness kit + Epic 004/005/009 seams to realize two named scenarios:
 *   1. Lease expiry + heartbeat lapse → waiter dispatches on reclaimed capability.
 *   2. Kill/restart + ledger reconciliation → field-by-field respawn-equivalence.
 */

import type { HarnessFixture } from "./harness.ts";
import { LeaseManager } from "../scheduler/leases.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { bootDaemon } from "../daemon/boot.ts";
import {
  shouldTriggerThreshold,
  respawnCoordinator,
} from "../session/respawn.ts";
import {
  pinGeneration,
  getPinnedGeneration,
  dispatchableForGeneration,
} from "../scheduler/generation.ts";
import { loadTasks } from "../scheduler/dispatch.ts";
import { compile } from "../compiler/compile.ts";
import { submit, getInFlightOp } from "../broker/submit.ts";
import { startPolling } from "../broker/poller.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Lease expiry scenario
// ---------------------------------------------------------------------------

/**
 * Scenario: task-alpha holds a resource lease; its heartbeat lapses; the fake
 * clock advances past the 30 s TTL; task-beta reclaims the capability.
 *
 * Synchronous — all operations are in-memory SQLite + fake clock.
 */
export function runLeaseExpiryScenario(
  h: HarnessFixture,
): { waiterDispatched: boolean } {
  const lm = new LeaseManager(h.store, h.clock);
  const cap = { kind: "resource" as const, key: "lifecycle-test-resource" };

  // task-alpha acquires the capability; must succeed.
  if (!lm.acquire("task-alpha", [cap])) {
    return { waiterDispatched: false };
  }

  // task-beta cannot acquire while task-alpha holds the lease.
  if (lm.acquire("task-beta", [cap])) {
    return { waiterDispatched: false };
  }

  // Advance the clock past the 30 s TTL (no heartbeat → lease expires).
  h.clock.advance(30_001);

  // task-beta reclaims the now-expired capability.
  const waiterDispatched = lm.acquire("task-beta", [cap]);
  return { waiterDispatched };
}

// ---------------------------------------------------------------------------
// Kill/restart scenario
// ---------------------------------------------------------------------------

/**
 * Scenario: daemon has one in-flight ledger op and a STATE file when killed;
 * on restart, boot recovers pending-task count, current phase (from STATE),
 * and ledger op (as needs_reconciliation) — field-by-field.
 */
export async function runKillRestartScenario(
  h: HarnessFixture,
): Promise<{ pendingTaskCount: number; currentPhase: string; reconciledOps: number }> {
  const featureDir = await mkdtemp(join(tmpdir(), "klifecycle-"));
  try {
    const storyId = "001-story-a";
    const taskStem = "001-task-x";
    const storyDir = join(featureDir, storyId);
    await mkdir(storyDir, { recursive: true });

    // Task file — walkFeature classifies any *.md (non-special name) as "task".
    await writeFile(join(storyDir, `${taskStem}.md`), "# task\n", "utf8");

    // Write in-flight ledger entry; recoverFromLedger remaps it → needs_reconciliation.
    const featureStore = new FeatureStore(featureDir);
    await featureStore.appendJournal(storyId, taskStem, {
      op_id: "op-001",
      verb: "run",
      idempotency_key: "ik-001",
      correlation: "corr-001",
      desired_effect_hash: "hash-001",
      status: "in_flight",
    });

    // STATE file with current_phase — boot reads this when reconciledOps >= 1.
    await featureStore.writeState(storyId, taskStem, "current_phase: planning\n");

    // Capturing logger — records the recovery-summary event fields.
    let summary: Record<string, unknown> | undefined;
    const logger = {
      info(record: Record<string, unknown>): void {
        if (record["event"] === "recovery-summary") {
          summary = record;
        }
      },
    };

    const lifecycle = bootDaemon({
      featureDir,
      clock: h.clock,
      store: h.store,
      logger,
      compileOpts: { repoRegistry: ["backend"] },
    });
    await lifecycle.restart();

    // Extract fields from the captured recovery-summary log record.
    const rawPending = summary?.["pendingTaskCount"];
    const pendingTaskCount = typeof rawPending === "number" ? rawPending : 0;
    const rawPhase = summary?.["currentPhase"];
    const currentPhase = typeof rawPhase === "string" ? rawPhase : "";
    const rawOps = summary?.["reconciledOps"];
    const reconciledOps = typeof rawOps === "number" ? rawOps : 0;

    return { pendingTaskCount, currentPhase, reconciledOps };
  } finally {
    await rm(featureDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Compaction respawn scenario
// ---------------------------------------------------------------------------

const RESPAWN_EPIC_MD =
  "---\nid: feat-respawn\nrepo: backend\nticket_system: jira\nticket: JIRA-R-001\n---\n\n## Acceptance\n\nFeature complete.\n";

const RESPAWN_TASK_MD =
  "---\nid: task-x\nworkflow: tdd@1\nrepo: backend\nticket_system: jira\nticket: JIRA-R-101\n---\n\n## Prerequisites\n\necho setup\n\n## Inputs\n\nNothing.\n\n## Outputs\n\ntask-x-output\n\n## Tests\n\nUnit tests.\n";

/**
 * Scenario: compaction threshold fires → checkpoint → respawn; four fields
 * (pendingTaskIds, heldCapabilityKeys, currentPhase) are equal pre/post
 * (respawn-equivalence, PRD §7.7).
 */
export async function runCompactionRespawnScenario(
  h: HarnessFixture,
): Promise<{
  checkpointCalled: boolean;
  pre: { pendingTaskIds: string[]; heldCapabilityKeys: string[]; currentPhase: string };
  post: { pendingTaskIds: string[]; heldCapabilityKeys: string[]; currentPhase: string };
}> {
  const featureDir = await mkdtemp(join(tmpdir(), "krespawn-"));
  try {
    const storyId = "001-story-a";
    const taskStem = "001-task-x";
    const storyDir = join(featureDir, storyId);
    await mkdir(storyDir, { recursive: true });

    await writeFile(join(featureDir, "epic.md"), RESPAWN_EPIC_MD, "utf8");
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await writeFile(join(storyDir, "INDEX.md"), "# Story A\n", "utf8");
    await writeFile(join(storyDir, `${taskStem}.md`), RESPAWN_TASK_MD, "utf8");
    await writeFile(
      join(storyDir, `${taskStem}.state.md`),
      "current_phase: planning\n",
      "utf8",
    );
    const agentsMdPath = join(featureDir, "AGENTS.md");
    await writeFile(agentsMdPath, "# AGENTS.md\nminimal\n", "utf8");

    // Back the lease view with a real LeaseManager on h.store + h.clock so
    // the fixture parameter is genuinely used (SQLite-backed, not a stub).
    const lm = new LeaseManager(h.store, h.clock);
    lm.acquire("task-x", [{ kind: "resource" as const, key: "lifecycle-test" }]);
    const leaseView = {
      heldBy(taskId: string): string[] {
        return h.store.all<{ capability_key: string }>(
          "SELECT capability_key FROM scheduler_lease WHERE holder = ? AND expires_at >= ?",
          taskId,
          h.clock.now(),
        ).map((r) => r.capability_key);
      },
    };

    // Deterministic fake scheduler view
    const fakePendingIds = ["task-x"];
    const schedulerView = {
      pendingTaskIds(_featureId: string): string[] { return fakePendingIds; },
    };

    const pre = {
      pendingTaskIds: fakePendingIds.slice(),
      heldCapabilityKeys: leaseView.heldBy("task-x"),
      currentPhase: "planning",
    };

    let checkpointCalled = false;
    const fakeWorkflow = {
      async checkpoint(): Promise<void> { checkpointCalled = true; },
    };
    const fakeCurrentSession = {
      brief: { taskBody: "", epicBody: "", runbook: "", state: "", agentsMd: "" },
      async run(): Promise<void> {},
      teardown(): void {},
    };

    // Verify the threshold fires (100 > 50 * 1.5 = 75)
    const fires = shouldTriggerThreshold(100, { windowTokens: 50, compactionRatio: 1.5 });
    if (!fires) throw new Error("compaction respawn: threshold precondition violated");

    const featureStore = new FeatureStore(featureDir);
    const result = await respawnCoordinator({
      ctx: {
        store: featureStore,
        storyId,
        taskStem,
        agentsMdPath,
        agent: { steps: [] },
      },
      currentSession: fakeCurrentSession,
      featureId: "feat-respawn",
      taskId: "task-x",
      schedulerView,
      leaseView,
      trigger: "threshold",
      workflow: fakeWorkflow,
    });

    return {
      checkpointCalled,
      pre,
      post: {
        pendingTaskIds: result.pendingTaskIds,
        heldCapabilityKeys: result.heldCapabilityKeys,
        currentPhase: result.currentPhase,
      },
    };
  } finally {
    await rm(featureDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Dirty-plan recompile scenario
// ---------------------------------------------------------------------------

const DIRTY_EPIC_MD =
  "---\nid: feat-dirty\nrepo: backend\nticket_system: jira\nticket: JIRA-D-001\n---\n\n## Acceptance\n\nFeature complete.\n";

const DIRTY_TASK_MD =
  "---\nid: task-simple\nworkflow: tdd@1\nrepo: backend\nticket_system: jira\nticket: JIRA-D-101\n---\n\n## Prerequisites\n\necho setup\n\n## Inputs\n\nNothing.\n\n## Outputs\n\nsimple-output\n\n## Tests\n\nUnit tests.\n";

/**
 * Scenario: plan edit makes liveHash differ from compile_hash (G=1 is dirty)
 * → dispatch halted; a running task keeps its G=1 stamp; recompile mints G=2
 * → dispatch resumes for all pending tasks.
 */
export async function runDirtyPlanScenario(
  h: HarnessFixture,
): Promise<{
  dispatchableWhenDirty: string[];
  runningTaskStamp: number | null;
  recompiledGeneration: number;
  dispatchableAfterRecompile: string[];
}> {
  const featureDir = await mkdtemp(join(tmpdir(), "kdirty-"));
  try {
    await writeFile(join(featureDir, "epic.md"), DIRTY_EPIC_MD, "utf8");
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
    const storyDir = join(featureDir, "001-story-a");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, "INDEX.md"), "# Story A\n", "utf8");
    const taskPath = join(storyDir, "001-task-simple.md");
    await writeFile(taskPath, DIRTY_TASK_MD, "utf8");

    // G=1 compile + scheduler init
    await compile(featureDir, h.store, { repoRegistry: ["backend"] });
    loadTasks(h.store, "feat-dirty");

    // Pin task-simple under G=1 (simulates a running task with a stamp)
    pinGeneration(h.store, "task-simple");
    const runningTaskStamp = getPinnedGeneration(h.store, "task-simple");

    // Present a non-matching hash → plan is dirty → dispatch halted
    const dispatchableWhenDirty = dispatchableForGeneration(
      h.store,
      "feat-dirty",
      "not-the-compile-hash",
    ).map((t) => t.id);

    // Edit the task file so the hash changes on recompile
    await writeFile(taskPath, DIRTY_TASK_MD + "\n<!-- modified for G=2 -->\n", "utf8");

    // G=2 recompile
    await compile(featureDir, h.store, { repoRegistry: ["backend"] });

    // Read the new generation and its compile hash from the store
    const genRow = h.store.get<{ generation: number; compile_hash: string }>(
      "SELECT generation, compile_hash FROM plan_generation WHERE feature_id = ? ORDER BY generation DESC LIMIT 1",
      "feat-dirty",
    );
    const recompiledGeneration = genRow?.generation ?? 0;
    const newHash = genRow?.compile_hash ?? "";

    // Dispatch resumes under G+1 with the matching live hash
    const dispatchableAfterRecompile = dispatchableForGeneration(
      h.store,
      "feat-dirty",
      newHash,
    ).map((t) => t.id);

    return {
      dispatchableWhenDirty,
      runningTaskStamp,
      recompiledGeneration,
      dispatchableAfterRecompile,
    };
  } finally {
    await rm(featureDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Broker failure scenario
// ---------------------------------------------------------------------------

/**
 * Scenario: fake adapter returns "failed" on the first poll tick; the poller
 * writes a completion row with status="failed" to broker_completion.
 */
export async function runBrokerFailureScenario(
  h: HarnessFixture,
): Promise<{ completionStatus: string }> {
  const entry: VerbRegistryEntry = {
    verb: "test-fail-verb",
    tier: "auto",
    timeout: 60_000,
    idempotency: { window_ms: 0 },
    retry: { max: 3, backoff: "linear" },
    poll_interval: 1_000,
    terminal_states: ["failed", "done"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
  const adapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => "req-fail-001",
    poll_status: async (_requestId: unknown) => ({ status: "failed" }),
    reconcile: async (_ledger: unknown) => null,
  };
  const opId = await submit(entry, adapter, {}, "ik-fail-001", h.store);
  const op = getInFlightOp(opId, h.store);
  if (op === undefined) throw new Error("runBrokerFailureScenario: in-flight op not found");
  startPolling(op, entry, adapter, h.store, h.clock);
  h.clock.advance(entry.poll_interval);
  await Promise.resolve(); // flush async IIFE microtask so writeCompletion executes
  const row = h.store.get<{ status: string }>(
    "SELECT status FROM broker_completion WHERE op_id = ?",
    opId,
  );
  return { completionStatus: row?.status ?? "" };
}

// ---------------------------------------------------------------------------
// Broker timeout scenario
// ---------------------------------------------------------------------------

/**
 * Scenario: fake adapter always returns "running" (non-terminal); after two
 * poll ticks the elapsed time equals entry.timeout; the poller writes an
 * "escalation_needed" completion row (which is not in terminal_states).
 */
export async function runBrokerTimeoutScenario(
  h: HarnessFixture,
): Promise<{ completionStatus: string; isTerminal: boolean }> {
  const entry: VerbRegistryEntry = {
    verb: "test-timeout-verb",
    tier: "auto",
    timeout: 2_000,
    idempotency: { window_ms: 0 },
    retry: { max: 3, backoff: "linear" },
    poll_interval: 1_000,
    terminal_states: ["failed", "done"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
  const adapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => "req-timeout-001",
    poll_status: async (_requestId: unknown) => ({ status: "running" }),
    reconcile: async (_ledger: unknown) => null,
  };
  const opId = await submit(entry, adapter, {}, "ik-timeout-001", h.store);
  const op = getInFlightOp(opId, h.store);
  if (op === undefined) throw new Error("runBrokerTimeoutScenario: in-flight op not found");
  startPolling(op, entry, adapter, h.store, h.clock);
  // Poll 1: non-terminal, elapsed(1000) < timeout(2000), schedules next tick
  h.clock.advance(entry.poll_interval);
  await Promise.resolve();
  // Poll 2: non-terminal, elapsed(2000) >= timeout(2000) → escalation_needed
  h.clock.advance(entry.poll_interval);
  await Promise.resolve();
  const row = h.store.get<{ status: string }>(
    "SELECT status FROM broker_completion WHERE op_id = ?",
    opId,
  );
  const completionStatus = row?.status ?? "";
  return {
    completionStatus,
    isTerminal: entry.terminal_states.includes(completionStatus),
  };
}

// ---------------------------------------------------------------------------
// Broker regression scenario
// ---------------------------------------------------------------------------

/**
 * Scenario: op with observed_state_can_regress=true receives "done" on poll 1
 * (terminal, withheld) then "running" on poll 2 (regression); pendingTerminal
 * is cleared and no completion row is written.
 */
export async function runBrokerRegressionScenario(
  h: HarnessFixture,
): Promise<{ completionWritten: boolean }> {
  const entry: VerbRegistryEntry = {
    verb: "test-regress-verb",
    tier: "auto",
    timeout: 100_000,
    idempotency: { window_ms: 0 },
    retry: { max: 3, backoff: "linear" },
    poll_interval: 1_000,
    terminal_states: ["done"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: true,
  };
  let callCount = 0;
  const adapter: AsyncVerbAdapter = {
    submit: async (_input: unknown) => "req-regress-001",
    poll_status: async (_requestId: unknown) => {
      callCount += 1;
      if (callCount === 1) return { status: "done" };  // terminal — withheld
      return { status: "running" };                     // regression
    },
    reconcile: async (_ledger: unknown) => null,
  };
  const opId = await submit(entry, adapter, {}, "ik-regress-001", h.store);
  const op = getInFlightOp(opId, h.store);
  if (op === undefined) throw new Error("runBrokerRegressionScenario: in-flight op not found");
  startPolling(op, entry, adapter, h.store, h.clock);
  // Poll 1: "done" — terminal but withheld (observed_state_can_regress = true)
  h.clock.advance(entry.poll_interval);
  await Promise.resolve();
  // Poll 2: "running" — regression; pendingTerminalResult cleared, no completion row written
  h.clock.advance(entry.poll_interval);
  await Promise.resolve();
  const row = h.store.get<{ status: string }>(
    "SELECT status FROM broker_completion WHERE op_id = ?",
    opId,
  );
  return { completionWritten: row !== undefined };
}
