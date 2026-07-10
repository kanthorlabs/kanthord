import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { compile } from "../compiler/compile.ts";
import { loadTasks, dispatchable } from "./dispatch.ts";
import { initSchema } from "../store/schema.ts";
import { LeaseManager } from "./leases.ts";
import type { Capability } from "./leases.ts";
import { park, writeCompletion, resume } from "./blocked-on.ts";
import type { ResumeContext } from "./blocked-on.ts";

// ---------------------------------------------------------------------------
// Minimal feature fixture — one root task, no dependencies.
// Reuses the same task-alpha shape proven to compile in dispatch.test.ts.
// ---------------------------------------------------------------------------

const EPIC_MD = `---
id: feat-001
repo: backend
---

## Acceptance

Feature is complete when all tasks pass.
`;

const TASK_ALPHA_MD = `---
id: task-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-101
outputs:
  - api-spec
artifacts_out:
  - id: api-spec
    kind: api
    path: api/spec.yaml
---

## Prerequisites

echo "setup alpha env"

## Inputs

Nothing required.

## Outputs

- api-spec

## Tests

Unit tests for alpha.
`;

const COMPILE_OPTS = { repoRegistry: ["backend"] };

// ---------------------------------------------------------------------------
// Suite: src/scheduler/blocked-on
// ---------------------------------------------------------------------------

