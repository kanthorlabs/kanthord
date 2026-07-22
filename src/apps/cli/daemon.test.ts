import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { runCli as dispatch } from "./commands/run-cli.ts";
import { runDaemon } from "./daemon.ts";
import type { Logger } from "../../logger/port.ts";
import type { RunDaemon } from "../../app/task/run-daemon.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Sets up a fresh migrated DB with one ready task (agent: fake@1).
 * Returns deps, INITIATIVE id, and TASK_ID.
 */
async function setupReadyTask(dbPath: string) {
  const deps = buildDeps(dbPath);
  await dispatch(["db", "migrate"], deps);

  const r1 = await dispatch(["create", "project", "--name", "demo"], deps);
  assert.equal(r1.exitCode, 0, "create project");
  const PROJECT = r1.stdout[0]!;
  assert.match(PROJECT, ULID_RE);

  const r2 = await dispatch(
    ["create", "initiative", "--project", PROJECT, "--name", "test-init"],
    deps,
  );
  assert.equal(r2.exitCode, 0, "create initiative");
  const INITIATIVE = r2.stdout[0]!;
  assert.match(INITIATIVE, ULID_RE);

  const r3 = await dispatch(
    ["create", "objective", "--initiative", INITIATIVE, "--name", "test-obj"],
    deps,
  );
  assert.equal(r3.exitCode, 0, "create objective");
  const OBJECTIVE = r3.stdout[0]!;
  assert.match(OBJECTIVE, ULID_RE);

  const r4 = await dispatch(
    [
      "create",
      "task",
      "--objective",
      OBJECTIVE,
      "--title",
      "ready task",
      "--instructions",
      "Complete the ready task",
      "--ac",
      "task is done",
      "--agent",
      "fake@1",
    ],
    deps,
  );
  assert.equal(r4.exitCode, 0, "create task");
  const TASK_ID = r4.stdout[0]!;
  assert.match(TASK_ID, ULID_RE);

  return { deps, INITIATIVE, TASK_ID };
}

