// src/apps/cli/daemon-heartbeat-bracket.test.ts — EPIC 014 Story 3/6
// Hermetic tests for the heartbeat start/stop bracket around the daemon loop.
// No database, no real timers: `buildDaemon` and `heartbeat` are both fakes.
//
// Contract pinned by the EPIC and Story 3 §7:
//   - `heartbeat.start()` runs BEFORE `daemon.execute()`, so the first
//     `check project` after daemon start already sees a row.
//   - The stop function returned by `start()` runs in the `finally` — on the
//     success path AND when `execute()` rejects.
//   - Beats keep arriving WHILE `execute()` is in flight. `RunDaemon`'s loop
//     awaits one task to completion, so a beat driven by task boundaries would
//     let a long agent run make a live daemon read `stopped`.
//   - `heartbeat` is optional: omitting it must not break `runDaemon`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runDaemon } from "./daemon.ts";
import { startHeartbeat } from "../../app/task/daemon-heartbeat.ts";
import type { RunDaemon as RunDaemonClass } from "../../app/task/run-daemon.ts";

/** A fake RunDaemon whose `execute()` body is supplied by the test. */
function makeFakeDaemon(
  onExecute: () => Promise<void>,
  events?: string[],
): RunDaemonClass {
  return {
    async execute(_opts: {
      untilIdle: boolean;
      pollIntervalMs?: number;
    }): Promise<{ exitCode: 0 | 1 }> {
      events?.push("execute");
      await onExecute();
      return { exitCode: 0 as const, escalatedCount: 0 } as unknown as {
        exitCode: 0 | 1;
      };
    },
    stop(): void {},
  } as unknown as RunDaemonClass;
}

test("runDaemon starts the heartbeat BEFORE daemon.execute() and stops it after", async () => {
  const events: string[] = [];
  const heartbeat = {
    start: () => {
      events.push("start");
      return () => events.push("stop");
    },
  };

  const result = await runDaemon(
    { "until-idle": true },
    () => makeFakeDaemon(async () => {}, events),
    undefined,
    heartbeat,
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, ["start", "execute", "stop"]);
});

test("runDaemon stops the heartbeat in the finally when daemon.execute() rejects", async () => {
  const events: string[] = [];
  const heartbeat = {
    start: () => {
      events.push("start");
      return () => events.push("stop");
    },
  };

  await assert.rejects(
    runDaemon(
      { "until-idle": true },
      () =>
        makeFakeDaemon(async () => {
          throw new Error("loop blew up");
        }, events),
      undefined,
      heartbeat,
    ),
    /loop blew up/,
  );

  assert.deepEqual(
    events,
    ["start", "execute", "stop"],
    "the stop function must run even on the throwing path",
  );
});

test("runDaemon stops the heartbeat when buildDaemon itself throws", async () => {
  const events: string[] = [];
  const heartbeat = {
    start: () => {
      events.push("start");
      return () => events.push("stop");
    },
  };

  await assert.rejects(
    runDaemon(
      { "until-idle": true },
      () => {
        throw new Error("cannot build daemon");
      },
      undefined,
      heartbeat,
    ),
    /cannot build daemon/,
  );

  // `buildDaemon` runs before `start()`, so nothing was started and nothing
  // can leak. The invariant is that we never end with a started-but-unstopped
  // heartbeat.
  assert.ok(
    !events.includes("start") || events.includes("stop"),
    `a started heartbeat must always be stopped; got: ${JSON.stringify(events)}`,
  );
});

test("beats keep arriving while daemon.execute() is in flight (interval is independent of task boundaries)", async () => {
  // One long task: `execute()` resolves only after the scheduler has fired
  // three times. A beat driven by task boundaries would record exactly one.
  const beats: Array<{ instanceId: string; atMs: number }> = [];
  let scheduled: (() => void) | undefined;
  let clock = 1_000;

  const heartbeat = {
    start: () =>
      startHeartbeat({
        store: {
          beat: (input) =>
            beats.push({ instanceId: input.instanceId, atMs: input.atMs }),
        },
        now: () => clock,
        pid: 4242,
        startedAtMs: 1_000,
        intervalMs: 2_000,
        schedule: (fn, _ms) => {
          scheduled = fn;
          return { cancel: () => (scheduled = undefined) };
        },
      }),
  };

  const result = await runDaemon(
    { "until-idle": true },
    () =>
      makeFakeDaemon(async () => {
        // The single long task: drive the interval three times mid-run.
        for (let i = 0; i < 3; i++) {
          clock += 2_000;
          scheduled?.();
        }
      }),
    undefined,
    heartbeat,
  );

  assert.equal(result.exitCode, 0);
  // 1 pre-schedule beat + 3 interval fires, all under one instance id.
  assert.equal(beats.length, 4, `beats: ${JSON.stringify(beats)}`);
  assert.deepEqual(
    beats.map((b) => b.atMs),
    [1_000, 3_000, 5_000, 7_000],
  );
  assert.deepEqual(
    new Set(beats.map((b) => b.instanceId)),
    new Set(["4242:1000"]),
  );
  // The stop function cancelled the schedule.
  assert.equal(scheduled, undefined, "the interval must be cancelled on exit");
});

test("runDaemon works when no heartbeat is supplied", async () => {
  const result = await runDaemon({ "until-idle": true }, () =>
    makeFakeDaemon(async () => {}),
  );

  assert.equal(result.exitCode, 0);
});
