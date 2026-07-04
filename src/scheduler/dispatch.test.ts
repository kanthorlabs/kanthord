import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { compile } from "../compiler/compile.ts";
import {
  loadTasks,
  dispatchable,
  markExitGatePassed,
  setTaskStatus,
} from "./dispatch.ts";
import type { TaskRow } from "./dispatch.ts";

// ---------------------------------------------------------------------------
// Golden fixture
//
// feat-001
//   001-story-a  → task-alpha  (root: no explicit depends_on; produces api-spec)
//   002.1-story-b → task-beta  (depends_on task-alpha: handoff + grammar edge)
//   002.2-story-c → task-gamma (parallel lane sibling: grammar edge from task-alpha)
//
// Expected edge set after compile (task nodes only):
//   task-alpha → task-beta  (grammar, major 1→2)
//   task-alpha → task-beta  (handoff, frozen)  ← deduped in depends_on[]
//   task-alpha → task-gamma (grammar, major 1→2)
//
// Scheduler task rows:
//   task-alpha : depends_on=[], status=pending
//   task-beta  : depends_on=["task-alpha"], status=pending
//   task-gamma : depends_on=["task-alpha"], status=pending
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

const TASK_BETA_MD = `---
id: task-beta
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-102
depends_on:
  - task: task-alpha
    output: api-spec
    semantics: frozen
---

## Prerequisites

echo "setup beta env"

## Inputs

api-spec from task-alpha.

## Outputs

beta-output

## Tests

Integration tests for beta.
`;

const TASK_GAMMA_MD = `---
id: task-gamma
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-103
---

## Prerequisites

echo "setup gamma env"

## Inputs

Nothing.

## Outputs

gamma-output

## Tests

Unit tests for gamma.
`;

const COMPILE_OPTS = { repoRegistry: ["backend"] };

// ---------------------------------------------------------------------------
// Suite: src/scheduler/dispatch
// ---------------------------------------------------------------------------

