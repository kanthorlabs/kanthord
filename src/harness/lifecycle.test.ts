/**
 * Lifecycle scenarios — Story 002 T1 (Epic 010).
 *
 * Two named scenarios composed from the harness kit + Epic 004/005/009 seams:
 *   1. Lease expiry + heartbeat lapse → waiter dispatches on reclaimed capability.
 *   2. Kill/restart respawn-equivalence + ledger reconciliation — field-by-field.
 */
import "./no-network-guard.ts";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";
import { LeaseManager } from "../scheduler/leases.ts";
import {
  runLeaseExpiryScenario,
  runKillRestartScenario,
  runCompactionRespawnScenario,
  runDirtyPlanScenario,
  runBrokerFailureScenario,
  runBrokerTimeoutScenario,
  runBrokerRegressionScenario,
} from "./lifecycle.ts";

describe("src/harness/lifecycle", () => {
  test(
    "lease expires: heartbeat lapses, waiter dispatches on reclaimed capability",
    async () => {
      const h = await harness();
      try {
        const result = runLeaseExpiryScenario(h);
        assert.strictEqual(
          result.waiterDispatched,
          true,
          "task-beta must dispatch after task-alpha lease expires",
        );
      } finally {
        await h[Symbol.asyncDispose]();
      }
    },
  );

  test(
    "kill and restart: pending tasks, phase, and in-flight op recovered field-by-field",
    async () => {
      const h = await harness();
      try {
        // Acquire a lease BEFORE the simulated kill — verifying ownership survives restart (AC2).
        const lm = new LeaseManager(h.store, h.clock);
        const acquired = lm.acquire("task-x", [
          { kind: "resource", key: "lifecycle-test" },
        ]);
        assert.ok(acquired, "lease must be acquired before kill");

        const result = await runKillRestartScenario(h);
        assert.strictEqual(
          result.pendingTaskCount,
          1,
          "one pending task recovered from markdown on restart",
        );
        assert.strictEqual(
          result.currentPhase,
          "planning",
          "current phase read from STATE file field-by-field",
        );
        assert.strictEqual(
          result.reconciledOps,
          1,
          "in-flight ledger op surfaces as needs_reconciliation after restart",
        );

        // Lease ownership field-by-field: scheduler_lease row must survive restart (AC2 + gate).
        const leaseRows = h.store.all<{ holder: string; capability_key: string }>(
          "SELECT holder, capability_key FROM scheduler_lease WHERE holder = ?",
          "task-x",
        );
        assert.strictEqual(
          leaseRows.length,
          1,
          "scheduler_lease row must survive restart field-by-field (lease ownership)",
        );
        const row = leaseRows[0];
        assert.ok(row !== undefined, "lease row must be defined after restart");
        assert.strictEqual(row.holder, "task-x", "lease holder preserved after restart");
        assert.strictEqual(
          row.capability_key,
          "resource:lifecycle-test",
          "lease capability_key preserved after restart",
        );
      } finally {
        await h[Symbol.asyncDispose]();
      }
    },
  );

  test(
    "compaction respawn: threshold triggers checkpoint + respawn, four fields match field-by-field",
    async () => {
      const h = await harness();
      try {
        const result = await runCompactionRespawnScenario(h);
        assert.ok(
          result.checkpointCalled,
          "threshold respawn must call checkpoint before teardown",
        );
        assert.deepStrictEqual(
          result.post.pendingTaskIds,
          result.pre.pendingTaskIds,
          "pendingTaskIds field-by-field equal after compaction respawn",
        );
        assert.deepStrictEqual(
          result.post.heldCapabilityKeys,
          result.pre.heldCapabilityKeys,
          "heldCapabilityKeys field-by-field equal after compaction respawn",
        );
        assert.strictEqual(
          result.post.currentPhase,
          result.pre.currentPhase,
          "currentPhase field-by-field equal after compaction respawn",
        );
      } finally {
        await h[Symbol.asyncDispose]();
      }
    },
  );

  test(
    "dirty-plan recompile: plan edit halts dispatch, running G keeps stamp, G+1 allows dispatch",
    async () => {
      const h = await harness();
      try {
        const result = await runDirtyPlanScenario(h);
        assert.deepStrictEqual(
          result.dispatchableWhenDirty,
          [],
          "dirty plan must halt all new dispatch",
        );
        assert.strictEqual(
          result.runningTaskStamp,
          1,
          "task pinned under G=1 keeps its generation stamp after plan becomes dirty",
        );
        assert.strictEqual(
          result.recompiledGeneration,
          2,
          "recompile mints G+1 = 2",
        );
        assert.ok(
          result.dispatchableAfterRecompile.length > 0,
          "halted tasks dispatch again under G+1",
        );
      } finally {
        await h[Symbol.asyncDispose]();
      }
    },
  );

test(
  "broker failure: failed op writes failed completion to broker_completion",
  async () => {
    const h = await harness();
    try {
      const result = await runBrokerFailureScenario(h);
      assert.strictEqual(
        result.completionStatus,
        "failed",
        "failed op must write a completion row with status 'failed'",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

test(
  "broker timeout: timed-out op emits escalation_needed, no terminal status written",
  async () => {
    const h = await harness();
    try {
      const result = await runBrokerTimeoutScenario(h);
      assert.strictEqual(
        result.completionStatus,
        "escalation_needed",
        "timed-out op must write escalation_needed, not a terminal status",
      );
      assert.strictEqual(
        result.isTerminal,
        false,
        "escalation_needed is not a declared terminal state",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);

test(
  "broker regression: regressing op is not left final-done",
  async () => {
    const h = await harness();
    try {
      const result = await runBrokerRegressionScenario(h);
      assert.strictEqual(
        result.completionWritten,
        false,
        "regressing op must not have a final completion row written",
      );
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);
});
