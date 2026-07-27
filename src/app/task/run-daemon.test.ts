/**
 * Hermetic unit tests — RunDaemon use case (Story 07 Task T1).
 *
 * All tests use scripted fake collaborators — no I/O, no SQLite.
 * The six behaviors exercised:
 *   (a) until-idle: recover once, scan before every claim, drains then exits exitCode 0
 *   (b) one failed result → exitCode 1 (loop drains the rest)
 *   (c) live-insert pickup: scan happens before EVERY claim, not just once
 *   (d) skipped result does not trigger until-idle exit
 *   (e) polling mode: idle → sleep(pollIntervalMs); stop() → finish in-flight then exit
 *   (f) SQLITE_BUSY from scan → retry after sleep(100), loop continues, exit code unaffected
 * T2 additions:
 *   (g) completed result is logged via the logger port
 *   (h) failed result is logged via the logger port
 * Story 07 (run-scoped daemon accounting) additions:
 *   (i) landedInitiativeIds contains only the initiative(s) this run touched
 *   (j) a failed task appears in failedTasks with its persisted result reason
 *   (k) a task retried twice within one run yields a single initiative-id entry
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { RunDaemon } from "./run-daemon.ts";
import { NullLogger } from "../../logger/null.ts";

// ---------------------------------------------------------------------------
// Shared types — match the structural interfaces RunDaemon consumes
// ---------------------------------------------------------------------------

type RunNextResult =
  | { outcome: "idle" }
  | {
      outcome: "skipped" | "completed" | "failed";
      taskId: string;
      /** 008.4 Story D — provider failovers this dispatch performed. */
      failovers?: number;
    };

// ---------------------------------------------------------------------------
// Scripted fakes
// ---------------------------------------------------------------------------

function makeRecoverUC(log: string[]) {
  return {
    execute(): string[] {
      log.push("recover");
      return [];
    },
  };
}

/** Returns scripted results in sequence; falls back to [] once the list is empty. */
function makeEnqueueUC(log: string[], results: Array<string[] | Error>) {
  return {
    async execute(): Promise<string[]> {
      const next = results.shift();
      if (next instanceof Error) throw next;
      const val = next ?? [];
      log.push("enqueue");
      return val;
    },
  };
}

/** Returns scripted results in sequence; falls back to idle once the list is empty. */
function makeRunNextUC(log: string[], results: Array<RunNextResult | Error>) {
  return {
    async execute(): Promise<RunNextResult> {
      const next = results.shift();
      if (next instanceof Error) throw next;
      const val: RunNextResult = next ?? { outcome: "idle" };
      log.push("runNext");
      return val;
    },
  };
}

function makeSleep(log?: Array<number>) {
  return async (ms: number): Promise<void> => {
    log?.push(ms);
  };
}

// ---------------------------------------------------------------------------
// Test (a): until-idle drains 3 results then idle → exitCode 0, recover once,
//           call order = recover, [enqueue → runNext] × 4 (last runNext is idle)
// ---------------------------------------------------------------------------

test("RunDaemon execute until-idle: recover once, scan before every claim, drains then exits exitCode 0", async () => {
  const log: string[] = [];
  const sleepLog: number[] = [];

  const recover = makeRecoverUC(log);
  const enqueueUC = makeEnqueueUC(log, [["t1"], ["t2"], ["t3"], []]);
  const runNextUC = makeRunNextUC(log, [
    { outcome: "completed", taskId: "t1" },
    { outcome: "completed", taskId: "t2" },
    { outcome: "completed", taskId: "t3" },
    { outcome: "idle" },
  ]);

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep(sleepLog),
    logger: new NullLogger(),
  });

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.equal(result.exitCode, 0, "exitCode must be 0 when no tasks failed");

  // recover called exactly once at startup
  assert.equal(log[0], "recover", "recover must be called first");
  const withoutRecover = log.slice(1);

  // Remaining log must be alternating enqueue/runNext pairs
  for (let i = 0; i < withoutRecover.length; i++) {
    const expected = i % 2 === 0 ? "enqueue" : "runNext";
    assert.equal(
      withoutRecover[i],
      expected,
      `log[${i + 1}] must be '${expected}'`,
    );
  }

  // 4 enqueue + 4 runNext calls (3 non-idle + 1 idle)
  assert.equal(
    withoutRecover.filter((e) => e === "enqueue").length,
    4,
    "enqueueReady called once per iteration",
  );
  assert.equal(
    withoutRecover.filter((e) => e === "runNext").length,
    4,
    "runNext called once per iteration",
  );

  // No sleep in until-idle mode for non-idle results
  assert.equal(sleepLog.length, 0, "no sleep calls in until-idle mode");
});

