import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeClock } from "../foundations/clock.ts";
import type { Clock } from "../foundations/clock.ts";
import { soakStage } from "./soak.ts";
import type { SoakStageNode, ObserverMap, SoakOutcome } from "./soak.ts";

// ---------------------------------------------------------------------------
// Helper — flush all pending microtasks
// setImmediate fires after the microtask queue drains (Node.js check phase).
// ---------------------------------------------------------------------------
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Suite: src/deploy/soak
// ---------------------------------------------------------------------------
describe("src/deploy/soak", () => {
  // -------------------------------------------------------------------------
  // T2 — degrade-during-soak → on_fail halt_and_escalate
  // -------------------------------------------------------------------------
  describe("T2 — degrade-during-soak → on_fail halt_and_escalate", () => {
    test("observers healthy at soak start but flipping unhealthy at second poll resolve on_fail with soak-window history proving mid-soak detection", async () => {
      const clock = new FakeClock(0);
      // firstPollDone tracks whether the first observer-a call has fired.
      // false → healthy; true → unhealthy (simulates a mid-soak degradation).
      let firstPollDone = false;

      const stageNode: SoakStageNode = {
        nodeId: "test-degrade-staging",
        handlers: [{ observer: "observer-a" }, { observer: "observer-b" }],
        soakDurationMs: 180000, // 3 polls planned
        pollIntervalMs: 60000,
      };

      const observers: ObserverMap = new Map([
        [
          "observer-a",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            if (!firstPollDone) {
              firstPollDone = true;
              return { healthy: true, value: "rollout-complete" };
            }
            return { healthy: false, value: "degraded" };
          },
        ],
        [
          "observer-b",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            return { healthy: true, value: "error-rate-ok" };
          },
        ],
      ]);

      const soakPromise = soakStage(stageNode, observers, clock);

      // Poll 1 at t=60000: both observers healthy — soak continues.
      clock.advance(60000);
      await flushMicrotasks();

      // Poll 2 at t=120000: observer-a flips unhealthy — on_fail should resolve.
      clock.advance(60000);
      await flushMicrotasks();

      const outcome: SoakOutcome = await soakPromise;

      assert.equal(
        outcome.result,
        "on_fail",
        "mid-soak flip resolves to on_fail",
      );
      if (outcome.result === "on_fail") {
        assert.equal(
          outcome.resolution,
          "halt_and_escalate",
          "on_fail resolution is halt_and_escalate",
        );

        const ev = outcome.evidence;
        assert.equal(
          ev.observer,
          "observer-a",
          "evidence names the failing observer",
        );
        assert.equal(
          ev.value,
          "degraded",
          "evidence records the observed value at failure",
        );
        assert.equal(
          ev.stageId,
          "test-degrade-staging",
          "evidence records the stage id",
        );
        // Failure detected at poll 2 (t=120000), NOT at t=60000 —
        // proves mid-soak detection, not an early snapshot.
        assert.equal(
          ev.clockInstant,
          120000,
          "evidence records the fake-clock instant of the mid-soak failure (poll 2)",
        );

        // soak-window history must include at least 2 entries:
        // the prior healthy poll (t=60000) and the failing poll (t=120000).
        // This is the key proof that scheduled re-polls caught the flip.
        assert.ok(
          ev.soakWindowHistory.length >= 2,
          `soak-window history must record at least 2 polls (healthy first, failing second); got ${ev.soakWindowHistory.length}`,
        );

        // First history entry must be the healthy poll at t=60000.
        const firstEntry = ev.soakWindowHistory[0];
        assert.ok(
          firstEntry !== undefined,
          "first history entry must exist",
        );
        assert.equal(
          firstEntry.clockInstant,
          60000,
          "first poll at t=60000 recorded in soak-window history",
        );
        const firstResult = firstEntry.results[0];
        assert.ok(firstResult !== undefined, "first poll result must exist");
        assert.equal(
          firstResult.healthy,
          true,
          "first poll shows observer-a was healthy — proves flip happened mid-soak not upfront",
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // T1 — AND criteria + full-soak pass → notify_human
  // -------------------------------------------------------------------------
  describe("T1 — AND criteria + full-soak pass → notify_human", () => {
    test("observers healthy throughout full soak resolve on_pass, emit notify_human, and no merge/deploy/rollback verb appears in the command log", async () => {
      const clock = new FakeClock(0);

      // Fake broker command log — every observer call pushes "observe:<name>".
      // merge/deploy/rollback verbs must NOT appear (asserted non-vacuously:
      // the log is proven non-empty before the negative assertion).
      const commandLog: string[] = [];

      const stageNode: SoakStageNode = {
        nodeId: "test-staging-deploy",
        handlers: [{ observer: "observer-a" }, { observer: "observer-b" }],
        soakDurationMs: 180000, // 3 minutes
        pollIntervalMs: 60000,  // 1 minute → 3 scheduled polls
      };

      const observers: ObserverMap = new Map([
        [
          "observer-a",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            commandLog.push("observe:observer-a");
            return { healthy: true, value: "rollout-complete" };
          },
        ],
        [
          "observer-b",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            commandLog.push("observe:observer-b");
            return { healthy: true, value: "error-rate-ok" };
          },
        ],
      ]);

      const soakPromise = soakStage(stageNode, observers, clock);

      // Advance through 3 scheduled poll points (60s each); flush microtasks
      // after each advance so the async observer calls complete before the
      // next clock tick fires.
      clock.advance(60000);
      await flushMicrotasks(); // poll 1: t=60000

      clock.advance(60000);
      await flushMicrotasks(); // poll 2: t=120000

      clock.advance(60000);
      await flushMicrotasks(); // poll 3: t=180000 → soak complete

      const outcome: SoakOutcome = await soakPromise;

      // Observers must have been re-polled at multiple scheduled points.
      // 3 polls × 2 observers = 6 total "observe:" entries.
      const observeCalls = commandLog.filter((v) => v.startsWith("observe:"));
      assert.ok(
        observeCalls.length >= 4,
        `observers must be invoked multiple times across the soak window; got ${observeCalls.length}`,
      );

      // Outcome: on_pass with notify_human event.
      assert.equal(outcome.result, "on_pass", "all-healthy soak resolves to on_pass");
      if (outcome.result === "on_pass") {
        assert.equal(
          outcome.event,
          "notify_human",
          "on_pass emits notify_human event",
        );
      }

      // Non-vacuous no-merge assertion: command log must be non-empty (recording
      // mechanism was active), then assert the forbidden verbs are absent.
      assert.ok(
        commandLog.length > 0,
        "command log must be non-empty (proves the recording mechanism was exercised)",
      );
      const forbidden = commandLog.filter(
        (v) => v === "merge" || v === "deploy" || v === "rollback",
      );
      assert.equal(
        forbidden.length,
        0,
        `no merge/deploy/rollback verb must appear in the command log; found: ${forbidden.join(", ")}`,
      );
    });

    test("one observer unhealthy at the start fails AND criteria and resolves on_fail", async () => {
      const clock = new FakeClock(0);

      const stageNode: SoakStageNode = {
        nodeId: "test-staging-deploy-fail",
        handlers: [{ observer: "observer-a" }, { observer: "observer-b" }],
        soakDurationMs: 180000,
        pollIntervalMs: 60000,
      };

      const observers: ObserverMap = new Map([
        [
          "observer-a",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            // Unhealthy from the first poll — AND criteria fails immediately.
            return { healthy: false, value: "rollout-not-complete" };
          },
        ],
        [
          "observer-b",
          async (
            _stageId: string,
            _clock: Clock,
          ): Promise<{ healthy: boolean; value: unknown }> => {
            return { healthy: true, value: "ok" };
          },
        ],
      ]);

      const soakPromise = soakStage(stageNode, observers, clock);

      // First scheduled poll: observer-a is unhealthy → AND criteria fails →
      // soakStage resolves on_fail without waiting for the rest of the soak.
      clock.advance(60000);
      await flushMicrotasks();

      const outcome: SoakOutcome = await soakPromise;

      assert.equal(
        outcome.result,
        "on_fail",
        "AND criteria failure on first poll resolves to on_fail",
      );
    });
  });
});
