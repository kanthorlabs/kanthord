/**
 * Story 002 T1 (Epic 019.3) — durable bounded attempt-evidence store
 *
 * Seam under test: src/scheduler/attempt-evidence.ts
 *
 * Covers:
 *  - recording evidence (task, attempt, phase, summary) survives a simulated
 *    restart (fresh Store handle on the same file)
 *  - an over-cap summary is truncated to EVIDENCE_SUMMARY_CAP, not rejected
 *  - recording attempt 2 leaves attempt 1 still readable
 *  - latestEvidence returns the highest-attempt row only
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { readTimelineEvents, type TimelineEvent } from "../metrics/task-timeline.ts";
import {
  EVIDENCE_SUMMARY_CAP,
  recordEvidence,
  latestEvidence,
} from "./attempt-evidence.ts";

// ---------------------------------------------------------------------------
// Suite: src/scheduler/attempt-evidence
// ---------------------------------------------------------------------------

test("Story 002 T1 (Epic 019.3) — recorded evidence survives a simulated daemon restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-atev-"));
  const dbPath = join(dir, "test.db");
  try {
    // First handle — record
    const store1 = openStore(dbPath, { busyTimeout: 1000 });
    initSchema(store1);
    recordEvidence(store1, {
      taskId: "task-alpha",
      attempt: 1,
      phase: "tdd",
      summary: "3 tests red",
    });
    store1.close();

    // Second handle — simulates restart; must still find the row
    const store2 = openStore(dbPath, { busyTimeout: 1000 });
    const ev = latestEvidence(store2, "task-alpha");
    store2.close();

    assert.ok(ev !== null, "evidence must exist after restart");
    assert.equal(ev.taskId, "task-alpha");
    assert.equal(ev.attempt, 1);
    assert.equal(ev.phase, "tdd");
    assert.equal(ev.summary, "3 tests red");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 002 T1 (Epic 019.3) — over-cap summary is truncated to EVIDENCE_SUMMARY_CAP", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-atev-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    initSchema(store);
    const longSummary = "x".repeat(EVIDENCE_SUMMARY_CAP + 500);
    recordEvidence(store, {
      taskId: "task-beta",
      attempt: 1,
      phase: "tdd",
      summary: longSummary,
    });
    const ev = latestEvidence(store, "task-beta");
    store.close();

    assert.ok(ev !== null, "evidence must be recorded even when truncated");
    assert.equal(
      ev.summary.length,
      EVIDENCE_SUMMARY_CAP,
      `summary must be truncated to cap (${EVIDENCE_SUMMARY_CAP})`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 002 T1 (Epic 019.3) — recording attempt 2 leaves attempt 1 still readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-atev-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    initSchema(store);
    recordEvidence(store, {
      taskId: "task-gamma",
      attempt: 1,
      phase: "tdd",
      summary: "first fail",
    });
    recordEvidence(store, {
      taskId: "task-gamma",
      attempt: 2,
      phase: "tdd",
      summary: "second fail",
    });

    // Both rows must exist for audit purposes — query all rows directly
    const rows = store.all<{ attempt: number; summary: string }>(
      "SELECT attempt, summary FROM attempt_evidence WHERE task_id = ? ORDER BY attempt",
      "task-gamma",
    );
    store.close();

    assert.equal(rows.length, 2, "both attempt rows must be present");
    assert.equal(rows[0]?.attempt, 1);
    assert.equal(rows[0]?.summary, "first fail");
    assert.equal(rows[1]?.attempt, 2);
    assert.equal(rows[1]?.summary, "second fail");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 002 T1 (Epic 019.3) — latestEvidence returns the highest-attempt row only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-atev-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    initSchema(store);
    recordEvidence(store, {
      taskId: "task-delta",
      attempt: 1,
      phase: "tdd",
      summary: "attempt 1 summary",
    });
    recordEvidence(store, {
      taskId: "task-delta",
      attempt: 2,
      phase: "tdd",
      summary: "attempt 2 summary",
    });
    const ev = latestEvidence(store, "task-delta");
    store.close();

    assert.ok(ev !== null, "evidence must exist");
    assert.equal(ev.attempt, 2, "latestEvidence must return the highest attempt");
    assert.equal(ev.summary, "attempt 2 summary");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Story 002 T1 (Epic 019.3) — latestEvidence returns null when no evidence exists for the task", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-atev-"));
  const dbPath = join(dir, "test.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    const ev = latestEvidence(store, "task-no-evidence");
    store.close();
    assert.equal(ev, null, "must return null when no evidence exists");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// BLOCKER S4 regression (Epic 019.5) — recordEvidence must write a real
// wall-clock epoch-ms timestamp into task_timeline_event.ts, NOT the attempt
// integer. Every other writer uses Date.now(); mixing logical counters (1, 2, 3)
// with wall-clock milliseconds in the same column is semantically incorrect and
// breaks timeline ordering in production.
// ---------------------------------------------------------------------------

test("BLOCKER S4: recordEvidence emits attempt_evidence timeline event with ts >= Date.now() (wall-clock epoch-ms, not the attempt integer)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-atev-s4-"));
  const dbPath = join(dir, "s4.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 1000 });
    // initSchema required: after the S4 fix, recordEvidence will no longer
    // call initTaskTimelineSchema internally (per bootstrap-only DDL rule).
    initSchema(store);

    const before = Date.now();
    recordEvidence(store, {
      taskId: "task-s4-wallclock",
      attempt: 1,
      phase: "tdd",
      summary: "gate failed on attempt 1",
    });
    const after = Date.now();

    const events = readTimelineEvents(store, "task-s4-wallclock");
    const evidEvent = events.find((e: TimelineEvent) => e.kind === "attempt_evidence");

    assert.ok(
      evidEvent !== undefined,
      "recordEvidence must emit a task_timeline_event row with kind='attempt_evidence'",
    );

    // Fail now: ts === 1 (attempt integer); must be a real epoch-ms value
    assert.ok(
      evidEvent.ts >= before,
      `attempt_evidence ts (${evidEvent.ts}) must be >= Date.now() captured before the call (${before}); got ts=attempt=${evidEvent.ts} which is a logical counter, not wall-clock`,
    );
    assert.ok(
      evidEvent.ts <= after,
      `attempt_evidence ts (${evidEvent.ts}) must be <= Date.now() captured after the call (${after})`,
    );

    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// BLOCKER D1 regression (Epic 019.5 human review) — recordEvidence must write
// the timeline event UNCONDITIONALLY; on an uninitialised store it must THROW
// "no such table" exactly as appendTimelineEvent does.
// Currently FAILS: the sqlite_master guard silently skips the write (no throw).
// ---------------------------------------------------------------------------

test("BLOCKER D1: recordEvidence throws 'no such table' when task_timeline_event is not bootstrapped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-atev-d1-"));
  const dbPath = join(dir, "d1.db");
  try {
    // Open a store WITHOUT calling initSchema (or initTaskTimelineSchema).
    // ensureSchema inside recordEvidence creates attempt_evidence, but
    // task_timeline_event is absent. Once the sqlite_master guard is removed,
    // appendTimelineEvent will throw "no such table: task_timeline_event".
    const store = openStore(dbPath, { busyTimeout: 1000 });
    assert.throws(
      () =>
        recordEvidence(store, {
          taskId: "task-d1-noinit",
          attempt: 1,
          phase: "tdd",
          summary: "gate failed",
        }),
      /no such table/,
      "recordEvidence must throw when task_timeline_event is not bootstrapped — no silent-skip guard",
    );
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