// ---------------------------------------------------------------------------
// Test (b): one failed result → exitCode 1 (loop still drains the rest)
// ---------------------------------------------------------------------------

test("RunDaemon execute one failed result → exitCode 1 and loop continues draining", async () => {
  const log: string[] = [];

  const recover = makeRecoverUC(log);
  const enqueueUC = makeEnqueueUC(log, [["t1"], ["t2"], []]);
  const runNextUC = makeRunNextUC(log, [
    { outcome: "failed", taskId: "t1" }, // failure
    { outcome: "completed", taskId: "t2" }, // daemon continues
    { outcome: "idle" },
  ]);

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep(),
    logger: new NullLogger(),
  });

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.equal(
    result.exitCode,
    1,
    "exitCode must be 1 when at least one task failed",
  );

  // All three runNext calls were made (daemon moved on after the failure)
  assert.equal(
    log.filter((e) => e === "runNext").length,
    3,
    "daemon must drain all results even after a failure",
  );
});

// ---------------------------------------------------------------------------
// Test (c): live-insert pickup — scan happens before every claim
// ---------------------------------------------------------------------------

test("RunDaemon execute live-insert pickup: scan happens before every claim", async () => {
  const log: string[] = [];

  const recover = makeRecoverUC(log);
  // iter1: original task; iter2: new task inserted mid-run; iter3: empty → idle
  const enqueueUC = makeEnqueueUC(log, [["taskA"], ["taskNew"], []]);
  const runNextUC = makeRunNextUC(log, [
    { outcome: "completed", taskId: "taskA" },
    { outcome: "completed", taskId: "taskNew" },
    { outcome: "idle" },
  ]);

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep(),
    logger: new NullLogger(),
  });

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.equal(result.exitCode, 0);

  // enqueue and runNext alternate strictly — scan is before every claim
  const withoutRecover = log.slice(1);
  for (let i = 0; i < withoutRecover.length; i++) {
    const expected = i % 2 === 0 ? "enqueue" : "runNext";
    assert.equal(
      withoutRecover[i],
      expected,
      `scan must precede every claim: log entry ${i + 1} must be '${expected}'`,
    );
  }

  // taskNew was picked up in its own iteration (3 runNext calls, not 2)
  assert.equal(
    log.filter((e) => e === "runNext").length,
    3,
    "taskNew must be executed in its own iteration (3 runNext calls)",
  );
});

// ---------------------------------------------------------------------------
// Test (d): skipped result does NOT trigger until-idle exit
// ---------------------------------------------------------------------------

test("RunDaemon execute skipped result does not trigger until-idle exit", async () => {
  const log: string[] = [];

  const recover = makeRecoverUC(log);
  const enqueueUC = makeEnqueueUC(log, [["t1"], []]);
  const runNextUC = makeRunNextUC(log, [
    { outcome: "skipped", taskId: "t1" }, // stale job — not idle
    { outcome: "idle" }, // idle with empty scan → exit
  ]);

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep(),
    logger: new NullLogger(),
  });

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.equal(result.exitCode, 0);
  assert.equal(
    log.filter((e) => e === "runNext").length,
    2,
    "daemon must iterate again after a skipped result, not exit immediately",
  );
});

// ---------------------------------------------------------------------------
// Test (e-1): polling mode — idle triggers sleep(pollIntervalMs)
// ---------------------------------------------------------------------------

test("RunDaemon execute polling mode: idle triggers sleep(pollIntervalMs) then continues", async () => {
  const POLL_MS = 42;
  const sleepLog: number[] = [];

  let stopSignal: () => void = () => {};

  const recover = { execute: () => [] as string[] };
  const enqueueUC = { execute: async () => [] as string[] };
  const runNextUC = {
    execute: async (): Promise<RunNextResult> => ({ outcome: "idle" }),
  };

  const sleep = async (ms: number): Promise<void> => {
    sleepLog.push(ms);
    stopSignal(); // stop after first sleep so the test exits
  };

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep,
    logger: new NullLogger(),
  });
  stopSignal = () => daemon.stop();

  const result = await daemon.execute({
    untilIdle: false,
    pollIntervalMs: POLL_MS,
  });

  assert.ok(
    sleepLog.length >= 1,
    "sleep must be called at least once in polling mode",
  );
  assert.equal(
    sleepLog[0],
    POLL_MS,
    "sleep must be called with pollIntervalMs",
  );
  assert.equal(result.exitCode, 0, "exitCode 0 when no failures");
});

