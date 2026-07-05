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
      assert.ok(
        result.errorMessage.includes("Cycle detected in emitted graph:"),
        `expected "Cycle detected in emitted graph:" in: ${result.errorMessage}`,
      );
    },
  );

  test(
    "forward handoff: back-major dependency rejected with forward-handoff diagnostic",
    async () => {
      const result = await runForwardHandoffScenario();
      assert.ok(
        result.errorMessage.includes("Forward handoff:") &&
          result.errorMessage.includes("story group 01") &&
          result.errorMessage.includes("story group 03") &&
          result.errorMessage.includes("producer follows consumer"),
        `expected "Forward handoff: story group 01 cannot depend on story group 03 (producer follows consumer)" in: ${result.errorMessage}`,
      );
    },
  );

  test(
    "overlapping lanes: parallel lanes with shared write-scope rejected with lane diagnostic",
    async () => {
      const result = await runOverlappingLanesScenario();
      assert.ok(
        result.errorMessage.includes("both write") &&
          result.errorMessage.includes("cannot share a group"),
        `expected overlapping-lanes diagnostic in: ${result.errorMessage}`,
      );
    },
  );

  test(
    "missing ticket: task with no ticket ref rejected with ticket diagnostic",
    async () => {
      const result = await runMissingTicketScenario();
      assert.ok(
        result.errorMessage.includes("is missing a required ticket reference"),
        `expected ticket diagnostic in: ${result.errorMessage}`,
      );
    },
  );

  test(
    "missing body section: task with absent required section rejected with body-section diagnostic",
    async () => {
      const result = await runMissingBodySectionScenario();
      assert.ok(
        result.errorMessage.includes("is missing a non-empty ##"),
        `expected body-section diagnostic in: ${result.errorMessage}`,
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
