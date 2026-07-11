import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import {
  appendTimelineEvent,
  readTimelineEvents,
  type TimelineEvent,
} from "./task-timeline.ts";
import { recordEvidence } from "../scheduler/attempt-evidence.ts";
import { JsonlLog } from "../foundations/jsonl.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { writeLedgerEntry } from "../broker/ledger.ts";
import type { LedgerEntry } from "../broker/ledger.ts";
import { recordInteraction } from "./interaction-capture.ts";
import type { RecordInteractionOpts } from "./interaction-capture.ts";

// ---------------------------------------------------------------------------
// Suite: src/metrics/task-timeline
//
// Story 002 T1 (Epic 019.5) — append-only task_timeline_event store
// ---------------------------------------------------------------------------

describe("Story 002 T1 (Epic 019.5) — append-only task_timeline_event store", () => {
  let tmpDir = "";
  let store: Store;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-tl-"));
    store = openStore(join(tmpDir, "timeline.db"), { busyTimeout: 1000 });
    initSchema(store);
  });

  after(async () => {
    store.close();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test("T1: events appended for a task/attempt read back in occurrence order with all required fields", () => {
    const task_id = "task-s002t1-a";
    const correlation_id = `corr-${task_id}`;

    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "spawn",
      ts: 1000,
      summary: "session spawned",
    });
    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "tool_call",
      ts: 2000,
      summary: "tool executed",
    });
    appendTimelineEvent(store, {
      task_id,
      attempt: 1,
      correlation_id,
      kind: "gate_failed",
      ts: 3000,
      observed_failure_signal: "gate_failed",
      summary: "gate check failed",
    });

    const events = readTimelineEvents(store, task_id);
    const attempt1 = events.filter((e) => e.attempt === 1);

    assert.equal(attempt1.length, 3, "all three events must be returned");
    // occurrence order: ts ascending
    assert.equal(attempt1[0]?.kind, "spawn");
    assert.equal(attempt1[1]?.kind, "tool_call");
    assert.equal(attempt1[2]?.kind, "gate_failed");

    // required fields present
    const gate = attempt1[2] as TimelineEvent;
    assert.match(gate.event_id, /^evt_[0-9A-HJKMNP-TV-Z]{26}$/, "event_id must match ^evt_<26-char Crockford base32>$");
    assert.equal(gate.task_id, task_id);
    assert.equal(gate.attempt, 1);
    assert.equal(gate.correlation_id, correlation_id);
    assert.equal(gate.observed_failure_signal, "gate_failed");
    assert.equal(gate.summary, "gate check failed");
    assert.equal(gate.ts, 3000);
  });

  test("T1: events for a second attempt are ordered under that attempt (not mixed with attempt 1)", () => {
    const task_id = "task-s002t1-b";
    const correlation_id = `corr-${task_id}`;

    appendTimelineEvent(store, { task_id, attempt: 1, correlation_id, kind: "spawn", ts: 100 });
    appendTimelineEvent(store, { task_id, attempt: 2, correlation_id, kind: "spawn", ts: 200 });
    appendTimelineEvent(store, { task_id, attempt: 2, correlation_id, kind: "tool_call", ts: 300 });

    const all = readTimelineEvents(store, task_id);
    const a1 = all.filter((e) => e.attempt === 1);
    const a2 = all.filter((e) => e.attempt === 2);

    assert.equal(a1.length, 1, "attempt 1 has exactly 1 event");
    assert.equal(a2.length, 2, "attempt 2 has exactly 2 events");
    assert.equal(a2[0]?.kind, "spawn");
    assert.equal(a2[1]?.kind, "tool_call");
  });

  test("T1: appendTimelineEvent throws 'no such table' on uninitialised store", async () => {
    const noSchemaDir = await mkdtemp(join(tmpdir(), "kanthord-tl-noschema-"));
    const noSchemaStore = openStore(join(noSchemaDir, "no-schema.db"), { busyTimeout: 1000 });
    try {
      assert.throws(
        () =>
          appendTimelineEvent(noSchemaStore, {
            task_id: "t-x",
            attempt: 1,
            correlation_id: "c-x",
            kind: "spawn",
            ts: 0,
          }),
        /no such table/,
        "appendTimelineEvent must not self-migrate; throws on uninitialised store",
      );
    } finally {
      noSchemaStore.close();
      await rm(noSchemaDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: src/metrics/task-timeline
//
// Story 002 T2 (Epic 019.5) — thread correlation_id through existing writers
// ---------------------------------------------------------------------------

describe("Story 002 T2 (Epic 019.5) — correlation_id threading through existing writers", () => {
  let tmpDir2 = "";
  let store2: Store;

  before(async () => {
    tmpDir2 = await mkdtemp(join(tmpdir(), "kanthord-tl-t2-"));
    store2 = openStore(join(tmpDir2, "timeline-t2.db"), { busyTimeout: 1000 });
    initSchema(store2);
  });

  after(async () => {
    store2.close();
    if (tmpDir2) await rm(tmpDir2, { recursive: true, force: true });
  });

  test("T2: recordEvidence emits an 'attempt_evidence' timeline event carrying a non-empty correlation_id", () => {
    const task_id = "task-t2-evid";
    const attempt = 1;

    // Call the current writer — it does NOT yet write to the timeline table.
    // After SE implements correlation threading, this writer must emit
    // a timeline event with kind "attempt_evidence".
    recordEvidence(store2, { taskId: task_id, attempt, phase: "failing_test_exists", summary: "RED: tests did not pass" });

    const events = readTimelineEvents(store2, task_id);
    const evidEvent = events.find((e: TimelineEvent) => e.kind === "attempt_evidence");

    assert.ok(
      evidEvent !== undefined,
      "recordEvidence must emit a timeline event with kind 'attempt_evidence'",
    );
    assert.equal(evidEvent.task_id, task_id, "timeline event must carry the correct task_id");
    assert.equal(evidEvent.attempt, attempt, "timeline event must carry the correct attempt number");
    assert.ok(
      typeof evidEvent.correlation_id === "string" && evidEvent.correlation_id.length > 0,
      "timeline event must carry a non-empty correlation_id derived from task_id + attempt",
    );
  });

  test("T2: reconstruction — attempt_evidence + gate + session events share one correlation_id in ts-ascending order", () => {
    const task_id = "task-t2-recon";
    const attempt = 1;
    // The correlation_id all writers derive for this task/attempt
    const correlation_id = `${task_id}:${attempt}`;

    // Capture a wall-clock base BEFORE the recordEvidence call so the scripted
    // events can be placed after it (base + offset). After the S4 fix, evidence
    // ts = Date.now() ≈ base, and the scripted ts values (base+1000, base+2000)
    // will be strictly larger, preserving ts-ascending order without relying on
    // the legacy ts=attempt (1) logical-counter sentinel.
    const base = Date.now();

    // Drive attempt-evidence writer (emits attempt_evidence timeline event)
    recordEvidence(store2, { taskId: task_id, attempt, phase: "failing_test_exists", summary: "test runner failed" });

    // Directly append events for the other writers that SE will thread (gate, session)
    // Scripted ts values are base + positive offset so they sort after evidence.
    appendTimelineEvent(store2, {
      task_id,
      attempt,
      correlation_id,
      kind: "gate_failed",
      ts: base + 1000,
      observed_failure_signal: "gate_failed",
      summary: "gate check failed",
    });
    appendTimelineEvent(store2, {
      task_id,
      attempt,
      correlation_id,
      kind: "session_respawned",
      ts: base + 2000,
      summary: "respawn after gate failure",
    });

    const events = readTimelineEvents(store2, task_id);

    // Primary RED assertion: attempt_evidence must be in the timeline
    const evidEvent = events.find((e: TimelineEvent) => e.kind === "attempt_evidence");
    assert.ok(
      evidEvent !== undefined,
      "recordEvidence must emit an 'attempt_evidence' timeline event — required for reconstruction",
    );

    // Once present, all events must share the same correlation_id
    const corrIds = new Set(events.map((e: TimelineEvent) => e.correlation_id));
    assert.equal(corrIds.size, 1, "all timeline events for a task must share one correlation_id");

    // Reconstruction is in ts-ascending order
    const kinds = events.map((e: TimelineEvent) => e.kind);
    assert.ok(
      kinds.indexOf("attempt_evidence") < kinds.indexOf("gate_failed"),
      "attempt_evidence must precede gate_failed in the ordered timeline",
    );
    assert.ok(
      kinds.indexOf("gate_failed") < kinds.indexOf("session_respawned"),
      "gate_failed must precede session_respawned in the ordered timeline",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: src/metrics/task-timeline
//
// BLOCKER T2 regression (Epic 019.5) — correlation_id must be threaded through
// the real interaction-capture and broker op_ledger writers, not hand-seeded rows.
// ---------------------------------------------------------------------------

describe("BLOCKER T2 regression (Epic 019.5) — correlation_id threading through real writers", () => {
  let bDir = "";
  let bStore: Store;

  before(async () => {
    bDir = await mkdtemp(join(tmpdir(), "kanthord-tl-blocker-"));
    bStore = openStore(join(bDir, "blocker.db"), { busyTimeout: 1000 });
    initSchema(bStore);
    // Minimal FeatureStore dir: writeLedgerEntry only needs the story subdir for appendJournal
    await mkdir(join(bDir, "feature", "001-story"), { recursive: true });
  });

  after(async () => {
    bStore.close();
    if (bDir) await rm(bDir, { recursive: true, force: true });
  });

  test("BLOCKER: recordInteraction must emit an 'interaction' timeline event carrying the task's correlation_id", async () => {
    const task_id = "task-blocker-ic";
    const attempt = 1;
    const correlation_id = `${task_id}:${attempt}`;
    const log = new JsonlLog(join(bDir, "interactions-blocker.jsonl"));

    // Pass store + correlation_id as extra opts the SE must add to RecordInteractionOpts.
    // Currently both fields are silently ignored by recordInteraction → no timeline
    // event is written → the assertion below fails (RED).
    const rawOpts = {
      item_id: "int-blocker-001",
      task_id,
      feature_id: "feat-blocker",
      signal: "budget-breach",
      confirmed_category: "correction",
      actor: "operator",
      timestamp: 5000,
      cost_to_date: 10,
      no_ledger: false,
      log,
      store: bStore,
      correlation_id,
    };
    await recordInteraction(rawOpts as unknown as RecordInteractionOpts);

    const events = readTimelineEvents(bStore, task_id);
    const icEvent = events.find((e: TimelineEvent) => e.kind === "interaction");
    assert.ok(
      icEvent !== undefined,
      "recordInteraction must emit a task_timeline_event row with kind='interaction' — correlation_id threading not yet wired into interaction-capture writer",
    );
    assert.equal(icEvent.correlation_id, correlation_id, "interaction timeline event must carry the task's correlation_id");
  });

  test("BLOCKER: writeLedgerEntry must emit a 'broker_op' timeline event carrying the task's correlation_id", async () => {
    const task_id = "task-blocker-ledger";
    const attempt = 1;
    const correlation_id = `${task_id}:${attempt}`;
    const featureStore = new FeatureStore(join(bDir, "feature"));

    const entry: LedgerEntry = {
      op_id: "op-blocker-ledger-001",
      verb: "deploy_service",
      idempotency_key: "idem-blocker-001",
      correlation: correlation_id,
      desired_effect_hash: "sha256-test",
      status: "pending",
    };

    // The SE must add a 5th optional timelineOpts param to writeLedgerEntry so broker
    // ops also emit a task_timeline_event row. Currently the 5th arg is ignored →
    // no timeline event is written → the assertion below fails (RED).
    const writeLedgerEntryExt = writeLedgerEntry as unknown as (
      store: FeatureStore,
      storyId: string,
      taskStem: string,
      entry: LedgerEntry,
      timelineOpts?: { timelineStore: Store; task_id: string; attempt: number },
    ) => Promise<string>;
    await writeLedgerEntryExt(
      featureStore,
      "001-story",
      "001-task",
      entry,
      { timelineStore: bStore, task_id, attempt },
    );

    const events = readTimelineEvents(bStore, task_id);
    const opEvent = events.find((e: TimelineEvent) => e.kind === "broker_op");
    assert.ok(
      opEvent !== undefined,
      "writeLedgerEntry must emit a task_timeline_event row with kind='broker_op' — correlation_id threading not yet wired into broker op_ledger writer",
    );
    assert.equal(opEvent.correlation_id, correlation_id, "broker_op timeline event must carry the task's correlation_id");
  });
});

// ---------------------------------------------------------------------------
// BLOCKER S7 alias-removal regression (Epic 019.5)
// task-timeline.ts must NOT export "queryTaskTimeline" — that name belongs
// exclusively to timeline-query.ts (the enriched canonical query).
// ---------------------------------------------------------------------------
describe("BLOCKER S7 alias-removal regression (Epic 019.5) — task-timeline must not export queryTaskTimeline", () => {
  test("BLOCKER S7: task-timeline.ts does not export a queryTaskTimeline symbol", async () => {
    const mod = await import("./task-timeline.ts");
    assert.ok(
      !("queryTaskTimeline" in mod),
      "task-timeline.ts must not export queryTaskTimeline (the alias re-creates the dual-name violation flagged in BLOCKER S7); remove the backward-compat alias from task-timeline.ts",
    );
  });
});
