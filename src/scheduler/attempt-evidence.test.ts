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