describe("src/scheduler/dispatch", () => {
  describe("loadTasks — task rows carry feature_id, depends_on[], status, generation", () => {
    let featureDir = "";
    let dbPath = "";

    before(async () => {
      featureDir = await mkdtemp(join(tmpdir(), "kanthord-dispatch-t1-"));
      dbPath = join(featureDir, "test.db");

      await writeFile(join(featureDir, "epic.md"), EPIC_MD);
      await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");

      const storyA = join(featureDir, "001-story-a");
      await mkdir(storyA);
      await writeFile(join(storyA, "INDEX.md"), "# Story A\n");
      await writeFile(join(storyA, "001-task-alpha.md"), TASK_ALPHA_MD);

      const storyB = join(featureDir, "002.1-story-b");
      await mkdir(storyB);
      await writeFile(join(storyB, "INDEX.md"), "# Story B\n");
      await writeFile(join(storyB, "001-task-beta.md"), TASK_BETA_MD);

      const storyC = join(featureDir, "002.2-story-c");
      await mkdir(storyC);
      await writeFile(join(storyC, "INDEX.md"), "# Story C\n");
      await writeFile(join(storyC, "001-task-gamma.md"), TASK_GAMMA_MD);
    });

    after(async () => {
      if (featureDir) await rm(featureDir, { recursive: true, force: true });
    });

    test("returns only task-kind nodes for the given feature", async () => {
      const store = openStore(dbPath, { busyTimeout: 1000 });
      try {
        await compile(featureDir, store, COMPILE_OPTS);
        const tasks = loadTasks(store, "feat-001");

        const taskIds = tasks.map((t: TaskRow) => t.id).sort();
        assert.deepEqual(
          taskIds,
          ["task-alpha", "task-beta", "task-gamma"],
          "should return exactly the three task nodes (not epic/story nodes)",
        );
      } finally {
        store.close();
      }
    });

    test("each row carries feature_id, status=pending, and a positive generation", async () => {
      const store = openStore(dbPath, { busyTimeout: 1000 });
      try {
        await compile(featureDir, store, COMPILE_OPTS);
        const tasks = loadTasks(store, "feat-001");

        for (const task of tasks) {
          assert.equal(
            task.feature_id,
            "feat-001",
            `${task.id}.feature_id should equal the feature`,
          );
          assert.equal(
            task.status,
            "pending",
            `${task.id}.status should be pending on first load`,
          );
          assert.equal(
            typeof task.generation,
            "number",
            `${task.id}.generation should be a number`,
          );
          assert.ok(
            task.generation >= 1,
            `${task.id}.generation should be >= 1 after compile`,
          );
        }
      } finally {
        store.close();
      }
    });

    test("depends_on[] matches the edge set for the golden fixture", async () => {
      const store = openStore(dbPath, { busyTimeout: 1000 });
      try {
        await compile(featureDir, store, COMPILE_OPTS);
        const tasks = loadTasks(store, "feat-001");

        const byId = new Map(tasks.map((t: TaskRow) => [t.id, t]));

        // Root task: no incoming task edges
        const alpha = byId.get("task-alpha");
        assert.ok(alpha !== undefined, "task-alpha row must exist");
        assert.ok(Array.isArray(alpha.depends_on), "depends_on must be an array");
        assert.deepEqual(
          alpha.depends_on.slice().sort(),
          [],
          "task-alpha has no task dependencies",
        );

        // task-beta depends on task-alpha (grammar + handoff edge, deduped to one entry)
        const beta = byId.get("task-beta");
        assert.ok(beta !== undefined, "task-beta row must exist");
        assert.ok(Array.isArray(beta.depends_on), "depends_on must be an array");
        assert.deepEqual(
          beta.depends_on.slice().sort(),
          ["task-alpha"],
          "task-beta depends on task-alpha",
        );

        // task-gamma depends on task-alpha (grammar edge, major 1→2 parallel lane)
        const gamma = byId.get("task-gamma");
        assert.ok(gamma !== undefined, "task-gamma row must exist");
        assert.ok(Array.isArray(gamma.depends_on), "depends_on must be an array");
        assert.deepEqual(
          gamma.depends_on.slice().sort(),
          ["task-alpha"],
          "task-gamma depends on task-alpha (grammar edge, parallel lane)",
        );
      } finally {
        store.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // T2 — Dispatch predicate honors dependency exit gates
  // ---------------------------------------------------------------------------

  describe("dispatchable — dispatch predicate honors dependency exit gates", () => {
    // Each test gets its own compiled DB so scheduler_task state is isolated.
    let featDir = "";
    let testDir = "";
    let testDbPath = "";

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-dispatch-t2-feat-"));
      await writeFile(join(featDir, "epic.md"), EPIC_MD);
      await writeFile(join(featDir, "RUNBOOK.md"), "# Runbook\n");

      const sA = join(featDir, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-alpha.md"), TASK_ALPHA_MD);

      const sB = join(featDir, "002.1-story-b");
      await mkdir(sB);
      await writeFile(join(sB, "INDEX.md"), "# Story B\n");
      await writeFile(join(sB, "001-task-beta.md"), TASK_BETA_MD);

      const sC = join(featDir, "002.2-story-c");
      await mkdir(sC);
      await writeFile(join(sC, "INDEX.md"), "# Story C\n");
      await writeFile(join(sC, "001-task-gamma.md"), TASK_GAMMA_MD);
    });

    after(async () => {
      if (featDir) await rm(featDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "kanthord-dispatch-t2-db-"));
      testDbPath = join(testDir, "test.db");
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        await compile(featDir, store, COMPILE_OPTS);
        loadTasks(store, "feat-001"); // seed scheduler_task rows
      } finally {
        store.close();
      }
    });

    afterEach(async () => {
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
      testDbPath = "";
    });

    test("only root tasks are dispatchable when no exit gate has passed", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        const tasks = dispatchable(store, "feat-001");
        assert.deepEqual(
          tasks.map((t: TaskRow) => t.id).sort(),
          ["task-alpha"],
          "only the root task (no dependencies) is dispatchable initially",
        );
      } finally {
        store.close();
      }
    });

    test("parallel-lane siblings both become dispatchable together once their shared dependency exit gate passes", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        markExitGatePassed(store, "task-alpha");
        setTaskStatus(store, "task-alpha", "done");
        const tasks = dispatchable(store, "feat-001");
        assert.deepEqual(
          tasks.map((t: TaskRow) => t.id).sort(),
          ["task-beta", "task-gamma"],
          "both parallel siblings dispatch together when their shared dependency gate passes",
        );
      } finally {
        store.close();
      }
    });

    test("a done task is never re-dispatched", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        markExitGatePassed(store, "task-alpha");
        setTaskStatus(store, "task-alpha", "done");
        const ids = dispatchable(store, "feat-001").map((t: TaskRow) => t.id);
        assert.ok(!ids.includes("task-alpha"), "done task must not reappear");
      } finally {
        store.close();
      }
    });

    test("a dependency done but exit gate not passed does not unblock its dependents", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        // Mark task-alpha done but do NOT call markExitGatePassed — gate stays unset
        setTaskStatus(store, "task-alpha", "done");
        const ids = dispatchable(store, "feat-001").map((t: TaskRow) => t.id);
        assert.ok(
          !ids.includes("task-beta"),
          "task-beta must not dispatch when dependency task-alpha gate is not passed",
        );
        assert.ok(
          !ids.includes("task-gamma"),
          "task-gamma must not dispatch when dependency task-alpha gate is not passed",
        );
        // task-alpha itself is done so it also must not appear
        assert.ok(!ids.includes("task-alpha"), "done task-alpha must not be re-dispatched");
        assert.deepEqual(ids, [], "no task is dispatchable in this state");
      } finally {
        store.close();
      }
    });

    test("full dispatch sequence follows DAG order on the golden fixture", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        const sequence: string[][] = [];

        // Wave 1: only root
        sequence.push(dispatchable(store, "feat-001").map((t: TaskRow) => t.id).sort());

        // Simulate dispatching task-alpha: mark done + exit gate passed
        setTaskStatus(store, "task-alpha", "done");
        markExitGatePassed(store, "task-alpha");

        // Wave 2: both parallel siblings
        sequence.push(dispatchable(store, "feat-001").map((t: TaskRow) => t.id).sort());

        // Simulate completing both siblings
        setTaskStatus(store, "task-beta", "done");
        markExitGatePassed(store, "task-beta");
        setTaskStatus(store, "task-gamma", "done");
        markExitGatePassed(store, "task-gamma");

        // Wave 3: nothing left
        sequence.push(dispatchable(store, "feat-001").map((t: TaskRow) => t.id).sort());

        assert.deepEqual(
          sequence,
          [["task-alpha"], ["task-beta", "task-gamma"], []],
          "dispatch sequence must follow DAG order",
        );
      } finally {
        store.close();
      }
    });

    test("two calls over unchanged persisted state return the identical set (pure function of state)", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        markExitGatePassed(store, "task-alpha");
        setTaskStatus(store, "task-alpha", "done");
        const a = dispatchable(store, "feat-001").map((t: TaskRow) => t.id).sort();
        const b = dispatchable(store, "feat-001").map((t: TaskRow) => t.id).sort();
        assert.deepEqual(a, b, "dispatchable must be a pure function of persisted state");
      } finally {
        store.close();
      }
    });
  });
});
