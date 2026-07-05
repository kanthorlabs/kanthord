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
    } finally {
      await h[Symbol.asyncDispose]();
    }
  },
);
