import { test, describe } from "node:test";
import assert from "node:assert/strict";
import "./no-network-guard.ts";
import {
  runPhaseBoundaryDriftScenario,
  runNoDriftControlScenario,
} from "./source-drift.ts";

// ---------------------------------------------------------------------------
// suite: src/harness/source-drift
// ---------------------------------------------------------------------------

describe("src/harness/source-drift", () => {
  test(
    "day-1 change caught at next phase boundary: drift signalled, task non-halted",
    async () => {
      const result = await runPhaseBoundaryDriftScenario();
      assert.equal(
        result.driftedAtBoundary,
        true,
        "drift must be detected at the next phase boundary",
      );
      assert.equal(
        result.escalations,
        1,
        "exactly one human-signal escalation event recorded",
      );
      assert.equal(
        result.halted,
        false,
        "task keeps working after drift — not halted",
      );
    },
  );

  test(
    "unchanged source across phase boundaries produces no drift event (control)",
    async () => {
      const result = await runNoDriftControlScenario();
      assert.equal(
        result.driftedAtBoundary,
        false,
        "no drift when source is unchanged",
      );
      assert.equal(
        result.escalations,
        0,
        "no escalation events when source hash matches baseline",
      );
      assert.equal(
        result.halted,
        false,
        "task continues normally when no drift detected",
      );
    },
  );
});
