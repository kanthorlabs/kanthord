/**
 * Lint + projection scenarios — Story 003 T1 (Epic 010).
 *
 * Five isolated invalid-fixture scenarios, each rejected by compile with its
 * expected planner-vocabulary diagnostic text asserted string-for-string.
 */
import "./no-network-guard.ts";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  runCycleScenario,
  runForwardHandoffScenario,
  runOverlappingLanesScenario,
  runMissingTicketScenario,
  runMissingBodySectionScenario,
  runRebuildProjectionScenario,
} from "./lint-projection.ts";

describe("src/harness/lint-projection", () => {
  test(
    "cycle: circular dependency in plan graph is rejected with cycle diagnostic",
    async () => {
      const result = await runCycleScenario();
      assert.strictEqual(
        result.errorMessage,
        "Compiled graph failed re-lint: Cycle detected in emitted graph: task-cycle-a, task-cycle-b, task-cycle-a",
        "cycle diagnostic must match Epic 002 text exactly",
      );
    },
  );

  test(
    "forward handoff: back-major dependency rejected with forward-handoff diagnostic",
    async () => {
      const result = await runForwardHandoffScenario();
      assert.strictEqual(
        result.errorMessage,
        "Forward handoff: story group 01 cannot depend on story group 03 (producer follows consumer)",
        "forward-handoff diagnostic must match Epic 002 text exactly",
      );
    },
  );

  test(
    "overlapping lanes: parallel lanes with shared write-scope rejected with lane diagnostic",
    async () => {
      const result = await runOverlappingLanesScenario();
      assert.strictEqual(
        result.errorMessage,
        'lane "001.1" and lane "001.2" both write "lib/shared/" — they cannot share a group',
        "overlapping-lanes diagnostic must match Epic 002 text exactly",
      );
    },
  );

  test(
    "missing ticket: task with no ticket ref rejected with ticket diagnostic",
    async () => {
      const result = await runMissingTicketScenario();
      assert.strictEqual(
        result.errorMessage,
        'Node "task-no-ticket" is missing a required ticket reference',
        "missing-ticket diagnostic must match Epic 002 text exactly",
      );
    },
  );

  test(
    "missing body section: task with absent required section rejected with body-section diagnostic",
    async () => {
      const result = await runMissingBodySectionScenario();
      assert.strictEqual(
        result.errorMessage,
        'task "task-no-tests" is missing a non-empty ## Tests section',
        "missing-body-section diagnostic must match Epic 002 text exactly",
      );
    },
  );

  test(
    "rebuild-from-markdown projection equals live projection, and runtime-only mutation yields no divergence",
    async () => {
      const result = await runRebuildProjectionScenario();
      assert.strictEqual(
        result.divergences.length,
        0,
        `expected no divergences: ${JSON.stringify(result.divergences)}`,
      );
      assert.strictEqual(
        result.divergencesAfterMutation.length,
        0,
        `expected no divergences after runtime-only mutation: ${JSON.stringify(result.divergencesAfterMutation)}`,
      );
    },
  );
});
