import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import type { Clock } from "../foundations/clock.ts";
import { compile } from "../compiler/compile.ts";
import { runChain } from "./chain.ts";
import type { HandlerMap, ChainOutcome } from "./chain.ts";

// ---------------------------------------------------------------------------
// Fixtures — minimal compilable plan with two deploy stages (3 + 1 handlers)
// ---------------------------------------------------------------------------

const EPIC_MD = `---
id: feat-deploy
repo: backend
deploy_chain:
  - stage: staging
    handlers:
      - observer: observer-a
      - observer: observer-b
      - observer: observer-c
    success_criteria: "observer-a:healthy AND observer-b:healthy AND observer-c:healthy"
    soak_duration: "5m"
  - stage: production
    handlers:
      - observer: observer-d
    success_criteria: "observer-d:healthy"
    soak_duration: "2m"
---

## Acceptance

Deploy chain completes when all stages pass.
`;

const TASK_A_MD = `---
id: task-a
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-1
---

## Prerequisites

Setup.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests for task-a.
`;

// ---------------------------------------------------------------------------
// Suite: src/deploy/chain
// ---------------------------------------------------------------------------

describe("src/deploy/chain", () => {
  // ---------------------------------------------------------------------------
  // T2 — halt + escalate with evidence on handler failure
  // ---------------------------------------------------------------------------
  describe("T2 — halt + escalate with evidence on handler failure", () => {
    let featDir = "";
    let testDir = "";
    let store: Store;
    let clock: FakeClock;

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t2-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-a.md"), TASK_A_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t2-db-"));
      const dbPath = join(testDir, "test.db");
      store = openStore(dbPath, { busyTimeout: 1000 });
      clock = new FakeClock(0);
      await compile(featDir, store, { repoRegistry: ["backend"] });
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    test("second handler fails: chain halts, third + production handler never run, evidence attached to outcome", async () => {
      const callLog: string[] = [];
      const handlerMap: HandlerMap = new Map([
        [
          "observer-a",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            callLog.push("observer-a");
            return { healthy: true, value: "ok" };
          },
        ],
        [
          "observer-b",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            callLog.push("observer-b");
            return { healthy: false, value: "error-value" };
          },
        ],
        [
          "observer-c",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            callLog.push("observer-c");
            return { healthy: true, value: "ok" };
          },
        ],
        [
          "observer-d",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            callLog.push("observer-d");
            return { healthy: true, value: "ok" };
          },
        ],
      ]);

      const outcome: ChainOutcome = await runChain(store, "feat-deploy", handlerMap, clock);

      // Chain must halt after the second handler — observer-c and observer-d must not run.
      assert.deepEqual(
        callLog,
        ["observer-a", "observer-b"],
        "chain halts after observer-b fails; observer-c and observer-d must not be called",
      );

      assert.equal(outcome.result, "halt_and_escalate", "outcome must be halt_and_escalate");

      // Evidence must be present and carry the required fields.
      assert.ok(outcome.evidence !== undefined, "evidence must be attached to the outcome");
      const ev = outcome.evidence!;
      assert.equal(ev.observer, "observer-b", "evidence must name the failing observer");
      assert.equal(ev.value, "error-value", "evidence must carry the observed value");
      assert.equal(ev.clockInstant, 0, "evidence must record the fake-clock instant at failure");
      assert.equal(ev.stageId, "feat-deploy-deploy-staging", "evidence must record the stage id");
    });
  });

  // ---------------------------------------------------------------------------
  // T1 — ordered handler execution + chain proceeds on all-pass
  // ---------------------------------------------------------------------------
  describe("T1 — ordered handler execution + chain proceeds on all-pass", () => {
    let featDir = "";
    let testDir = "";
    let store: Store;
    let clock: FakeClock;

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t1-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-a.md"), TASK_A_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t1-db-"));
      const dbPath = join(testDir, "test.db");
      store = openStore(dbPath, { busyTimeout: 1000 });
      clock = new FakeClock(0);
      await compile(featDir, store, { repoRegistry: ["backend"] });
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    test("handlers invoked in declared order across both stages; all-pass chain resolves to pass", async () => {
      const flushMicrotasks = (): Promise<void> =>
        new Promise<void>((resolve) => setImmediate(resolve));

      const callLog: string[] = [];
      const handler =
        (name: string) =>
        async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
          callLog.push(name);
          return { healthy: true, value: "ok" };
        };

      const handlerMap: HandlerMap = new Map([
        ["observer-a", handler("observer-a")],
        ["observer-b", handler("observer-b")],
        ["observer-c", handler("observer-c")],
        ["observer-d", handler("observer-d")],
      ]);

      // soakStage is now integrated — do NOT await runChain directly.
      // Drain handler-gate microtasks so soakStage is called and its first
      // poll timer is registered on the fake clock before we start advancing.
      const chainPromise = runChain(store, "feat-deploy", handlerMap, clock);
      await flushMicrotasks();

      // Advance through staging soak (5m at 60_000ms poll intervals = 5 advances).
      for (let i = 0; i < 5; i++) {
        clock.advance(60_000);
        await flushMicrotasks();
      }

      // After the 5th staging advance the soak resolves: runChain transitions to
      // production, runs the production handler gate, and registers the first
      // production poll timer — all within the microtask queue drained above.
      // Advance through production soak (2m at 60_000ms poll intervals = 2 advances).
      for (let i = 0; i < 2; i++) {
        clock.advance(60_000);
        await flushMicrotasks();
      }

      const outcome: ChainOutcome = await chainPromise;

      // Full expected invocation sequence (handler gate once + soak polls):
      // - staging: gate [a,b,c] + 5 soak polls × [a,b,c] = 6 × [a,b,c]
      // - production: gate [d] + 2 soak polls × [d] = 3 × [d]
      // Ordering: all staging (a before b before c) before any production (d).
      const abc = ["observer-a", "observer-b", "observer-c"];
      const expectedLog: string[] = [
        ...abc, ...abc, ...abc, ...abc, ...abc, ...abc, // 6 × staging (gate + 5 polls)
        "observer-d", "observer-d", "observer-d",       // 3 × production (gate + 2 polls)
      ];
      assert.deepEqual(
        callLog,
        expectedLog,
        "handlers invoked in declared order: staging gate (a,b,c) + 5 soak polls, production gate (d) + 2 soak polls",
      );
      assert.equal(outcome.result, "pass", "all-pass chain resolves to pass");
    });
  });

  // ---------------------------------------------------------------------------
  // T3 — regression: soak window enforced (BLOCKER chain-soak-not-integrated)
  //
  // runChain must NOT resolve "pass" until soakStage has run across the full
  // soak window on the fake clock. This test fails against the current runChain
  // (which resolves immediately after handlers pass, with no soak call).
  // ---------------------------------------------------------------------------
  describe("T3 — soak-not-integrated regression: pass requires full soak on fake clock", () => {
    // Drain all pending microtasks (same pattern as soak.test.ts).
    const flushMicrotasks = (): Promise<void> =>
      new Promise<void>((resolve) => setImmediate(resolve));

    let featDir = "";
    let testDir = "";
    let store: Store;
    let clock: FakeClock;

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t3-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-a.md"), TASK_A_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t3-db-"));
      const dbPath = join(testDir, "test.db");
      store = openStore(dbPath, { busyTimeout: 1000 });
      clock = new FakeClock(0);
      await compile(featDir, store, { repoRegistry: ["backend"] });
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    test("all handlers healthy but chain does not resolve pass until fake clock has advanced through the staging and production soak windows", async () => {
      // All observers always healthy — the only gate blocking pass is the soak window.
      const alwaysHealthy = async (
        _stageId: string,
        _clock: Clock,
      ): Promise<{ healthy: boolean; value: unknown }> => ({ healthy: true, value: "ok" });

      const handlerMap: HandlerMap = new Map([
        ["observer-a", alwaysHealthy],
        ["observer-b", alwaysHealthy],
        ["observer-c", alwaysHealthy],
        ["observer-d", alwaysHealthy],
      ]);

      let resolved = false;
      const chainPromise = runChain(store, "feat-deploy", handlerMap, clock).then(
        (r) => {
          resolved = true;
          return r;
        },
      );

      // Drain microtasks: handlers can resolve in the microtask queue,
      // but NO clock.advance() has been called — no soak timer should have fired.
      await flushMicrotasks();

      // RED ASSERTION: current runChain resolves immediately after all handlers pass
      // (no soakStage call), so resolved === true here — this assertion FAILS (RED).
      // Once soakStage is integrated into runChain, the chain parks waiting for
      // clock timers and resolved stays false until clock.advance() fires them.
      assert.equal(
        resolved,
        false,
        "chain must NOT resolve before soak window elapsed: no clock.advance() has been called yet",
      );

      // Advance through staging soak (5m = 300_000ms) at 60_000ms poll intervals.
      // The fixture declares soak_duration: "5m" → 300_000ms / 60_000ms = 5 polls.
      for (let i = 0; i < 5; i++) {
        clock.advance(60_000);
        await flushMicrotasks();
      }

      // Advance through production soak (2m = 120_000ms) at 60_000ms poll intervals.
      // The fixture declares soak_duration: "2m" → 120_000ms / 60_000ms = 2 polls.
      for (let i = 0; i < 2; i++) {
        clock.advance(60_000);
        await flushMicrotasks();
      }

      // After both soak windows elapse on the fake clock, the chain must resolve to pass.
      const outcome: ChainOutcome = await chainPromise;
      assert.equal(
        outcome.result,
        "pass",
        "chain resolves to pass after both staging (5m) and production (2m) soak windows elapse on the fake clock",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T4 — regression: soak-window-history dropped at chain boundary
  //
  // runChain (chain.ts:~192-203) converts SoakEvidence → ObserverEvidence but
  // currently drops soakWindowHistory. The EPIC gate requires soak-fail evidence
  // to include the soak-window history. This test fails now (evidence.soakWindowHistory
  // is undefined) and passes once runChain carries it through.
  // ---------------------------------------------------------------------------
  describe("T4 — soak-window-history-dropped-at-chain-boundary regression", () => {
    const flushMicrotasks = (): Promise<void> =>
      new Promise<void>((resolve) => setImmediate(resolve));

    let featDir = "";
    let testDir = "";
    let store: Store;
    let clock: FakeClock;

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t4-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-a.md"), TASK_A_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-chain-t4-db-"));
      const dbPath = join(testDir, "test.db");
      store = openStore(dbPath, { busyTimeout: 1000 });
      clock = new FakeClock(0);
      await compile(featDir, store, { repoRegistry: ["backend"] });
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    test("soak-fail evidence surfaced through runChain includes soakWindowHistory from prior healthy polls", async () => {
      // observer-a flips: healthy on the handler gate (call 1) and soak poll 1 (call 2),
      // unhealthy from soak poll 2 (call 3+) — simulates a mid-soak degradation.
      let observerACallCount = 0;

      const handlerMap: HandlerMap = new Map([
        [
          "observer-a",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            observerACallCount++;
            if (observerACallCount <= 2) {
              return { healthy: true, value: "ok" };
            }
            return { healthy: false, value: "degraded-mid-soak" };
          },
        ],
        [
          "observer-b",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            return { healthy: true, value: "ok" };
          },
        ],
        [
          "observer-c",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            return { healthy: true, value: "ok" };
          },
        ],
        [
          "observer-d",
          async (_stageId: string, _clock: Clock): Promise<{ healthy: boolean; value: unknown }> => {
            return { healthy: true, value: "ok" };
          },
        ],
      ]);

      const chainPromise = runChain(store, "feat-deploy", handlerMap, clock);
      // Handler gate runs for staging (observer-a call 1, b, c) — all healthy.
      await flushMicrotasks();

      // Soak poll 1 (t=60_000): observer-a call 2 → healthy; soak continues.
      clock.advance(60_000);
      await flushMicrotasks();

      // Soak poll 2 (t=120_000): observer-a call 3 → unhealthy; soakStage resolves on_fail.
      clock.advance(60_000);
      await flushMicrotasks();

      const outcome: ChainOutcome = await chainPromise;
      assert.equal(
        outcome.result,
        "halt_and_escalate",
        "mid-soak flip in staging soak resolves to halt_and_escalate",
      );

      if (outcome.result === "halt_and_escalate") {
        assert.equal(
          outcome.evidence.observer,
          "observer-a",
          "evidence names the failing observer",
        );

        // REGRESSION: soakWindowHistory must be carried through runChain from SoakEvidence.
        // Currently runChain builds ObserverEvidence with only 4 fields and drops history.
        // Cast through unknown to access the runtime property without TypeScript blocking.
        const evAny = outcome.evidence as unknown as Record<string, unknown>;
        const history = evAny["soakWindowHistory"];
        assert.ok(
          Array.isArray(history) && history.length >= 1,
          `soak-fail evidence surfaced through runChain must include soakWindowHistory with at least one prior healthy poll (soak poll 1 at t=60_000); got: ${JSON.stringify(history)}`,
        );

        // First entry must record the healthy poll at t=60_000.
        type HistoryEntry = { clockInstant: number; results: Array<{ observer: string; healthy: boolean; value: unknown }> };
        const firstEntry = (history as HistoryEntry[])[0];
        assert.ok(firstEntry !== undefined, "first soakWindowHistory entry must exist");
        assert.equal(
          firstEntry.clockInstant,
          60_000,
          "first soak poll at t=60_000 recorded in soakWindowHistory",
        );
        const firstResult = firstEntry.results[0];
        assert.ok(firstResult !== undefined, "first poll result must exist");
        assert.equal(
          firstResult.healthy,
          true,
          "first soak poll shows observer-a was healthy — proves flip happened mid-soak not upfront",
        );
      }
    });
  });
});
