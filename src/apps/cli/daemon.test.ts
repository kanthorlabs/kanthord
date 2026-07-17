import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { dispatch } from "./router.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Sets up a fresh migrated DB with one ready task.
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
    ["create", "task", "--objective", OBJECTIVE, "--title", "ready task"],
    deps,
  );
  assert.equal(r4.exitCode, 0, "create task");
  const TASK_ID = r4.stdout[0]!;
  assert.match(TASK_ID, ULID_RE);

  return { deps, INITIATIVE, TASK_ID };
}

test("daemon run --runner fake --until-idle: exits 0 and task is completed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-a-"));
  try {
    const { deps, INITIATIVE } = await setupReadyTask(join(dir, "kanthord.db"));

    const result = await dispatch(
      ["daemon", "run", "--runner", "fake", "--until-idle"],
      deps,
    );
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

test("daemon run --runner nope: exits 1 with 'error: unknown runner: nope'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-daemon-b-"));
  try {
    const deps = buildDeps(join(dir, "kanthord.db"));
    await dispatch(["db", "migrate"], deps);

    const result = await dispatch(
      ["daemon", "run", "--runner", "nope", "--until-idle"],
      deps,
    );
    assert.equal(result.exitCode, 1, "exits 1 for unknown runner");
    assert.equal(result.stderr.length, 1, "exactly one stderr line");
    assert.equal(
      result.stderr[0],
      "error: unknown runner: nope",
      "exact error message for unknown runner",
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
      ["daemon", "run", "--runner", "fake", "--fail", TASK_ID, "--until-idle"],
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
      [
        "daemon",
        "run",
        "--runner",
        "fake",
        "--poll-interval",
        "abc",
        "--until-idle",
      ],
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