// ---------------------------------------------------------------------------
// Test (e-2): stop() lets in-flight runNext finish then exits
// ---------------------------------------------------------------------------

test("RunDaemon execute stop() lets in-flight runNext finish then exits", async () => {
  let resolveRunNext!: (r: RunNextResult) => void;
  const inFlightP = new Promise<RunNextResult>((resolve) => {
    resolveRunNext = resolve;
  });

  let runNextCallCount = 0;
  const recover = { execute: () => [] as string[] };
  const enqueueUC = { execute: async () => ["t1"] as string[] };
  const runNextUC = {
    execute(): Promise<RunNextResult> {
      runNextCallCount++;
      if (runNextCallCount === 1) return inFlightP;
      return Promise.resolve({ outcome: "idle" as const });
    },
  };

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep(),
    logger: new NullLogger(),
  });

  const doneP = daemon.execute({ untilIdle: false, pollIntervalMs: 10 });

  // Allow the event loop to advance until the daemon awaits the first runNext.
  await Promise.resolve();
  await Promise.resolve();

  // Signal stop while runNext is still in-flight.
  daemon.stop();

  // Resolve the in-flight runNext — daemon must finish this iteration then exit.
  resolveRunNext({ outcome: "completed", taskId: "t1" });

  const result = await doneP;

  assert.equal(
    result.exitCode,
    0,
    "exitCode 0 — the completed task did not fail",
  );
  assert.equal(
    runNextCallCount,
    1,
    "runNext called exactly once — daemon stopped after first completion",
  );
});

// ---------------------------------------------------------------------------
// Test (f): SQLITE_BUSY from scan → retry after sleep(100), loop continues
// ---------------------------------------------------------------------------

test("RunDaemon execute SQLITE_BUSY from scan retries after sleep(100) and loop continues", async () => {
  const sleepLog: number[] = [];
  const log: string[] = [];

  // The first enqueue call throws SQLITE_BUSY; the second returns normally.
  const busyErr = Object.assign(new Error("database is locked"), {
    code: "ERR_SQLITE_BUSY",
  });

  const recover = makeRecoverUC(log);
  const enqueueUC = makeEnqueueUC(log, [busyErr, ["t1"], []]);
  const runNextUC = makeRunNextUC(log, [
    { outcome: "completed", taskId: "t1" },
    { outcome: "idle" },
  ]);

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep(sleepLog),
    logger: new NullLogger(),
  });

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  // Loop continued to completion despite the SQLITE_BUSY.
  assert.equal(
    result.exitCode,
    0,
    "SQLITE_BUSY must not cause a task failure or crash",
  );

  // sleep(100) was called once for the SQLITE_BUSY retry.
  assert.ok(
    sleepLog.includes(100),
    "sleep(100) must be called on SQLITE_BUSY retry",
  );

  // The task was eventually completed (run-next was called after the retry).
  assert.equal(
    log.filter((e) => e === "runNext").length,
    2,
    "runNext must be called twice (after retry, then idle)",
  );
});

// ---------------------------------------------------------------------------
// S3 regression: stop() called BEFORE execute() must be honored immediately
// ---------------------------------------------------------------------------

test("RunDaemon stop() before execute() is honored: loop exits immediately with no task claimed", async () => {
  const log: string[] = [];

  const recover = makeRecoverUC(log);
  const enqueueUC = makeEnqueueUC(log, [["t1"], []]);
  const runNextUC = makeRunNextUC(log, [
    { outcome: "completed", taskId: "t1" },
    { outcome: "idle" },
  ]);

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep(),
    logger: new NullLogger(),
  });

  daemon.stop(); // set BEFORE execute() starts
  const result = await daemon.execute({ untilIdle: true });

  assert.equal(
    log.filter((e) => e === "enqueue").length,
    0,
    "enqueueReady must never be called when stop() was set before execute()",
  );
  assert.equal(
    log.filter((e) => e === "runNext").length,
    0,
    "runNext must never be called when stop() was set before execute()",
  );
  assert.equal(
    result.exitCode,
    0,
    "exitCode must be 0 when no failures occurred",
  );
});

