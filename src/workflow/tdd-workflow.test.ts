import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateOutcome, GateResult, GateResultSink, Workflow } from "./workflow.ts";
import { TddWorkflow } from "./tdd-workflow.ts";
import { FeatureStore } from "../store/feature-store.ts";

// ---------------------------------------------------------------------------
// Helpers — hand-rolled fakes/mocks (no mocking library)
// ---------------------------------------------------------------------------

/** Mock sink: captures every recorded result in insertion order. */
class MockSink implements GateResultSink {
  readonly recorded: Array<{ phase: string; result: GateResult }> = [];
  record(phase: string, result: GateResult): void {
    this.recorded.push({ phase, result });
  }
}

/**
 * Controllable sink: identical to MockSink but `throwNext = true` causes the
 * next `record()` call to throw before persisting anything — simulates a
 * mid-write crash to test partial-gateCheck durability.
 */
class ControllableSink implements GateResultSink {
  readonly recorded: Array<{ phase: string; result: GateResult }> = [];
  throwNext = false;
  record(phase: string, result: GateResult): void {
    if (this.throwNext) throw new Error("sink write failed");
    this.recorded.push({ phase, result });
  }
}

/**
 * S3 regression: async sink — record() returns a macrotask-delayed Promise that
 * the caller must await.  Using setTimeout (not Promise.resolve) so it can never
 * accidentally pass because of microtask ordering.
 */
class AsyncMockSink {
  readonly recorded: Array<{ phase: string; result: GateResult }> = [];
  record(phase: string, result: GateResult): Promise<void> {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        this.recorded.push({ phase, result });
        resolve();
      }, 0);
    });
  }
}

// ---------------------------------------------------------------------------
// Suite: src/workflow/tdd-workflow
// ---------------------------------------------------------------------------

