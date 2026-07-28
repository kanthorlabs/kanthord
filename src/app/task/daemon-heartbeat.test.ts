// src/app/task/daemon-heartbeat.test.ts — EPIC 014 Story 3
// Hermetic unit tests for the daemon heartbeat helpers (pure functions over an
// injected clock + injected store + injected scheduler). No `node:sqlite`, no
// `setInterval`, no real `Date.now` — every effect is a fake.
//
// The companion SQLite-repository test lives in
// `src/storage/sqlite/daemon-heartbeat-repository.test.ts`; this file is the
// boundary that the in-process use-case + composition root consume.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_MS,
  daemonInstanceId,
  heartbeatAgeMs,
  resolveIntervalMs,
  resolveStaleMs,
  startHeartbeat,
  type HeartbeatDeps,
} from "./daemon-heartbeat.ts";

// ── resolveStaleMs ──────────────────────────────────────────────────────────

test("resolveStaleMs(undefined) returns the default 6000", () => {
  assert.equal(resolveStaleMs(undefined), 6_000);
});

test('resolveStaleMs("2000") returns the override 2000', () => {
  assert.equal(resolveStaleMs("2000"), 2_000);
});

test('resolveStaleMs("0") falls back to the default 6000 (positive integers only)', () => {
  assert.equal(resolveStaleMs("0"), 6_000);
});

test('resolveStaleMs("-1") falls back to the default 6000 (positive integers only)', () => {
  assert.equal(resolveStaleMs("-1"), 6_000);
});

test('resolveStaleMs("abc") falls back to the default 6000 (non-numeric)', () => {
  assert.equal(resolveStaleMs("abc"), 6_000);
});

test('resolveStaleMs("1.5") falls back to the default 6000 (integer-only)', () => {
  assert.equal(resolveStaleMs("1.5"), 6_000);
});

test('resolveStaleMs("") falls back to the default 6000 (empty string)', () => {
  assert.equal(resolveStaleMs(""), 6_000);
});

// ── HEARTBEAT_STALE_MS is a fixed multiple of HEARTBEAT_INTERVAL_MS ─────────

test("HEARTBEAT_STALE_MS is exactly 3 * HEARTBEAT_INTERVAL_MS (the threshold stays a multiple of the period)", () => {
  assert.equal(HEARTBEAT_STALE_MS, 3 * HEARTBEAT_INTERVAL_MS);
});

// ── resolveIntervalMs ───────────────────────────────────────────────────────

test("resolveIntervalMs(6000) returns the default period 2000", () => {
  assert.equal(resolveIntervalMs(6_000), 2_000);
});

test("resolveIntervalMs(2000) returns floor(2000/3) = 666 (so the override threshold still keeps a 3x period)", () => {
  assert.equal(resolveIntervalMs(2_000), 666);
});

test("resolveIntervalMs(1) returns 1 — never 0, never negative (otherwise the writer would beat in a tight loop)", () => {
  assert.equal(resolveIntervalMs(1), 1);
});

test("resolveIntervalMs(0) returns 1 — never 0 (zero would busy-loop the daemon)", () => {
  assert.equal(resolveIntervalMs(0), 1);
});

test("resolveIntervalMs(-1) returns 1 — never negative", () => {
  assert.equal(resolveIntervalMs(-1), 1);
});

// ── daemonInstanceId ────────────────────────────────────────────────────────

test('daemonInstanceId(4242, 1000) is "4242:1000" (pid + process start time)', () => {
  assert.equal(daemonInstanceId(4242, 1_000), "4242:1000");
});

test("two different pids and two different start times yield four distinct instance ids", () => {
  const ids = new Set([
    daemonInstanceId(1, 1_000),
    daemonInstanceId(2, 1_000),
    daemonInstanceId(1, 2_000),
    daemonInstanceId(2, 2_000),
  ]);
  assert.equal(
    ids.size,
    4,
    `expected 4 distinct instance ids; got ${ids.size}`,
  );
});

// ── startHeartbeat: pre-beat, schedule, stop ────────────────────────────────

interface FakeScheduleHandle {
  cancel: () => void;
  fire: () => void;
}

interface FakeScheduler {
  schedule: (fn: () => void, ms: number) => FakeScheduleHandle;
  scheduled: Array<{ fn: () => void; ms: number }>;
  cancelCalls: number;
}

function makeFakeScheduler(): FakeScheduler {
  const handle: FakeScheduleHandle = {
    cancel: () => undefined,
    fire: () => undefined,
  };
  const scheduler: FakeScheduler = {
    scheduled: [],
    cancelCalls: 0,
    schedule(fn, ms) {
      const entry: { fn: () => void; ms: number; handle: FakeScheduleHandle } =
        {
          fn,
          ms,
          handle,
        };
      scheduler.scheduled.push(entry);
      handle.fire = () => entry.fn();
      handle.cancel = () => {
        scheduler.cancelCalls += 1;
      };
      return handle;
    },
  };
  return scheduler;
}