// ---------------------------------------------------------------------------
// T2 (g): completed result is logged via the logger port
// ---------------------------------------------------------------------------

test("RunDaemon execute: completed result is logged via the logger port", async () => {
  const log: string[] = [];
  const captureLogger = {
    lines: [] as string[],
    info(m: string) {
      this.lines.push(m);
    },
    warn(_m: string) {},
    error(_m: string) {},
  };

  const daemon = new RunDaemon({
    recover: makeRecoverUC(log),
    enqueueReady: makeEnqueueUC(log, [["T1"]]),
    runNext: makeRunNextUC(log, [{ outcome: "completed", taskId: "T1" }]),
    sleep: makeSleep(),
    logger: captureLogger,
  });

  await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.ok(
    captureLogger.lines.some((l) => /task T1.*completed/.test(l)),
    `logger must capture a 'task T1: completed' line; got: ${JSON.stringify(captureLogger.lines)}`,
  );
});

// ---------------------------------------------------------------------------
// T2 (h): failed result is logged via the logger port
// ---------------------------------------------------------------------------

test("RunDaemon execute: failed result is logged via the logger port", async () => {
  const log: string[] = [];
  const captureLogger = {
    lines: [] as string[],
    info(m: string) {
      this.lines.push(m);
    },
    warn(_m: string) {},
    error(_m: string) {},
  };

  const daemon = new RunDaemon({
    recover: makeRecoverUC(log),
    enqueueReady: makeEnqueueUC(log, [["T1"]]),
    runNext: makeRunNextUC(log, [{ outcome: "failed", taskId: "T1" }]),
    sleep: makeSleep(),
    logger: captureLogger,
  });

  await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.ok(
    captureLogger.lines.some((l) => /task T1.*failed/.test(l)),
    `logger must capture a 'task T1: failed' line; got: ${JSON.stringify(captureLogger.lines)}`,
  );
});

// ---------------------------------------------------------------------------
// Story 07 — run-scoped daemon accounting
//
// A `store` dependency lets RunDaemon learn, per dispatched task, which
// initiative it belongs to (`getInitiativeId`) and its persisted result
// (`getTaskResult`, for the failure `reason`). `initiatives` (already used
// for the objectives-awaiting count) supplies each touched initiative's
// current `status` — no `listAllInitiatives()` scan is used any more.
// ---------------------------------------------------------------------------

function makeTaskStore(initiativeByTask: Record<string, string>) {
  return {
    getInitiativeId(taskId: string): string | undefined {
      return initiativeByTask[taskId];
    },
    getTaskResult(taskId: string): { reason: string | null } | undefined {
      const reasons: Record<string, string> = {
        t1: "VerificationFailedError: npm test (exit 1)",
      };
      return taskId in reasons
        ? { reason: reasons[taskId]! }
        : { reason: null };
    },
  };
}

function makeInitiativesByStatus(statusById: Record<string, string>) {
  return {
    listAllInitiatives(): Array<{ id: string }> {
      return Object.keys(statusById).map((id) => ({ id }));
    },
    get(id: string): { status?: string } | undefined {
      return statusById[id] !== undefined
        ? { status: statusById[id] }
        : undefined;
    },
    listObjectives(_initiativeId: string): Array<{ status?: string }> {
      return [];
    },
  };
}

// (i) landedInitiativeIds contains only the touched initiative, not a
//     pre-existing unrelated `landed` initiative the run never dispatched.
test("RunDaemon execute: landedInitiativeIds contains only the initiative(s) this run touched (Story 07 i)", async () => {
  const log: string[] = [];

  const daemon = new RunDaemon({
    recover: makeRecoverUC(log),
    enqueueReady: makeEnqueueUC(log, [["t1"], []]),
    runNext: makeRunNextUC(log, [{ outcome: "completed", taskId: "t1" }]),
    sleep: makeSleep(),
    logger: new NullLogger(),
    store: makeTaskStore({ t1: "init-A" }),
    initiatives: makeInitiativesByStatus({
      "init-A": "landed",
      "init-B": "landed", // untouched by this run — must NOT be counted
    }),
  } as ConstructorParameters<typeof RunDaemon>[0]);

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  const landed = (result as { landedInitiativeIds?: string[] })
    .landedInitiativeIds;
  assert.deepEqual(
    landed,
    ["init-A"],
    `landedInitiativeIds must contain only the touched initiative; got: ${JSON.stringify(landed)}`,
  );
});

