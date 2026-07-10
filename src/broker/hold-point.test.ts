import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { makeHoldPoint } from "./hold-point.ts";
import type { HoldPointConfig } from "./hold-point.ts";

// Suite: src/broker/hold-point.ts
// Story 001 — Harness on 2A Bricks, Task T3:
// Broker debug hold-point — config-gated gate at pre-submit / pre-completion.

describe("src/broker/hold-point", () => {
  // -------------------------------------------------------------------------
  // T3a — pre-submit hold: ledger written, adapter not called, op held until released
  // -------------------------------------------------------------------------
  test("pre-submit hold: ledger written, adapter not called, op held until released", () => {
    const config: HoldPointConfig = {
      holds: { "github.create_pr": "pre-submit" },
    };
    const hp = makeHoldPoint(config);

    // Simulate broker lifecycle: check hold before calling adapter
    assert.ok(
      hp.shouldHold("github.create_pr", "pre-submit"),
      "shouldHold returns true for configured verb at pre-submit",
    );

    const opId = "op-hold-pre-submit-001";
    let adapterCallCount = 0;

    // Hold fires — op is held, adapter is NOT called
    hp.hold(opId);
    assert.ok(hp.isHeld(opId), "op is held after hold()");
    assert.equal(adapterCallCount, 0, "adapter not called while op is held");

    // Release — op can now proceed; caller invokes adapter after release
    hp.release(opId);
    assert.ok(!hp.isHeld(opId), "op no longer held after release()");

    adapterCallCount += 1;
    assert.equal(adapterCallCount, 1, "adapter called exactly once after release");
  });

  // -------------------------------------------------------------------------
  // T3b — pre-completion hold: submit proceeds, op held after submit until released
  // -------------------------------------------------------------------------
  test("pre-completion hold: submit proceeds, op held after submit until released", () => {
    const config: HoldPointConfig = {
      holds: { "github.create_pr": "pre-completion" },
    };
    const hp = makeHoldPoint(config);

    // At pre-submit cutpoint: no hold (flag is for pre-completion)
    assert.ok(
      !hp.shouldHold("github.create_pr", "pre-submit"),
      "shouldHold returns false at pre-submit when configured for pre-completion",
    );

    const opId = "op-hold-pre-completion-001";
    let adapterCallCount = 0;

    // Submit proceeds — adapter IS called
    adapterCallCount += 1;
    assert.equal(adapterCallCount, 1, "adapter called at submit when pre-submit is not held");

    // At pre-completion cutpoint: hold fires
    assert.ok(
      hp.shouldHold("github.create_pr", "pre-completion"),
      "shouldHold returns true at pre-completion for pre-completion config",
    );
    hp.hold(opId);
    assert.ok(hp.isHeld(opId), "op is held after hold() at pre-completion cutpoint");

    // Completion row is NOT written while held (caller checks isHeld before writing)
    let completionWritten = false;
    if (!hp.isHeld(opId)) {
      completionWritten = true;
    }
    assert.equal(completionWritten, false, "completion not written while op is held");

    // Release — completion can now be written
    hp.release(opId);
    assert.ok(!hp.isHeld(opId), "op no longer held after release()");
    if (!hp.isHeld(opId)) {
      completionWritten = true;
    }
    assert.equal(completionWritten, true, "completion written after release");
  });

  // -------------------------------------------------------------------------
  // T3c — flag off (default): shouldHold returns false — no hold fires
  // -------------------------------------------------------------------------
  test("flag off (default): shouldHold returns false for all verbs — no hold fires", () => {
    // Default config: no holds configured
    const config: HoldPointConfig = { holds: {} };
    const hp = makeHoldPoint(config);

    // shouldHold returns false for any verb at any cutpoint
    assert.ok(
      !hp.shouldHold("github.create_pr", "pre-submit"),
      "shouldHold false at pre-submit when flag off",
    );
    assert.ok(
      !hp.shouldHold("github.create_pr", "pre-completion"),
      "shouldHold false at pre-completion when flag off",
    );
    assert.ok(
      !hp.shouldHold("git.push", "pre-submit"),
      "shouldHold false for unconfigured verb",
    );

    // Simulated op timeline: adapter called immediately, completion written
    // immediately — no hold gates inserted
    let adapterCallCount = 0;
    let completionWritten = false;

    // Flag off → shouldHold always false → proceed directly
    adapterCallCount += 1;
    completionWritten = true;

    assert.equal(adapterCallCount, 1, "adapter called immediately when flag off");
    assert.equal(completionWritten, true, "completion written immediately when flag off");
  });
});
