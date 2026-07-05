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
import {
  runLeaseExpiryScenario,
  runKillRestartScenario,
  runLedgerReconciliationScenario,
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
    "kill and restart: TC-03 checkpoints recover all runbook fields field-by-field",
    async () => {
      const h = await harness();
      try {
        const results = await runKillRestartScenario(h);
        assert.deepStrictEqual(
          results.map((r) => r.checkpoint),
          ["post-compile", "mid-dispatch", "mid-gate-pair", "mid-soak"],
          "TC-03 must inject restart at every representative checkpoint",
        );

        for (const result of results) {
          assert.deepStrictEqual(
            result.post.pendingTaskIds,
            result.pre.pendingTaskIds,
            `${result.checkpoint}: pending-task set recovered field-by-field`,
          );
          assert.deepStrictEqual(
            result.post.leaseOwnership,
            result.pre.leaseOwnership,
            `${result.checkpoint}: lease ownership recovered field-by-field`,
          );
          assert.strictEqual(
            result.post.currentPhase,
            result.pre.currentPhase,
            `${result.checkpoint}: current workflow phase recovered field-by-field`,
          );
          assert.strictEqual(
            result.post.injectedState,
            result.pre.injectedState,
            `${result.checkpoint}: injected STATE recovered field-by-field`,
          );
          assert.deepStrictEqual(
            result.post.soakState,
            result.pre.soakState,
            `${result.checkpoint}: in-progress soak state recovered field-by-field`,
          );
          assert.ok(
            result.reconciledOps >= 1,
            `${result.checkpoint}: in-flight ledger op surfaces as needs_reconciliation after restart`,
          );
        }

        const midDispatch = results.find((r) => r.checkpoint === "mid-dispatch");
        assert.ok(midDispatch !== undefined, "mid-dispatch checkpoint must exist");
        assert.deepStrictEqual(
          midDispatch.pre.leaseOwnership,
          [{ holder: "task-alpha", capabilityKey: "resource:dispatch-slot" }],
          "mid-dispatch checkpoint must include concrete lease ownership",
        );

        const midSoak = results.find((r) => r.checkpoint === "mid-soak");
        assert.ok(midSoak?.pre.soakState !== null, "mid-soak checkpoint must include soak state");
        const soakState = midSoak?.pre.soakState;
        assert.ok(soakState !== undefined && soakState !== null, "mid-soak soak state must be defined");
        assert.strictEqual(
          soakState.stageId,
          "feat-restart-deploy-staging",
          "mid-soak state includes stage id",
        );
        assert.ok(
          soakState.sampleHistory.length >= 1,
          "mid-soak state includes sample history so the window resumes instead of restarting",
        );
      } finally {
        await h[Symbol.asyncDispose]();
      }
    },
  );

  test(
    "crash/restart + ledger reconciliation: TC-04 covers fake remote done, failed, resubmit, escalate",
    async () => {
      const h = await harness();
      try {
        const result = await runLedgerReconciliationScenario(h);

        assert.strictEqual(
          result.restartedReconciledOps,
          4,
          "restart must recover every in-flight fake broker op from the durable ledger",
        );
        assert.deepStrictEqual(
          result.outcomes.map((o) => o.remoteOutcome),
          ["done", "failed", "resubmit", "escalate"],
          "TC-04 must exercise every fake-remote reconcile outcome in the lifecycle scenario",
        );

        for (const outcome of result.outcomes) {
          assert.strictEqual(
            outcome.recoveredStatus,
            "needs_reconciliation",
            `${outcome.remoteOutcome}: op identity must be recovered from ledger as needs_reconciliation`,
          );
          assert.strictEqual(
            outcome.reconcileOutcome,
            outcome.remoteOutcome,
            `${outcome.remoteOutcome}: reconcile result must match the fake remote state`,
          );
        }

        const completionByOutcome = Object.fromEntries(
          result.outcomes.map((o) => [o.remoteOutcome, o.completionStatus]),
        );
        assert.deepStrictEqual(
          completionByOutcome,
          {
            done: "done",
            failed: "failed",
            resubmit: null,
            escalate: "escalation_needed",
          },
          "TC-04 must assert the lifecycle-visible completion effect for every reconcile branch",
        );
        assert.deepStrictEqual(
          result.resubmitPayload,
          { action: "fake-remote-reconcile", service: "backend" },
          "resubmit uses the original operation payload, not ledger metadata",
        );
        assert.deepStrictEqual(
          result.resubmitRequestIds,
          ["req-resubmit-1"],
          "resubmit branch mints exactly one fake remote request",
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
