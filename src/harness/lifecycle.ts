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
import { loadTasks, setTaskStatus } from "../scheduler/dispatch.ts";
import { initSchema } from "../store/schema.ts";
import { compile } from "../compiler/compile.ts";
import { submit, getInFlightOp } from "../broker/submit.ts";
import { startPolling } from "../broker/poller.ts";
import { writeLedgerEntry, recoverFromLedger } from "../broker/ledger.ts";
import { reconcileOp } from "../broker/reconcile.ts";
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

type SoakSample = {
  clockInstant: number;
  results: Array<{ observer: string; healthy: boolean; value: string }>;
};

export type RestartCheckpointName =
  | "post-compile"
  | "mid-dispatch"
  | "mid-gate-pair"
  | "mid-soak";

export type RestartSnapshot = {
  pendingTaskIds: string[];
  leaseOwnership: Array<{ holder: string; capabilityKey: string }>;
  currentPhase: string;
  injectedState: string;
  soakState: {
    stageId: string;
    windowStart: number;
    sampleHistory: SoakSample[];
  } | null;
};

export type RestartCheckpointResult = {
  checkpoint: RestartCheckpointName;
  pre: RestartSnapshot;
  post: RestartSnapshot;
  reconciledOps: number;
};

const RESTART_EPIC_MD = `---
id: feat-restart
repo: backend
ticket_system: jira
ticket: JIRA-R-001
deploy_chain:
  - stage: staging
    handlers:
      - observer: smoke-check
    success_criteria: "smoke-check:healthy"
    soak_duration: "2m"
---

## Acceptance

Restart coverage remains equivalent.
`;

const RESTART_TASK_ALPHA_MD = `---
id: task-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-R-101
---

## Prerequisites

Setup.

## Inputs

Nothing.

## Outputs

Alpha output.

## Tests

Unit tests.
`;

const RESTART_TASK_BETA_MD = `---
id: task-beta
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-R-102
---

## Prerequisites

Setup.

## Inputs

Nothing.

## Outputs

Beta output.

## Tests

Unit tests.
`;

function applyHarnessSoakStateMigration(h: HarnessFixture): void {
  h.store.run(
    `CREATE TABLE IF NOT EXISTS harness_soak_state (
      stage_id TEXT NOT NULL PRIMARY KEY,
      window_start INTEGER NOT NULL,
      sample_history TEXT NOT NULL
    )`,
  );
}

function writeHarnessSoakState(
  h: HarnessFixture,
  stageId: string,
  windowStart: number,
  sampleHistory: SoakSample[],
): void {
  applyHarnessSoakStateMigration(h);
  h.store.run(
    `INSERT OR REPLACE INTO harness_soak_state
       (stage_id, window_start, sample_history)
     VALUES (?, ?, ?)`,
    stageId,
    windowStart,
    JSON.stringify(sampleHistory),
  );
}

function readHarnessSoakState(
  h: HarnessFixture,
): RestartSnapshot["soakState"] {
  applyHarnessSoakStateMigration(h);
  const row = h.store.get<{
    stage_id: string;
    window_start: number;
    sample_history: string;
  }>(
    "SELECT stage_id, window_start, sample_history FROM harness_soak_state ORDER BY stage_id LIMIT 1",
  );
  if (row === undefined) return null;
  return {
    stageId: row.stage_id,
    windowStart: row.window_start,
    sampleHistory: JSON.parse(row.sample_history) as SoakSample[],
  };
}

async function readRestartSnapshot(
  h: HarnessFixture,
  featureStore: FeatureStore,
  storyId: string,
  taskStem: string,
): Promise<RestartSnapshot> {
  const pendingTaskIds = h.store.all<{ node_id: string }>(
    "SELECT node_id FROM scheduler_task WHERE status = 'pending' ORDER BY node_id",
  ).map((r) => r.node_id);

  const leaseOwnership = h.store.all<{ holder: string; capability_key: string }>(
    "SELECT holder, capability_key FROM scheduler_lease ORDER BY holder, capability_key",
  ).map((r) => ({ holder: r.holder, capabilityKey: r.capability_key }));

  const injectedState = await featureStore.readState(storyId, taskStem);
  const phaseMatch = /^current_phase:\s*(.+)$/m.exec(injectedState);
  const currentPhase = phaseMatch?.[1]?.trim() ?? "";

  return {
    pendingTaskIds,
    leaseOwnership,
    currentPhase,
    injectedState,
    soakState: readHarnessSoakState(h),
  };
}

