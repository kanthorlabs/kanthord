/**
 * Story 07 T1 — daemon summary line for escalated tasks (test c)
 *
 * Tests that `runDaemon` prints "N task(s) awaiting confirmation" to stderr
 * when `RunDaemon.execute()` reports escalated tasks, and prints nothing when
 * escalatedCount is 0.
 *
 * Fails today: `runDaemon` only reads `exitCode` from `daemon.execute()` and
 * always returns `stderr: []` — the summary line is never printed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runDaemon } from "./daemon.ts";
import type { RunDaemon as RunDaemonClass } from "../../app/task/run-daemon.ts";

// Build a fake RunDaemon whose execute() returns the given escalatedCount.
// After Story 07 T1, RunDaemon.execute() will return { exitCode, escalatedCount }.
// The extra field is invisible to TypeScript today but will be added to the
// return type by the SE; we cast to satisfy the current structural check.
function makeFakeDaemon(escalatedCount: number): RunDaemonClass {
  return {
    execute(_opts: {
      untilIdle: boolean;
      pollIntervalMs?: number;
    }): Promise<{ exitCode: 0 | 1 }> {
      return Promise.resolve({
        exitCode: 0 as const,
        escalatedCount,
      } as unknown as { exitCode: 0 | 1 });
    },
    stop(): void {},
  } as unknown as RunDaemonClass;
}

// (c-1) one escalated task → summary line on stderr
test("(c) runDaemon prints '1 task(s) awaiting confirmation' when escalatedCount is 1", async () => {
  const result = await runDaemon({ "until-idle": true }, () =>
    makeFakeDaemon(1),
  );

  assert.equal(
    result.exitCode,
    0,
    "exit code must be 0 for idle-success with escalation",
  );
  assert.ok(
    result.stderr.some((l) => l === "1 task(s) awaiting confirmation"),
    `stderr must include '1 task(s) awaiting confirmation'; got: ${JSON.stringify(result.stderr)}`,
  );
});

// (c-2) two escalated tasks → plural summary line
test("(c) runDaemon prints '2 task(s) awaiting confirmation' when escalatedCount is 2", async () => {
  const result = await runDaemon({ "until-idle": true }, () =>
    makeFakeDaemon(2),
  );

  assert.equal(result.exitCode, 0, "exit code must be 0");
  assert.ok(
    result.stderr.some((l) => l === "2 task(s) awaiting confirmation"),
    `stderr must include '2 task(s) awaiting confirmation'; got: ${JSON.stringify(result.stderr)}`,
  );
});

// (c-3) no escalated tasks → no summary line
test("(c) runDaemon prints no summary line when escalatedCount is 0", async () => {
  const result = await runDaemon({ "until-idle": true }, () =>
    makeFakeDaemon(0),
  );

  assert.equal(result.exitCode, 0, "exit code must be 0");
  assert.ok(
    !result.stderr.some((l) => l.includes("awaiting confirmation")),
    `stderr must not include awaiting-confirmation summary when none; got: ${JSON.stringify(result.stderr)}`,
  );
});

/**
 * Story F (007.12) — daemon summary lines for objectives awaiting brokering
 * (`objectivesAwaitingConfirmation`) and initiatives awaiting PR
 * (`initiativesAwaitingPr`).
 *
 * Fails today: `runDaemon` only reads `escalatedCount` off `daemon.execute()`'s
 * result — the two new counts are silently dropped, so no summary line is
 * ever printed for them.
 */
function makeFakeDaemonWithBrokerCounts(counts: {
  objectivesAwaitingConfirmation: number;
  initiativesAwaitingPr: number;
}): RunDaemonClass {
  return {
    execute(_opts: {
      untilIdle: boolean;
      pollIntervalMs?: number;
    }): Promise<{ exitCode: 0 | 1 }> {
      return Promise.resolve({
        exitCode: 0 as const,
        escalatedCount: 0,
        ...counts,
      } as unknown as { exitCode: 0 | 1 });
    },
    stop(): void {},
  } as unknown as RunDaemonClass;
}

test("(007.12 Story F) runDaemon prints '1 objective(s) awaiting confirmation' when objectivesAwaitingConfirmation is 1", async () => {
  const result = await runDaemon({ "until-idle": true }, () =>
    makeFakeDaemonWithBrokerCounts({
      objectivesAwaitingConfirmation: 1,
      initiativesAwaitingPr: 0,
    }),
  );

  assert.equal(result.exitCode, 0, "exit code must be 0");
  assert.ok(
    result.stderr.some((l) => l === "1 objective(s) awaiting confirmation"),
    `stderr must include '1 objective(s) awaiting confirmation'; got: ${JSON.stringify(result.stderr)}`,
  );
});

test("(007.12 Story F) runDaemon prints '2 initiative(s) awaiting PR' when initiativesAwaitingPr is 2", async () => {
  const result = await runDaemon({ "until-idle": true }, () =>
    makeFakeDaemonWithBrokerCounts({
      objectivesAwaitingConfirmation: 0,
      initiativesAwaitingPr: 2,
    }),
  );

  assert.equal(result.exitCode, 0, "exit code must be 0");
  assert.ok(
    result.stderr.some((l) => l === "2 initiative(s) awaiting PR"),
    `stderr must include '2 initiative(s) awaiting PR'; got: ${JSON.stringify(result.stderr)}`,
  );
});

test("(007.12 Story F) runDaemon prints no objective/initiative summary lines when both counts are 0", async () => {
  const result = await runDaemon({ "until-idle": true }, () =>
    makeFakeDaemonWithBrokerCounts({
      objectivesAwaitingConfirmation: 0,
      initiativesAwaitingPr: 0,
    }),
  );

  assert.equal(result.exitCode, 0, "exit code must be 0");
  assert.ok(
    !result.stderr.some(
      (l) =>
        l.includes("objective(s) awaiting confirmation") ||
        l.includes("initiative(s) awaiting PR"),
    ),
    `stderr must not include objective/initiative summary lines when both are 0; got: ${JSON.stringify(result.stderr)}`,
  );
});