describe("src/scheduler/blocked-on", () => {
  let featDir = "";
  let testDir = "";
  let store: Store;
  let clock: FakeClock;
  let lm: LeaseManager;

  const scope: Capability = { kind: "write_scope", path: "ios/**" };

  before(async () => {
    featDir = await mkdtemp(join(tmpdir(), "kanthord-blocked-on-feat-"));
    await writeFile(join(featDir, "epic.md"), EPIC_MD);
    await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");
    const storyA = join(featDir, "001-story-a");
    await mkdir(storyA);
    await writeFile(join(storyA, "INDEX.md"), "# Story A\n");
    await writeFile(join(storyA, "001-task-alpha.md"), TASK_ALPHA_MD);
  });

  after(async () => {
    if (featDir) await rm(featDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "kanthord-blocked-on-db-"));
    const dbPath = join(testDir, "test.db");
    store = openStore(dbPath, { busyTimeout: 1000 });
    clock = new FakeClock(0);
    lm = new LeaseManager(store, clock);
    await compile(featDir, store, COMPILE_OPTS);
    initSchema(store); // create all subsystem tables before first scheduler call
    loadTasks(store, "feat-001"); // seed scheduler_task rows
  });

  afterEach(async () => {
    store.close();
    if (testDir) await rm(testDir, { recursive: true, force: true });
    testDir = "";
  });

  test("parked task (blocked_on set) is excluded from dispatchable even when gates are satisfied", () => {
    // task-alpha is root (no deps) so it is immediately dispatchable before parking
    const beforePark = dispatchable(store, "feat-001").map((t) => t.id);
    assert.ok(
      beforePark.includes("task-alpha"),
      "task-alpha must be dispatchable before park (root task, gates trivially satisfied)",
    );

    // Simulate task-alpha running: it holds leases
    lm.acquire("task-alpha", [scope]);

    // Park the task on an async op — must release its leases
    park(store, "task-alpha", "op-1", [scope], lm);

    // dispatchable must NOT include task-alpha while it is parked
    const afterPark = dispatchable(store, "feat-001").map((t) => t.id);
    assert.ok(
      !afterPark.includes("task-alpha"),
      "parked task must be excluded from dispatchable",
    );
  });

  test("parking releases the task's leases: another task can acquire the same capability", () => {
    lm.acquire("task-alpha", [scope]);

    // While task-alpha holds the lease, task-other is blocked
    const blockedBefore = lm.acquire("task-other", [scope]);
    assert.equal(
      blockedBefore,
      false,
      "task-other blocks while task-alpha holds the lease",
    );

    // Park task-alpha — must release its capability leases
    park(store, "task-alpha", "op-1", [scope], lm);

    // task-other can now acquire in the same poll pass
    const acquiredAfter = lm.acquire("task-other", [scope]);
    assert.equal(
      acquiredAfter,
      true,
      "task-other acquires after task-alpha is parked (leases released)",
    );
  });

  // ---------------------------------------------------------------------------
  // T2 — Parked task holds no runtime handle
  //
  // After park(), closing the original store + creating a completely fresh store
  // and LeaseManager (no shared in-memory state) must be sufficient to resume the
  // task.  This pins the "no runtime handle" property: if park()/resume() relied
  // on any in-memory state (a Map, a closure, a module-level variable), the test
  // would fail because the fresh objects have no such state.
  // ---------------------------------------------------------------------------

  test("parked task: reconstructing from DB row alone is sufficient to resume (no runtime handle needed)", () => {
    // Park the task — stores blocked_on + capability rows in DB, releases leases.
    lm.acquire("task-alpha", [scope]);
    park(store, "task-alpha", "op-1", [scope], lm);

    // Simulate a process restart: close the original store, destroying ALL in-memory
    // state — the LeaseManager cache, any closures, module-level maps, etc.
    store.close();

    // Reconstruct purely from the DB file: fresh store, clock, and LeaseManager.
    // These objects have zero knowledge of the original park() call.
    const freshStore = openStore(join(testDir, "test.db"), { busyTimeout: 1000 });
    const freshClock = new FakeClock(0);
    const freshLm = new LeaseManager(freshStore, freshClock);
    // Hand freshStore to afterEach so it will be closed + testDir cleaned up.
    store = freshStore;

    // Write the completion row via the fresh store (different in-memory objects).
    writeCompletion(freshStore, "op-1", "done", '{"reconstructed":true}', null, 1000);

    // resume() must work purely from DB state — blocked_on row + completion row.
    const contexts = resume(freshStore, "feat-001", freshLm);
    const ctx = contexts.find((c: ResumeContext) => c.taskId === "task-alpha");
    assert.ok(
      ctx !== undefined,
      "resume must work from DB row alone — no runtime handle needed",
    );
    assert.equal(
      ctx.resultJson,
      '{"reconstructed":true}',
      "result must be injected from completion row even after process reconstruction",
    );
    assert.equal(ctx.errorJson, null, "errorJson must be null for a successful completion");

    // resume() must have re-acquired the lease via freshLm: another task cannot
    // take the same capability immediately after resume.
    const canOtherAcquire = freshLm.acquire("task-other", [scope]);
    assert.equal(
      canOtherAcquire,
      false,
      "freshLm must hold task-alpha's lease after resume (re-acquired from persisted cap rows)",
    );

    // task-alpha is now dispatchable through the fresh store.
    const dispatched = dispatchable(freshStore, "feat-001").map((t) => t.id);
    assert.ok(
      dispatched.includes("task-alpha"),
      "task-alpha must be dispatchable after reconstruction-based resume",
    );
  });

  test("task is re-dispatchable after completion row written; resume reacquires leases and injects result", () => {
    lm.acquire("task-alpha", [scope]);
    park(store, "task-alpha", "op-1", [scope], lm);

    // Before completion row exists: still not dispatchable
    const beforeComplete = dispatchable(store, "feat-001").map((t) => t.id);
    assert.ok(
      !beforeComplete.includes("task-alpha"),
      "task-alpha not dispatchable before completion row exists",
    );

    // Write completion row (fake broker — real broker is Epic 005)
    writeCompletion(store, "op-1", "done", '{"value":42}', null, 1000);

    // resume() reacquires leases, clears blocked_on, returns contexts with result
    const contexts = resume(store, "feat-001", lm);
    const ctx = contexts.find((c: ResumeContext) => c.taskId === "task-alpha");
    assert.ok(
      ctx !== undefined,
      "task-alpha must appear in resumed contexts",
    );
    assert.equal(
      ctx.resultJson,
      '{"value":42}',
      "resume must inject the completion result from broker_completion",
    );
    assert.equal(
      ctx.errorJson,
      null,
      "errorJson must be null for a successful completion",
    );

    // After resume, task-alpha is pending with no blocked_on and is dispatchable again
    const afterResume = dispatchable(store, "feat-001").map((t) => t.id);
    assert.ok(
      afterResume.includes("task-alpha"),
      "task-alpha must be dispatchable after resume clears blocked_on",
    );
  });

  // ---------------------------------------------------------------------------
  // S1 regression — resume must NOT clear blocked_on / capability rows / set
  // status=pending when lm.acquire returns false.  The task must stay parked
  // and retry on a later poll pass.
  // ---------------------------------------------------------------------------

  test("resume stays parked when lease reacquire fails: competing holder blocks reacquire", () => {
    // Park task-alpha on op-2, releasing the ios/** lease.
    lm.acquire("task-alpha", [scope]);
    park(store, "task-alpha", "op-2", [scope], lm);

    // A competing task now holds ios/** (possible because park released it).
    const competitorAcquired = lm.acquire("competitor", [scope]);
    assert.equal(
      competitorAcquired,
      true,
      "competitor must be able to acquire after park released the lease",
    );

    // Write the completion row — the op is done, but the lease is still held.
    writeCompletion(store, "op-2", "done", null, null, 1000);

    // Call resume — lm.acquire("task-alpha", [scope]) returns false because
    // competitor still holds ios/**.  The task must remain parked.
    const contexts = resume(store, "feat-001", lm);

    // 1. task-alpha must NOT appear in the returned contexts.
    const ctx = contexts.find((c: ResumeContext) => c.taskId === "task-alpha");
    assert.equal(
      ctx,
      undefined,
      "parked task must NOT appear in resume contexts when reacquire fails",
    );

    // 2. blocked_on must still be set in the DB row.
    const taskRow = store.get<{ blocked_on: string | null }>(
      "SELECT blocked_on FROM scheduler_task WHERE node_id = ?",
      "task-alpha",
    );
    assert.notEqual(
      taskRow?.blocked_on ?? null,
      null,
      "blocked_on must still be set when reacquire fails",
    );

    // 3. Capability rows must still exist in blocked_on_capability.
    const capRows = store.all<{ task_id: string }>(
      "SELECT task_id FROM blocked_on_capability WHERE task_id = ?",
      "task-alpha",
    );
    assert.ok(
      capRows.length > 0,
      "blocked_on_capability rows must still exist when reacquire fails",
    );

    // 4. task-alpha must NOT be in the dispatchable set (still parked).
    const dispatchSet = dispatchable(store, "feat-001").map((t) => t.id);
    assert.ok(
      !dispatchSet.includes("task-alpha"),
      "parked task must NOT appear in dispatchable set when reacquire fails",
    );
  });

  test("writeCompletion persists the supplied at timestamp into broker_completion.at", () => {
    const AT = 9_876_543;
    writeCompletion(store, "op-ts", "done", null, null, AT);
    const row = store.get<{ at: number }>(
      "SELECT at FROM broker_completion WHERE op_id = ?",
      "op-ts",
    );
    assert.ok(row !== undefined, "broker_completion row must exist for op-ts");
    assert.equal(row.at, AT, "broker_completion.at must equal the supplied timestamp");
  });
});