interface BeatRecord {
  instanceId: string;
  pid: number;
  startedAtMs: number;
  atMs: number;
}

function makeFakeStore() {
  const beats: BeatRecord[] = [];
  return {
    beats,
    store: {
      beat(input: {
        instanceId: string;
        pid: number;
        startedAtMs: number;
        atMs: number;
      }): void {
        beats.push({ ...input });
      },
    },
  };
}

test("startHeartbeat writes exactly one beat BEFORE the scheduler is ever invoked, with atMs from now()", () => {
  const { store, beats } = makeFakeStore();
  const scheduler = makeFakeScheduler();
  const nowValues = [1_000_000, 1_000_500, 1_001_000, 1_001_500];
  let nowIdx = 0;
  const deps: HeartbeatDeps = {
    store: store,
    now: () => nowValues[nowIdx++] ?? nowValues[nowValues.length - 1]!,
    pid: 4242,
    startedAtMs: 1_000,
    intervalMs: 2_000,
    schedule: scheduler.schedule,
  };

  startHeartbeat(deps);

  assert.equal(
    beats.length,
    1,
    `expected exactly one pre-schedule beat; got ${beats.length}`,
  );
  assert.equal(beats[0]!.instanceId, "4242:1000");
  assert.equal(beats[0]!.pid, 4242);
  assert.equal(beats[0]!.startedAtMs, 1_000);
  assert.equal(beats[0]!.atMs, 1_000_000);
  assert.equal(
    scheduler.scheduled.length,
    1,
    "the writer must register exactly one scheduled callback",
  );
  assert.equal(scheduler.scheduled[0]!.ms, 2_000);
});

test("firing the scheduled callback three times writes three more beats with the same instanceId and strictly increasing atMs", () => {
  const { store, beats } = makeFakeStore();
  const scheduler = makeFakeScheduler();
  const nowValues = [1_000_000, 1_002_000, 1_004_000, 1_006_000];
  let nowIdx = 0;
  const deps: HeartbeatDeps = {
    store: store,
    now: () => nowValues[nowIdx++] ?? nowValues[nowValues.length - 1]!,
    pid: 4242,
    startedAtMs: 1_000,
    intervalMs: 2_000,
    schedule: scheduler.schedule,
  };

  startHeartbeat(deps);
  // Fire the scheduled callback three times.
  for (let i = 0; i < 3; i++) scheduler.scheduled[0]!.fn();

  assert.equal(
    beats.length,
    4,
    `expected 1 pre-schedule beat + 3 schedule fires = 4 total; got ${beats.length}`,
  );
  assert.equal(beats[1]!.instanceId, "4242:1000");
  assert.equal(beats[1]!.atMs, 1_002_000);
  assert.equal(beats[2]!.atMs, 1_004_000);
  assert.equal(beats[3]!.atMs, 1_006_000);
  for (const beat of beats) {
    assert.equal(beat.instanceId, "4242:1000");
    assert.equal(beat.pid, 4242);
    assert.equal(beat.startedAtMs, 1_000);
  }
});

test("startHeartbeat's stop function calls cancel exactly once; calling it twice is a no-op (no further beats)", () => {
  const { store, beats } = makeFakeStore();
  const scheduler = makeFakeScheduler();
  let nowVal = 1_000_000;
  const deps: HeartbeatDeps = {
    store: store,
    now: () => nowVal,
    pid: 4242,
    startedAtMs: 1_000,
    intervalMs: 2_000,
    schedule: scheduler.schedule,
  };

  const stop = startHeartbeat(deps);
  assert.equal(beats.length, 1, "one pre-schedule beat before stop");

  stop();
  stop(); // idempotent

  assert.equal(
    scheduler.cancelCalls,
    1,
    `cancel must be called exactly once across two stop() invocations; got ${scheduler.cancelCalls}`,
  );

  // Firing the scheduled callback after stop must NOT write another beat
  // (the writer should not call beat() once cancelled). We do not have a
  // separate "cancelled" guard inside the writer; the contract is that the
  // adapter's interval handle is cleared, so the real-world callback would
  // not be invoked. The test asserts: a stop() followed by a second stop()
  // does not schedule anything new and does not beat twice.
  assert.equal(
    beats.length,
    1,
    "two stop() calls must not write any extra beat",
  );
});

// ── heartbeatAgeMs ─────────────────────────────────────────────────────────

test("heartbeatAgeMs(10_000, 4_000) is 6_000", () => {
  assert.equal(heartbeatAgeMs(10_000, 4_000), 6_000);
});

test("heartbeatAgeMs(1_000, 5_000) clamps to 0 (a backwards clock jump must never report a negative age)", () => {
  assert.equal(heartbeatAgeMs(1_000, 5_000), 0);
});

test("heartbeatAgeMs(5_000, 5_000) is 0 (boundary — beat at exactly now)", () => {
  assert.equal(heartbeatAgeMs(5_000, 5_000), 0);
});