describe("src/workflow/tdd-workflow", () => {
  // -------------------------------------------------------------------------
  // Phases, version, initial state
  // -------------------------------------------------------------------------

  describe("TddWorkflow — phases and version", () => {
    test("phases are ordered: failing_test_exists then tests_pass", () => {
      const wf = new TddWorkflow({}, new MockSink());
      assert.deepEqual(
        [...wf.phases],
        ["failing_test_exists", "tests_pass"],
        "tdd@1 must declare exactly two phases in entry→exit order",
      );
    });

    test("version identifier is tdd@1", () => {
      const wf = new TddWorkflow({}, new MockSink());
      assert.equal(wf.version, "tdd@1", "version field must be the literal string tdd@1");
    });

    test("currentPhase() starts at the entry phase failing_test_exists", () => {
      const wf = new TddWorkflow({}, new MockSink());
      assert.equal(
        wf.currentPhase(),
        "failing_test_exists",
        "the first current phase must be failing_test_exists (entry gate)",
      );
    });
  });

  // -------------------------------------------------------------------------
  // gateCheck three outcomes
  // -------------------------------------------------------------------------

  describe("TddWorkflow — gateCheck returns scripted outcomes", () => {
    test("gateCheck returns pass for the entry gate when scripted pass", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      const outcome = await wf.gateCheck("failing_test_exists");
      assert.equal(outcome.outcome, "pass");
    });

    test("gateCheck returns fail for the exit gate when scripted fail", async () => {
      const wf = new TddWorkflow({ tests_pass: "fail" }, new MockSink());
      const outcome = await wf.gateCheck("tests_pass");
      assert.equal(outcome.outcome, "fail");
    });

    test("gateCheck returns needs_human for the needs-human scripted case", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "needs_human" }, new MockSink());
      const outcome = await wf.gateCheck("failing_test_exists");
      assert.equal(outcome.outcome, "needs_human");
    });
  });

  // -------------------------------------------------------------------------
  // gateCheck records outcomes to the gate-result sink
  // -------------------------------------------------------------------------

  describe("TddWorkflow — gateCheck records to the gate-result sink", () => {
    test("each gateCheck call records the phase and outcome to the sink", async () => {
      const sink = new MockSink();
      const wf = new TddWorkflow(
        { failing_test_exists: "pass", tests_pass: "fail" },
        sink,
      );

      await wf.gateCheck("failing_test_exists");
      await wf.gateCheck("tests_pass");

      assert.equal(
        sink.recorded.length,
        2,
        "two gateCheck calls must produce two sink records",
      );

      const r0 = sink.recorded[0];
      const r1 = sink.recorded[1];
      assert.ok(r0 !== undefined, "first record must exist");
      assert.ok(r1 !== undefined, "second record must exist");
      assert.deepEqual(r0, { phase: "failing_test_exists", result: { outcome: "pass" } });
      assert.deepEqual(r1, { phase: "tests_pass", result: { outcome: "fail" } });
    });

    test("needs_human outcome is also recorded to the sink", async () => {
      const sink = new MockSink();
      const wf = new TddWorkflow({ failing_test_exists: "needs_human" }, sink);

      await wf.gateCheck("failing_test_exists");

      assert.equal(sink.recorded.length, 1);
      const r = sink.recorded[0];
      assert.ok(r !== undefined);
      assert.deepEqual(r, { phase: "failing_test_exists", result: { outcome: "needs_human" } });
    });
  });

  // -------------------------------------------------------------------------
  // currentPhase advances on pass, stays on non-pass
  // -------------------------------------------------------------------------

  describe("TddWorkflow — currentPhase advances after passing gate", () => {
    test("currentPhase advances to tests_pass after the entry gate passes", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      await wf.gateCheck("failing_test_exists");
      assert.equal(
        wf.currentPhase(),
        "tests_pass",
        "after passing failing_test_exists the current phase must be tests_pass",
      );
    });

    test("currentPhase stays at failing_test_exists when the entry gate returns fail", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "fail" }, new MockSink());
      await wf.gateCheck("failing_test_exists");
      assert.equal(
        wf.currentPhase(),
        "failing_test_exists",
        "a fail result must not advance currentPhase",
      );
    });

    test("currentPhase stays at failing_test_exists when the gate returns needs_human", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "needs_human" }, new MockSink());
      await wf.gateCheck("failing_test_exists");
      assert.equal(
        wf.currentPhase(),
        "failing_test_exists",
        "a needs_human result must not advance currentPhase",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Partial gateCheck durability — interrupted write leaves state unchanged
  // -------------------------------------------------------------------------

  describe("TddWorkflow — partial gateCheck leaves sink and phase unchanged", () => {
    test("interrupted gateCheck (sink throws) leaves the sink empty and currentPhase un-advanced", async () => {
      const sink = new ControllableSink();
      sink.throwNext = true;

      const wf = new TddWorkflow({ failing_test_exists: "pass" }, sink);

      await assert.rejects(
        wf.gateCheck("failing_test_exists"),
        { message: "sink write failed" },
        "gateCheck must propagate the sink write error",
      );

      assert.equal(
        sink.recorded.length,
        0,
        "no entry must be recorded to the sink after an interrupted gateCheck",
      );

      assert.equal(
        wf.currentPhase(),
        "failing_test_exists",
        "currentPhase must not advance after an interrupted gateCheck",
      );
    });
  });

  // -------------------------------------------------------------------------
  // T2: checkpoint() rewrites STATE.md + appends JOURNAL via Epic 003 store
  // -------------------------------------------------------------------------

  describe("TddWorkflow — checkpoint() writes STATE + JOURNAL", () => {
    test(
      "checkpoint() rewrites STATE.md with the current phase",
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "tdd-wf-ckpt-"));
        try {
          const store = new FeatureStore(dir);
          await mkdir(join(dir, "s1"), { recursive: true });

          const wf = new TddWorkflow(
            {},
            new MockSink(),
            { store, storyId: "s1", taskStem: "t1" },
          );
          await wf.checkpoint();

          const content = await readFile(join(dir, "s1", "t1.state.md"), "utf8");
          assert.ok(
            content.includes("failing_test_exists"),
            "STATE.md must contain the current phase name",
          );
        } finally {
          await rm(dir, { recursive: true });
        }
      },
    );

    test(
      "checkpoint() appends one journal event per invocation",
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "tdd-wf-ckpt-"));
        try {
          const store = new FeatureStore(dir);
          await mkdir(join(dir, "s1"), { recursive: true });

          const wf = new TddWorkflow(
            {},
            new MockSink(),
            { store, storyId: "s1", taskStem: "t1" },
          );

          await wf.checkpoint();
          const j1 = await store.readJournal("s1", "t1");
          assert.equal(j1.length, 1, "one journal event after first checkpoint");

          await wf.checkpoint();
          const j2 = await store.readJournal("s1", "t1");
          assert.equal(j2.length, 2, "two journal events after second checkpoint");
        } finally {
          await rm(dir, { recursive: true });
        }
      },
    );

    test(
      "two checkpoint() calls rewrite STATE to the latest phase and accumulate journal events",
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "tdd-wf-ckpt-"));
        try {
          const store = new FeatureStore(dir);
          await mkdir(join(dir, "s1"), { recursive: true });

          const wf = new TddWorkflow(
            { failing_test_exists: "pass" },
            new MockSink(),
            { store, storyId: "s1", taskStem: "t1" },
          );

          await wf.checkpoint(); // phase = failing_test_exists
          await wf.gateCheck("failing_test_exists"); // advance currentPhase → tests_pass
          await wf.checkpoint(); // phase = tests_pass

          const content = await readFile(join(dir, "s1", "t1.state.md"), "utf8");
          assert.ok(
            content.includes("tests_pass"),
            "STATE.md must reflect the latest current phase after phase advance",
          );

          const journal = await store.readJournal("s1", "t1");
          assert.equal(journal.length, 2, "two journal events total after two checkpoints");
        } finally {
          await rm(dir, { recursive: true });
        }
      },
    );
  });

  // -------------------------------------------------------------------------
  // T2: named status events observable to a caller
  // -------------------------------------------------------------------------

  describe("TddWorkflow — status events", () => {
    test("gateCheck emits gate_checked event with phase and outcome", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      const received: Array<{ phase: string; outcome: GateOutcome }> = [];
      wf.on("gate_checked", (e: { phase: string; outcome: GateOutcome }) =>
        received.push(e),
      );

      await wf.gateCheck("failing_test_exists");

      assert.equal(received.length, 1, "one gate_checked event per gateCheck call");
      const ev = received[0];
      assert.ok(ev !== undefined);
      assert.deepEqual(ev, { phase: "failing_test_exists", outcome: "pass" });
    });

    test("passing gateCheck emits phase_changed event", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      let phaseChangedFired = false;
      wf.on("phase_changed", () => {
        phaseChangedFired = true;
      });

      await wf.gateCheck("failing_test_exists");

      assert.ok(phaseChangedFired, "phase_changed event must fire when gateCheck returns pass");
    });

    test("passing gateCheck emits phase_started event for the new phase", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      let startedPhase: string | undefined;
      wf.on("phase_started", (e: { phase: string }) => {
        startedPhase = e.phase;
      });

      await wf.gateCheck("failing_test_exists");

      assert.equal(
        startedPhase,
        "tests_pass",
        "phase_started event must carry the name of the newly active phase",
      );
    });

    test("checkpoint() emits checkpoint_written event", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tdd-wf-evt-"));
      try {
        const store = new FeatureStore(dir);
        await mkdir(join(dir, "s1"), { recursive: true });

        const wf = new TddWorkflow(
          {},
          new MockSink(),
          { store, storyId: "s1", taskStem: "t1" },
        );
        let checkpointWrittenFired = false;
        wf.on("checkpoint_written", () => {
          checkpointWrittenFired = true;
        });

        await wf.checkpoint();

        assert.ok(checkpointWrittenFired, "checkpoint_written event must fire after checkpoint()");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // S2 regression: Workflow interface must expose a typed on() so a variable
  // annotated as Workflow (not TddWorkflow/EventEmitter) can subscribe.
  // Currently fails typecheck: Property 'on' does not exist on type 'Workflow'.
  // -------------------------------------------------------------------------

  describe("TddWorkflow — Workflow interface typed event subscription (S2 regression)", () => {
    test("caller typed as Workflow can subscribe to gate_checked event via on()", async () => {
      // wf is held as Workflow, not TddWorkflow — Workflow must declare on()
      const wf: Workflow = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      const received: Array<{ phase: string; outcome: GateOutcome }> = [];
      wf.on("gate_checked", (e: { phase: string; outcome: GateOutcome }) => received.push(e));
      await wf.gateCheck("failing_test_exists");
      assert.equal(received.length, 1, "gate_checked listener must fire when wf is typed as Workflow");
    });

    test("caller typed as Workflow can subscribe to phase_started event via on()", async () => {
      const wf: Workflow = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      let startedPhase: string | undefined;
      wf.on("phase_started", (e: { phase: string }) => {
        startedPhase = e.phase;
      });
      await wf.gateCheck("failing_test_exists");
      assert.equal(startedPhase, "tests_pass", "phase_started listener must fire when wf is typed as Workflow");
    });
  });

  // -------------------------------------------------------------------------
  // S3 regression: gateCheck must await the return value of GateResultSink.record()
  // when it is async.  Currently gateCheck is synchronous and drops the Promise.
  // -------------------------------------------------------------------------

  describe("TddWorkflow — gateCheck awaits async GateResultSink (S3 regression)", () => {
    test("gateCheck awaits async record — result is present after gateCheck resolves", async () => {
      const sink = new AsyncMockSink();
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, sink);
      // gateCheck is currently sync (returns GateOutcome); awaiting it does NOT
      // flush the macrotask-delayed sink.record → sink.recorded stays empty → RED
      await wf.gateCheck("failing_test_exists");
      assert.equal(
        sink.recorded.length,
        1,
        "sink must have the record after gateCheck resolves — fails if gateCheck does not await record()",
      );
    });
  });

  // -------------------------------------------------------------------------
  // T1 (019.3): GateResult contract — gateCheck returns { outcome, summary? }
  // -------------------------------------------------------------------------

  describe("TddWorkflow — gateCheck returns GateResult (Story 001 T1, Epic 019.3)", () => {
    test("gateCheck with pass outcome returns a GateResult object, not a bare string", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      const result = await wf.gateCheck("failing_test_exists");
      assert.equal(
        typeof result,
        "object",
        "gateCheck must return a GateResult object; a bare string means the seam is not yet extended",
      );
      assert.equal(result.outcome, "pass");
      assert.equal(result.summary, undefined, "pass result must carry no summary");
    });

    test("gateCheck scripted with GateResult fail+summary — result carries the summary", async () => {
      const failResult: GateResult = { outcome: "fail", summary: "3 tests failed: foo, bar, baz" };
      const wf = new TddWorkflow({ tests_pass: failResult }, new MockSink());
      const result = await wf.gateCheck("tests_pass");
      assert.deepEqual(result, { outcome: "fail", summary: "3 tests failed: foo, bar, baz" });
    });

    test("gateCheck scripted with bare pass GateOutcome string — result has no summary", async () => {
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, new MockSink());
      const result = await wf.gateCheck("failing_test_exists");
      assert.equal(result.outcome, "pass");
      assert.equal(result.summary, undefined);
    });

    test("sink.record receives GateResult including summary when present", async () => {
      const sink = new MockSink();
      const failResult: GateResult = { outcome: "fail", summary: "error details" };
      const wf = new TddWorkflow({ tests_pass: failResult }, sink);
      await wf.gateCheck("tests_pass");
      assert.equal(sink.recorded.length, 1);
      const r = sink.recorded[0];
      assert.ok(r !== undefined);
      assert.equal(r.phase, "tests_pass");
      assert.deepEqual(r.result, { outcome: "fail", summary: "error details" });
    });

    test("sink.record receives GateResult with no summary for pass outcome", async () => {
      const sink = new MockSink();
      const wf = new TddWorkflow({ failing_test_exists: "pass" }, sink);
      await wf.gateCheck("failing_test_exists");
      assert.equal(sink.recorded.length, 1);
      const r = sink.recorded[0];
      assert.ok(r !== undefined);
      assert.equal(r.phase, "failing_test_exists");
      assert.equal(r.result.outcome, "pass");
      assert.equal(r.result.summary, undefined);
    });
  });
});