// (j) a failed task appears in failedTasks with the reason from its
//     persisted task_results row.
test("RunDaemon execute: a failed task appears in failedTasks with its persisted result reason (Story 07 j)", async () => {
  const log: string[] = [];

  const daemon = new RunDaemon({
    recover: makeRecoverUC(log),
    enqueueReady: makeEnqueueUC(log, [["t1"], []]),
    runNext: makeRunNextUC(log, [{ outcome: "failed", taskId: "t1" }]),
    sleep: makeSleep(),
    logger: new NullLogger(),
    store: makeTaskStore({ t1: "init-A" }),
    initiatives: makeInitiativesByStatus({ "init-A": "building" }),
  } as ConstructorParameters<typeof RunDaemon>[0]);

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  const failedTasks = (
    result as {
      failedTasks?: Array<{ id: string; reason: string }>;
    }
  ).failedTasks;
  assert.deepEqual(
    failedTasks,
    [{ id: "t1", reason: "VerificationFailedError: npm test (exit 1)" }],
    `failedTasks must contain the failed task with its persisted reason; got: ${JSON.stringify(failedTasks)}`,
  );
});

// (k) a task retried twice within one run yields a single initiative-id
//     entry in landedInitiativeIds (Set semantics, not a per-dispatch count).
test("RunDaemon execute: a task retried twice within one run yields a single initiative-id entry (Story 07 k)", async () => {
  const log: string[] = [];

  const daemon = new RunDaemon({
    recover: makeRecoverUC(log),
    enqueueReady: makeEnqueueUC(log, [["t1"], ["t1"], []]),
    runNext: makeRunNextUC(log, [
      { outcome: "failed", taskId: "t1" }, // first attempt fails
      { outcome: "completed", taskId: "t1" }, // retried and completes
    ]),
    sleep: makeSleep(),
    logger: new NullLogger(),
    store: makeTaskStore({ t1: "init-A" }),
    initiatives: makeInitiativesByStatus({ "init-A": "landed" }),
  } as ConstructorParameters<typeof RunDaemon>[0]);

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  const landed = (result as { landedInitiativeIds?: string[] })
    .landedInitiativeIds;
  assert.deepEqual(
    landed,
    ["init-A"],
    `landedInitiativeIds must list init-A exactly once, not once per dispatch; got: ${JSON.stringify(landed)}`,
  );
});

// ---------------------------------------------------------------------------
// 008.4 Story D — the run summary reports provider failovers: RunDaemon sums
// each dispatch's `failovers` across the run.
// ---------------------------------------------------------------------------

test("(008.4 Story D) RunDaemon sums per-dispatch failovers into failoverCount", async () => {
  const log: string[] = [];
  const recover = makeRecoverUC(log);
  const enqueueUC = makeEnqueueUC(log, [["t1"], ["t2"], ["t3"], []]);
  const runNextUC = makeRunNextUC(log, [
    { outcome: "completed", taskId: "t1", failovers: 1 },
    { outcome: "failed", taskId: "t2", failovers: 2 },
    { outcome: "completed", taskId: "t3" },
    { outcome: "idle" },
  ]);

  const daemon = new RunDaemon({
    recover,
    enqueueReady: enqueueUC,
    runNext: runNextUC,
    sleep: makeSleep([]),
    logger: new NullLogger(),
  });

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.equal(
    result.failoverCount,
    3,
    "failoverCount must sum every dispatch's failovers (1 + 2 + 0)",
  );
});

test("(008.4 Story D) RunDaemon reports failoverCount 0 when no dispatch failed over", async () => {
  const log: string[] = [];
  const daemon = new RunDaemon({
    recover: makeRecoverUC(log),
    enqueueReady: makeEnqueueUC(log, [["t1"], []]),
    runNext: makeRunNextUC(log, [
      { outcome: "completed", taskId: "t1" },
      { outcome: "idle" },
    ]),
    sleep: makeSleep([]),
    logger: new NullLogger(),
  });

  const result = await daemon.execute({ untilIdle: true, pollIntervalMs: 100 });

  assert.equal(result.failoverCount, 0, "no failovers ⇒ failoverCount 0");
});
