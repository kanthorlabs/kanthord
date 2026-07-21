/**
 * End-to-end smoke tests — EPIC 005 Proof sequence (Story 10, Task T1).
 *
 * Three phases through the composition root against temp DBs:
 *   Phase 1: EPIC 004 setup → daemon run → all tasks completed → lifecycle events correct.
 *   Phase 2: Insert one more task → daemon runs only the new task.
 *   Phase 3 (fresh DB): same setup → --fail deploy → deploy failed, event has reason.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { runCli as dispatch } from "./commands/run-cli.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// ---------------------------------------------------------------------------
// Helper — runs the full EPIC 004 Proof setup on deps and returns key ids.
// Graph: spike-auth (no deps) → implement-api → deploy
// ---------------------------------------------------------------------------

async function runEpic004Setup(deps: ReturnType<typeof buildDeps>): Promise<{
  INITIATIVE: string;
  OBJECTIVE: string;
  TASK_API: string;
  TASK_DEPLOY: string;
  TASK_PREP: string;
}> {
  const m = await dispatch(["db", "migrate"], deps);
  assert.equal(m.exitCode, 0, "db migrate exits 0");

  const r1 = await dispatch(["create", "project", "--name", "demo"], deps);
  assert.equal(r1.exitCode, 0);
  const PROJECT = r1.stdout[0]!;
  assert.match(PROJECT, ULID_RE);

  await dispatch(
    [
      "create",
      "repository",
      "--project",
      PROJECT,
      "--name",
      "backend",
      "--organization",
      "acme",
      "--branch",
      "main",
    ],
    deps,
  );

  const r3 = await dispatch(
    ["create", "initiative", "--project", PROJECT, "--name", "oauth"],
    deps,
  );
  assert.equal(r3.exitCode, 0);
  const INITIATIVE = r3.stdout[0]!;
  assert.match(INITIATIVE, ULID_RE);

  const r4 = await dispatch(
    ["create", "objective", "--initiative", INITIATIVE, "--name", "backend"],
    deps,
  );
  assert.equal(r4.exitCode, 0);
  const OBJECTIVE = r4.stdout[0]!;
  assert.match(OBJECTIVE, ULID_RE);

  // implement api (no deps initially)
  const r5 = await dispatch(
    [
      "create",
      "task",
      "--objective",
      OBJECTIVE,
      "--title",
      "implement api",
      "--instructions",
      "Implement the API",
      "--ac",
      "API implemented",
      "--agent",
      "fake@1",
    ],
    deps,
  );
  assert.equal(r5.exitCode, 0);
  const TASK_API = r5.stdout[0]!;
  assert.match(TASK_API, ULID_RE);

  // deploy (depends on implement api)
  const r6 = await dispatch(
    [
      "create",
      "task",
      "--objective",
      OBJECTIVE,
      "--title",
      "deploy",
      "--dependencies",
      TASK_API,
      "--instructions",
      "Deploy the service",
      "--ac",
      "Service deployed",
      "--agent",
      "fake@1",
    ],
    deps,
  );
  assert.equal(r6.exitCode, 0);
  const TASK_DEPLOY = r6.stdout[0]!;
  assert.match(TASK_DEPLOY, ULID_RE);

  // spike auth (no deps)
  const r7 = await dispatch(
    [
      "create",
      "task",
      "--objective",
      OBJECTIVE,
      "--title",
      "spike auth",
      "--instructions",
      "Spike the auth approach",
      "--ac",
      "Auth spiked",
      "--agent",
      "fake@1",
    ],
    deps,
  );
  assert.equal(r7.exitCode, 0);
  const TASK_PREP = r7.stdout[0]!;
  assert.match(TASK_PREP, ULID_RE);

  // implement api now depends on spike auth
  const r8 = await dispatch(
    ["add", "dependency", "--task", TASK_API, "--dependency", TASK_PREP],
    deps,
  );
  assert.equal(r8.exitCode, 0, "add dependency exits 0");

  return { INITIATIVE, OBJECTIVE, TASK_API, TASK_DEPLOY, TASK_PREP };
}

// ---------------------------------------------------------------------------
// Phase 1 + 2
// ---------------------------------------------------------------------------

test("daemon smoke — phase 1: daemon drains all tasks; phase 2: new task picked up only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-smoke-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    const { INITIATIVE, OBJECTIVE, TASK_API, TASK_DEPLOY, TASK_PREP } =
      await runEpic004Setup(deps);

    // ── Phase 1: daemon run until-idle ──────────────────────────────────────
    const d1 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d1.exitCode, 0, "phase 1: daemon exits 0");

    // All three tasks completed.
    const list1 = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    assert.equal(list1.exitCode, 0, "list task exits 0");
    const listing1 = list1.stdout.join("\n");
    assert.ok(
      listing1.includes("spike auth") && listing1.includes("completed"),
      "spike auth shows completed",
    );
    assert.ok(
      listing1.includes("implement api") && listing1.includes("completed"),
      "implement api shows completed",
    );
    assert.ok(
      listing1.includes("deploy") && listing1.includes("completed"),
      "deploy shows completed",
    );

    // Events: lifecycle stream (human output on stderr).
    const ev1 = await dispatch(["list", "event", "--after", "0"], deps);
    assert.equal(ev1.exitCode, 0, "events exits 0");
    const evLines = ev1.stderr;
    assert.ok(evLines.length > 0, "events returns at least one line");

    // Each line begins with a ULID.
    for (const line of evLines) {
      assert.match(
        line,
        /^[0-9A-HJKMNP-TV-Z]{26} /,
        `event line starts with a ULID: "${line}"`,
      );
    }

    // Lines must be in ascending ULID order.
    const lineIds = evLines.map((l) => l.split(" ")[0]!);
    const sorted = [...lineIds].sort();
    assert.deepEqual(
      lineIds,
      sorted,
      "event lines are in ascending ULID order",
    );

    // Dependency order: implement-api task.completed before deploy task.started.
    const apiCompletedIdx = evLines.findIndex(
      (l) => l.includes("task.completed") && l.includes(TASK_API),
    );
    const deployStartedIdx = evLines.findIndex(
      (l) => l.includes("task.started") && l.includes(TASK_DEPLOY),
    );
    assert.ok(
      apiCompletedIdx >= 0,
      "implement-api task.completed event exists",
    );
    assert.ok(deployStartedIdx >= 0, "deploy task.started event exists");
    assert.ok(
      apiCompletedIdx < deployStartedIdx,
      `implement-api completes (idx ${apiCompletedIdx}) before deploy starts (idx ${deployStartedIdx})`,
    );

    // Each task has exactly one task.started event.
    for (const [title, taskId] of [
      ["spike auth", TASK_PREP],
      ["implement api", TASK_API],
      ["deploy", TASK_DEPLOY],
    ] as Array<[string, string]>) {
      const startedCount = evLines.filter(
        (l) => l.includes("task.started") && l.includes(taskId),
      ).length;
      assert.equal(
        startedCount,
        1,
        `${title} has exactly one task.started event`,
      );
    }

    // ── Phase 2: insert one more task → daemon picks it up only ─────────────
    const eventCountBefore = evLines.length;

    const newTaskR = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "add tests",
        "--instructions",
        "Add tests for the feature",
        "--ac",
        "Tests added",
        "--agent",
        "fake@1",
      ],
      deps,
    );
    assert.equal(newTaskR.exitCode, 0, "create new task exits 0");
    const TASK_MORE = newTaskR.stdout[0]!;
    assert.match(TASK_MORE, ULID_RE);

    const d2 = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(d2.exitCode, 0, "phase 2: daemon exits 0");

    // Only the new task ran: event count grew by exactly 3 (ready + started + completed).
    const ev2 = await dispatch(["list", "event", "--after", "0"], deps);
    assert.equal(ev2.exitCode, 0);
    const evLines2 = ev2.stderr;
    assert.equal(
      evLines2.length,
      eventCountBefore + 3,
      `event count grew by exactly 3 (was ${eventCountBefore}, now ${evLines2.length})`,
    );

    // The three new events are for the new task.
    const newTaskEvents = evLines2.filter((l) => l.includes(TASK_MORE));
    assert.equal(newTaskEvents.length, 3, "new task has exactly 3 events");

    // New task is completed.
    const list2 = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    const listing2 = list2.stdout.join("\n");
    assert.ok(
      listing2.includes("add tests") && listing2.includes("completed"),
      "new task shows completed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Phase 3 (fresh DB): deploy fails; dependents stay pending; task.failed event.
// ---------------------------------------------------------------------------

test("daemon smoke — phase 3 (fresh DB): --fail deploy exits non-zero; task.failed event has reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-smoke-fail-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    const { INITIATIVE, TASK_DEPLOY } = await runEpic004Setup(deps);

    // daemon run with --fail $TASK_DEPLOY
    const d = await dispatch(
      ["run", "daemon", "--fail", TASK_DEPLOY, "--until-idle"],
      deps,
    );
    assert.notEqual(
      d.exitCode,
      0,
      "phase 3: daemon exits non-zero when a task fails",
    );

    // deploy is failed; other tasks are completed (they have no dependency on deploy's outcome).
    const list = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    assert.equal(list.exitCode, 0);
    const listing = list.stdout.join("\n");
    assert.ok(
      listing.includes("deploy") && listing.includes("failed"),
      "deploy shows failed",
    );

    // The task.failed event for deploy must exist and carry a reason.
    const ev = await dispatch(["list", "event", "--after", "0"], deps);
    assert.equal(ev.exitCode, 0);
    const failedLine = ev.stderr.find(
      (l) => l.includes("task.failed") && l.includes(TASK_DEPLOY),
    );
    assert.ok(
      failedLine !== undefined,
      "task.failed event for deploy exists in the event stream",
    );
    // The failure event includes the payload JSON (reason) on the same line.
    assert.ok(
      failedLine.includes("{") && failedLine.includes("reason"),
      `task.failed line includes reason payload: "${failedLine}"`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
