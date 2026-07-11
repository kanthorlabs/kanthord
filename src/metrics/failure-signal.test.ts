import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import {
  initTaskTimelineSchema,
  appendTimelineEvent,
  readTimelineEvents,
} from "./task-timeline.ts";
import {
  deriveFailureSignal,
  setRootCauseAttribution,
  type FailureSource,
  type ObservedFailureSignal,
} from "./failure-signal.ts";

describe(
  "Story 004 T1 (Epic 019.5) — observed_failure_signal derived from concrete events",
  () => {
    test("T1: ring-1 block source maps to tool_blocked", () => {
      const src: FailureSource = { kind: "ring1_block", tool: "bash" };
      assert.equal(deriveFailureSignal(src), "tool_blocked");
    });

    test("T1: budget halt source maps to budget_breach", () => {
      const src: FailureSource = { kind: "budget_halt" };
      assert.equal(deriveFailureSignal(src), "budget_breach");
    });

    test("T1: broker op failure maps to broker_failed", () => {
      const src: FailureSource = { kind: "broker_op_fail", op: "submit" };
      assert.equal(deriveFailureSignal(src), "broker_failed");
    });

    test("T1: gate failure maps to gate_failed", () => {
      const src: FailureSource = { kind: "gate_fail" };
      assert.equal(deriveFailureSignal(src), "gate_failed");
    });

    test("T1: provider_error rate_limited maps to rate_limited", () => {
      const src: FailureSource = {
        kind: "provider_error",
        typed_error: "rate_limited",
      };
      assert.equal(deriveFailureSignal(src), "rate_limited");
    });

    test("T1: provider_error quota_exhausted maps to quota_exhausted", () => {
      const src: FailureSource = {
        kind: "provider_error",
        typed_error: "quota_exhausted",
      };
      assert.equal(deriveFailureSignal(src), "quota_exhausted");
    });

    test("T1: provider_error auth_failed maps to auth_failed", () => {
      const src: FailureSource = {
        kind: "provider_error",
        typed_error: "auth_failed",
      };
      assert.equal(deriveFailureSignal(src), "auth_failed");
    });

    test(
      "T1: gate_fail for prompt/model-weird case — signal is gate_failed; " +
        "deriveFailureSignal returns a plain string (no suspected_root_cause from machine)",
      () => {
        const src: FailureSource = { kind: "gate_fail" };
        const signal: ObservedFailureSignal = deriveFailureSignal(src);
        assert.equal(signal, "gate_failed");
        // The machine path returns a plain ObservedFailureSignal string — not an object
        // carrying suspected_root_cause. This structurally enforces the "no machine
        // writer sets suspected_root_cause" invariant from the Story 004 AC.
        assert.equal(typeof signal, "string");
      },
    );
  },
);

describe(
  "Story 004 T2 (Epic 019.5) — human-confirmed suspected_root_cause via the inbox path",
  () => {
    let tmpDir = "";
    let store: Store;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "kanthord-fsrc-"));
      store = openStore(join(tmpDir, "attr.db"), { busyTimeout: 1000 });
      initTaskTimelineSchema(store);
    });

    after(async () => {
      store.close();
      await rm(tmpDir, { recursive: true });
    });

    test(
      "T2: setRootCauseAttribution appends an attribution event with " +
        "suspected_root_cause and root_cause_confidence",
      () => {
        // Append a machine gate-fail event (the human is attributing this)
        appendTimelineEvent(store, {
          task_id: "task-t2a",
          attempt: 1,
          correlation_id: "task-t2a:1",
          kind: "gate_failed",
          ts: 1000,
          observed_failure_signal: "gate_failed",
        });

        // Human inbox response sets the attribution
        setRootCauseAttribution(store, {
          task_id: "task-t2a",
          attempt: 1,
          correlation_id: "task-t2a:1",
          suspected_root_cause: "prompt_issue",
          root_cause_confidence: "medium",
        });

        const events = readTimelineEvents(store,"task-t2a");
        const attrEvent = events.find(
          (e) => (e as Record<string, unknown>)["kind"] === "root_cause_attribution",
        );
        assert.ok(attrEvent, "attribution event must exist in the timeline");
        const ev = attrEvent as Record<string, unknown>;
        assert.equal(
          ev["suspected_root_cause"],
          "prompt_issue",
          "suspected_root_cause must match the human-set value",
        );
        assert.equal(
          ev["root_cause_confidence"],
          "medium",
          "root_cause_confidence must match the human-set value",
        );
      },
    );

    test(
      "T2: machine-written timeline event has suspected_root_cause unset " +
        "(machine writers must not set it)",
      () => {
        // Machine appends a gate_failed event with no attribution fields
        appendTimelineEvent(store, {
          task_id: "task-t2b",
          attempt: 1,
          correlation_id: "task-t2b:1",
          kind: "gate_failed",
          ts: 2000,
          observed_failure_signal: "gate_failed",
        });

        const events = readTimelineEvents(store,"task-t2b");
        assert.equal(events.length, 1, "exactly one machine-written event");
        const ev = events[0] as Record<string, unknown>;
        assert.ok(
          ev["suspected_root_cause"] == null,
          `machine-written event must not have suspected_root_cause set; ` +
            `got: ${String(ev["suspected_root_cause"])}`,
        );
        assert.ok(
          ev["root_cause_confidence"] == null,
          `machine-written event must not have root_cause_confidence set; ` +
            `got: ${String(ev["root_cause_confidence"])}`,
        );
      },
    );
  },
);

// ---------------------------------------------------------------------------
// BLOCKER S3 regression (Epic 019.5) — setRootCauseAttribution must NOT self-migrate
// ---------------------------------------------------------------------------

describe(
  "BLOCKER S3 regression (Epic 019.5) — setRootCauseAttribution must not self-migrate task_timeline_event",
  () => {
    test("BLOCKER S3: setRootCauseAttribution throws 'no such table' on uninitialised store", async () => {
      // setRootCauseAttribution currently calls initTaskTimelineSchema (self-migration)
      // before appendTimelineEvent, so it succeeds on an uninitialised store.
      // After the fix it must throw "no such table".
      const noSchemaDir = await mkdtemp(join(tmpdir(), "kanthord-fs-s3-"));
      const noSchemaStore = openStore(join(noSchemaDir, "no-schema.db"), { busyTimeout: 1000 });
      try {
        assert.throws(
          () =>
            setRootCauseAttribution(noSchemaStore, {
              task_id: "t-s3",
              attempt: 1,
              correlation_id: "t-s3:1",
              suspected_root_cause: "prompt_issue",
              root_cause_confidence: "medium",
            }),
          /no such table/,
          "setRootCauseAttribution must not self-migrate task_timeline_event; must throw on uninitialised store",
        );
      } finally {
        noSchemaStore.close();
        await rm(noSchemaDir, { recursive: true, force: true });
      }
    });
  },
);