// (c) fake@1 task runs end to end via daemon run --until-idle (no --runner flag)
test("daemon run --until-idle: fake@1 task exits 0 and task is completed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-a-"));
  try {
    const { deps, INITIATIVE } = await setupReadyTask(join(dir, "kanthord.db"));

    const result = await dispatch(["run", "daemon", "--until-idle"], deps);
    assert.equal(result.exitCode, 0, "daemon run exits 0");

    const list = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    assert.equal(list.exitCode, 0, "list task exits 0");
    assert.ok(
      list.stdout.join("\n").includes("completed"),
      "task should be in completed state",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (d) daemon run --runner fake → exit 1 (--runner flag removed / superseded)
test("daemon run --runner fake: exits 1 (--runner flag removed in T2)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-b-"));
  try {
    const deps = buildDeps(join(dir, "kanthord.db"));
    await dispatch(["db", "migrate"], deps);

    const result = await dispatch(
      ["run", "daemon", "--runner", "fake", "--until-idle"],
      deps,
    );
    assert.equal(
      result.exitCode,
      1,
      "exits 1 when --runner flag is used (flag removed)",
    );
    assert.ok(result.stderr.length > 0, "at least one stderr line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      "error line starts with 'error:'",
    );
    assert.ok(
      result.stderr[0]!.toLowerCase().includes("runner"),
      `error mentions 'runner', got: "${result.stderr[0]}"`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daemon run --fail <id>: scripted task fails, exits 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-c-"));
  try {
    const { deps, INITIATIVE, TASK_ID } = await setupReadyTask(
      join(dir, "kanthord.db"),
    );

    const result = await dispatch(
      ["run", "daemon", "--fail", TASK_ID, "--until-idle"],
      deps,
    );
    assert.equal(result.exitCode, 1, "exits 1 when a task fails");

    // Verify the task actually ran and failed (not just "unknown command" exit-1)
    const list = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    assert.equal(list.exitCode, 0, "list task exits 0");
    assert.ok(
      list.stdout.join("\n").includes("failed"),
      "task should be in failed state after --fail run",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daemon run --poll-interval abc: exits 1 with a validation error (not 'unknown command')", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-d-"));
  try {
    const deps = buildDeps(join(dir, "kanthord.db"));
    await dispatch(["db", "migrate"], deps);

    const result = await dispatch(
      ["run", "daemon", "--poll-interval", "abc", "--until-idle"],
      deps,
    );
    assert.equal(result.exitCode, 1, "exits 1 for invalid poll-interval");
    assert.equal(result.stderr.length, 1, "exactly one stderr line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      "error line starts with 'error:'",
    );
    assert.ok(
      !result.stderr[0]!.includes("unknown command"),
      "poll-interval validation error should not say 'unknown command' (command must be registered)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (e) AgentCatalog wired into create task accepts exactly the registered refs
test("create task --agent fake@1: exits 0; --agent ghost@9: exits 1 (catalog guards)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-e-"));
  try {
    const deps = buildDeps(join(dir, "kanthord.db"));
    await dispatch(["db", "migrate"], deps);

    const r1 = await dispatch(["create", "project", "--name", "demo"], deps);
    assert.equal(r1.exitCode, 0, "create project");
    const PROJECT = r1.stdout[0]!;

    const r2 = await dispatch(
      ["create", "initiative", "--project", PROJECT, "--name", "test-init"],
      deps,
    );
    assert.equal(r2.exitCode, 0, "create initiative");
    const INITIATIVE = r2.stdout[0]!;

    const r3 = await dispatch(
      ["create", "objective", "--initiative", INITIATIVE, "--name", "test-obj"],
      deps,
    );
    assert.equal(r3.exitCode, 0, "create objective");
    const OBJECTIVE = r3.stdout[0]!;

    // fake@1 should be accepted (registered in catalog after T2)
    const rFake = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "fake task",
        "--instructions",
        "run fake",
        "--ac",
        "fake done",
        "--agent",
        "fake@1",
      ],
      deps,
    );
    assert.equal(
      rFake.exitCode,
      0,
      "create task --agent fake@1 should succeed",
    );

    // ghost@9 should be rejected (not registered)
    const rGhost = await dispatch(
      [
        "create",
        "task",
        "--objective",
        OBJECTIVE,
        "--title",
        "ghost task",
        "--instructions",
        "run ghost",
        "--ac",
        "ghost done",
        "--agent",
        "ghost@9",
      ],
      deps,
    );
    assert.equal(rGhost.exitCode, 1, "create task --agent ghost@9 should fail");
    assert.ok(
      rGhost.stderr.join("").includes("ghost@9"),
      "error mentions the unregistered agent ref",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Story 07 T3: Logger flows through runDaemon to buildDaemon ---

// Fake RunDaemon that immediately idles (no tasks to run).
function makeFakeDaemon(): RunDaemon {
  return {
    execute: async () => ({ exitCode: 0, escalatedCount: 0 }),
    stop: () => {},
  } as unknown as RunDaemon;
}

test("T3a: runDaemon passes logger to buildDaemon as third argument", async () => {
  let receivedLogger: Logger | undefined;
  const capturingBuildDaemon = (
    _failTaskIds: string[],
    _failTransient?: Record<string, number>,
    logger?: Logger,
  ): RunDaemon => {
    receivedLogger = logger;
    return makeFakeDaemon();
  };

  const capturingLogger: Logger = {
    info: (_msg: string) => {},
    warn: (_msg: string) => {},
    error: (_msg: string) => {},
  };

  // runDaemon currently only accepts 2 args; T3 adds the third (TS2554 expected until GREEN)
  const result = await (runDaemon as Function)(
    { "until-idle": true },
    capturingBuildDaemon,
    capturingLogger,
  );

  assert.equal(result.exitCode, 0, "daemon exits 0 on idle");
  assert.strictEqual(
    receivedLogger,
    capturingLogger,
    "logger must be forwarded from runDaemon to buildDaemon",
  );
});

test("T3b: runDaemon without logger parameter still works (NullLogger default)", async () => {
  const simpleFakeBuildDaemon = (
    _failTaskIds: string[],
    _failTransient?: Record<string, number>,
    _logger?: Logger,
  ): RunDaemon => makeFakeDaemon();

  const result = await runDaemon({ "until-idle": true }, simpleFakeBuildDaemon);
  assert.equal(
    result.exitCode,
    0,
    "two-arg form still exits 0 (NullLogger default)",
  );
});

// --- 007.9 Story 02 — Contract item 5: --fail-transient daemon wiring ---

test("daemon run --fail-transient <id>:<count> parses to a { [taskId]: count } map and reaches buildDaemon (007.9 S2)", async () => {
  let receivedFailTransient: Record<string, number> | undefined;
  const capturingBuildDaemon = (
    _failTaskIds: string[],
    failTransient?: Record<string, number>,
    _logger?: Logger,
  ): RunDaemon => {
    receivedFailTransient = failTransient;
    return makeFakeDaemon();
  };

  const result = await runDaemon(
    { "until-idle": true, "fail-transient": ["TASK123:2"] },
    capturingBuildDaemon,
  );

  assert.equal(result.exitCode, 0, "daemon exits 0 on idle");
  assert.deepEqual(
    receivedFailTransient,
    { TASK123: 2 },
    "runDaemon must parse '<id>:<count>' and forward a { [taskId]: count } map to buildDaemon",
  );
});

test("daemon run --fail-transient <id>:<count>: task retries through transient failures then completes, exits 0 (007.9 S2 end-to-end)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-ft-"));
  try {
    const { deps, INITIATIVE, TASK_ID } = await setupReadyTask(
      join(dir, "kanthord.db"),
    );

    const result = await dispatch(
      ["run", "daemon", "--fail-transient", `${TASK_ID}:2`, "--until-idle"],
      deps,
    );
    assert.equal(
      result.exitCode,
      0,
      "daemon exits 0: transient failures must be retried, not fatal",
    );

    const list = await dispatch(
      ["list", "task", "--initiative", INITIATIVE],
      deps,
    );
    assert.equal(list.exitCode, 0, "list task exits 0");
    assert.ok(
      list.stdout.join("\n").includes("completed"),
      "task should reach completed once the transient failures are retried through",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