async function restartAndSnapshot(opts: {
  h: HarnessFixture;
  featureDir: string;
  featureStore: FeatureStore;
  storyId: string;
  taskStem: string;
}): Promise<{ post: RestartSnapshot; reconciledOps: number }> {
  let summary: Record<string, unknown> | undefined;
  const lifecycle = bootDaemon({
    featureDir: opts.featureDir,
    clock: opts.h.clock,
    store: opts.h.store,
    logger: {
      info(record: Record<string, unknown>): void {
        if (record["event"] === "recovery-summary") {
          summary = record;
        }
      },
    },
    compileOpts: { repoRegistry: ["backend"] },
  });

  await lifecycle.restart();
  const post = await readRestartSnapshot(
    opts.h,
    opts.featureStore,
    opts.storyId,
    opts.taskStem,
  );
  const reconciledOps =
    typeof summary?.["reconciledOps"] === "number" ? summary["reconciledOps"] : 0;
  return { post, reconciledOps };
}

/**
 * Scenario: inject simulated kill/restart at the TC-03 representative
 * checkpoints. Each checkpoint snapshots all runbook-required restart fields
 * immediately before the kill and after restart from durable markdown/ledger +
 * persisted scheduler/soak views.
 */
export async function runKillRestartScenario(
  h: HarnessFixture,
): Promise<RestartCheckpointResult[]> {
  const featureDir = await mkdtemp(join(tmpdir(), "klifecycle-"));
  try {
    const storyId = "001-story-a";
    const taskStem = "001-task-alpha";
    const storyDir = join(featureDir, storyId);
    await mkdir(storyDir, { recursive: true });

    await writeFile(join(featureDir, "epic.md"), RESTART_EPIC_MD, "utf8");
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await writeFile(join(storyDir, "INDEX.md"), "# Story A\n", "utf8");
    await writeFile(join(storyDir, `${taskStem}.md`), RESTART_TASK_ALPHA_MD, "utf8");
    await writeFile(join(storyDir, "002-task-beta.md"), RESTART_TASK_BETA_MD, "utf8");

    await compile(featureDir, h.store, { repoRegistry: ["backend"] });
    initSchema(h.store);
    loadTasks(h.store, "feat-restart");

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

    const lm = new LeaseManager(h.store, h.clock);
    const results: RestartCheckpointResult[] = [];

    async function capture(checkpoint: RestartCheckpointName): Promise<void> {
      const pre = await readRestartSnapshot(h, featureStore, storyId, taskStem);
      const { post, reconciledOps } = await restartAndSnapshot({
        h,
        featureDir,
        featureStore,
        storyId,
        taskStem,
      });
      results.push({ checkpoint, pre, post, reconciledOps });
    }

    await featureStore.writeState(storyId, taskStem, "current_phase: compiled\n");
    await capture("post-compile");

    lm.acquire("task-alpha", [{ kind: "resource" as const, key: "dispatch-slot" }]);
    setTaskStatus(h.store, "task-alpha", "running");
    await featureStore.writeState(storyId, taskStem, "current_phase: dispatching\n");
    await capture("mid-dispatch");

    await featureStore.writeState(
      storyId,
      taskStem,
      "current_phase: gate_pair\n\n## Injected\n\ngate pair in progress\n",
    );
    await capture("mid-gate-pair");

    const stageId = "feat-restart-deploy-staging";
    const windowStart = h.clock.now();
    writeHarnessSoakState(h, stageId, windowStart, [
      {
        clockInstant: windowStart + 60_000,
        results: [{ observer: "smoke-check", healthy: true, value: "ok" }],
      },
    ]);
    setTaskStatus(h.store, stageId, "running");
    await featureStore.writeState(
      storyId,
      taskStem,
      "current_phase: soak\n\n## Injected\n\nsoak window in progress\n",
    );
    await capture("mid-soak");

    return results;
  } finally {
    await rm(featureDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Crash/restart + ledger reconciliation scenario
// ---------------------------------------------------------------------------

type FakeRemoteReconcileOutcome = "done" | "failed" | "resubmit" | "escalate";

export type LedgerReconciliationOutcome = {
  remoteOutcome: FakeRemoteReconcileOutcome;
  recoveredStatus: string;
  reconcileOutcome: FakeRemoteReconcileOutcome;
  completionStatus: string | null;
};

const RECONCILE_EPIC_MD = `---
id: feat-reconcile
repo: backend
ticket_system: jira
ticket: JIRA-R-004
---

## Acceptance

Ledger reconciliation covers fake remote outcomes.
`;

const RECONCILE_TASK_MD = `---
id: task-reconcile
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-R-401
---

## Prerequisites

Setup.

## Inputs

Nothing.

## Outputs

Reconcile output.

## Tests

Unit tests.
`;

function makeReconciliationEntry(): VerbRegistryEntry {
  return {
    verb: "fake-remote-reconcile",
    tier: "auto",
    timeout: 60_000,
    idempotency: { window_ms: 60_000 },
    retry: { max: 3, backoff: "linear" },
    poll_interval: 1_000,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
}

/**
 * Scenario: crash with in-flight fake broker ops, restart from markdown ledger,
 * then reconcile each durable op identity against fake remote states that return
 * done, failed, resubmit, and escalate.
 */
export async function runLedgerReconciliationScenario(
  h: HarnessFixture,
): Promise<{
  restartedReconciledOps: number;
  outcomes: LedgerReconciliationOutcome[];
  resubmitPayload: unknown;
  resubmitRequestIds: string[];
}> {
  const featureDir = await mkdtemp(join(tmpdir(), "kreconcile-"));
  try {
    const storyId = "001-story-a";
    const taskStem = "001-task-reconcile";
    const storyDir = join(featureDir, storyId);
    await mkdir(storyDir, { recursive: true });

    await writeFile(join(featureDir, "epic.md"), RECONCILE_EPIC_MD, "utf8");
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await writeFile(join(storyDir, "INDEX.md"), "# Story A\n", "utf8");
    await writeFile(join(storyDir, `${taskStem}.md`), RECONCILE_TASK_MD, "utf8");

    const featureStore = new FeatureStore(featureDir);
    const fakeRemoteOutcomes: FakeRemoteReconcileOutcome[] = [
      "done",
      "failed",
      "resubmit",
      "escalate",
    ];

    for (const remoteOutcome of fakeRemoteOutcomes) {
      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: `op-${remoteOutcome}`,
        verb: "fake-remote-reconcile",
        idempotency_key: `ik-${remoteOutcome}`,
        correlation: `corr-${remoteOutcome}`,
        desired_effect_hash: `hash-${remoteOutcome}`,
        status: "in_flight",
      });
    }

    let restartedReconciledOps = 0;
    const lifecycle = bootDaemon({
      featureDir,
      clock: h.clock,
      store: h.store,
      logger: {
        info(record: Record<string, unknown>): void {
          if (record["event"] === "recovery-summary") {
            restartedReconciledOps =
              typeof record["reconciledOps"] === "number" ? record["reconciledOps"] : 0;
          }
        },
      },
      compileOpts: { repoRegistry: ["backend"] },
    });
    await lifecycle.restart();

    const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
    const remoteByCorrelation = new Map<string, FakeRemoteReconcileOutcome>();
    for (const remoteOutcome of fakeRemoteOutcomes) {
      remoteByCorrelation.set(`corr-${remoteOutcome}`, remoteOutcome);
    }

    const resubmitRequestIds: string[] = [];
    let resubmitPayload: unknown;
    const adapter: AsyncVerbAdapter = {
      submit: async (input: unknown) => {
        resubmitPayload = input;
        const requestId = `req-resubmit-${resubmitRequestIds.length + 1}`;
        resubmitRequestIds.push(requestId);
        return requestId;
      },
      poll_status: async (_requestId: unknown) => ({ status: "pending" }),
      reconcile: async (ledger: unknown) => {
        const { correlation, desired_effect_hash } = ledger as {
          correlation: string;
          desired_effect_hash: string;
        };
        const remoteOutcome = remoteByCorrelation.get(correlation);
        if (remoteOutcome === undefined) throw new Error(`unknown fake remote correlation ${correlation}`);
        if (remoteOutcome === "done") {
          return { status: "done", observed_hash: desired_effect_hash };
        }
        return { status: remoteOutcome };
      },
    };

    const entry = makeReconciliationEntry();
    const originalPayload = { action: "fake-remote-reconcile", service: "backend" };
    const outcomes: LedgerReconciliationOutcome[] = [];

    for (const remoteOutcome of fakeRemoteOutcomes) {
      const ledgerEntry = recovered.find((r) => r.op_id === `op-${remoteOutcome}`);
      if (ledgerEntry === undefined) {
        throw new Error(`missing recovered ledger entry for ${remoteOutcome}`);
      }
      const reconcileOutcome = await reconcileOp(
        ledgerEntry,
        entry,
        adapter,
        h.store,
        h.clock,
        originalPayload,
      );
      const completionRow = h.store.get<{ status: string }>(
        "SELECT status FROM broker_completion WHERE op_id = ?",
        ledgerEntry.op_id,
      );
      outcomes.push({
        remoteOutcome,
        recoveredStatus: ledgerEntry.status,
        reconcileOutcome,
        completionStatus: completionRow?.status ?? null,
      });
    }

    return {
      restartedReconciledOps,
      outcomes,
      resubmitPayload,
      resubmitRequestIds,
    };
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
    initSchema(h.store);
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
