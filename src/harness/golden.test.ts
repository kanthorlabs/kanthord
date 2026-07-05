/**
 * Tests for src/harness/golden
 * Story 001 — Harness Kit & Golden Scenario
 * Task T2 — Golden feature end-to-end on fakes
 */

// MUST be the first import — installs the suite-level no-network + credential
// guard before any SUT module is loaded (Story 001 AC, PRD §7.7).
import "./no-network-guard.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.ts";
import { runGoldenScenario } from "./golden.ts";

// ---------------------------------------------------------------------------
// Suite: src/harness/golden
// ---------------------------------------------------------------------------

test(
  "golden tdd@1 feature reaches complete on fakes without tripping the network guard",
  async () => {
    const h = await harness();
    try {
      const result = await runGoldenScenario(h);
      assert.equal(
        result.status,
        "complete",
        "golden scenario must reach feature-complete on the fake clock with no real I/O",
      );
      assert.equal(
        result.brokerCompletionStatus,
        "done",
        "golden path must write a successful fake-broker completion row",
      );
      assert.equal(
        result.brokerCompletionResultJson,
        JSON.stringify({ ok: true }),
        "successful fake-broker completion row must persist result_json",
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
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);
