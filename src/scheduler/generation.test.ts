import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { compile } from "../compiler/compile.ts";
import { loadTasks, setTaskStatus, markExitGatePassed } from "./dispatch.ts";
import { initSchema } from "../store/schema.ts";
import { pinGeneration, getPinnedGeneration, isPlanDirty, dispatchableForGeneration } from "./generation.ts";

// ---------------------------------------------------------------------------
// Golden fixture — same three-task DAG used by dispatch.test.ts
//   task-alpha (root), task-beta (depends task-alpha), task-gamma (depends task-alpha)
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
// Suite: src/scheduler/generation
// ---------------------------------------------------------------------------

describe("src/scheduler/generation", () => {
  // --------------------------------------------------------------------------
  // T1 — generation pinning on first dispatch
  // --------------------------------------------------------------------------

  describe("T1 — pinGeneration / getPinnedGeneration: first-dispatch generation stamp", () => {
    let featDir = "";
    let testDir = "";
    let testDbPath = "";

    // One shared feature-file directory; each test gets its own DB.
    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-gen-t1-feat-"));

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
      testDir = await mkdtemp(join(tmpdir(), "kanthord-gen-t1-db-"));
      testDbPath = join(testDir, "test.db");
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        await compile(featDir, store, COMPILE_OPTS);
        initSchema(store);
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

    test("a task dispatched under generation G is pinned to G", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        // First compile always yields generation 1 on a fresh DB.
        pinGeneration(store, "task-alpha");
        assert.equal(
          getPinnedGeneration(store, "task-alpha"),
          1,
          "pinned generation must equal the current plan_node.generation (G=1)",
        );
      } finally {
        store.close();
      }
    });

    test("pinned generation remains G when plan_node.generation is later bumped to G+1", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        // Pin at G=1 (first dispatch).
        pinGeneration(store, "task-alpha");
        assert.equal(getPinnedGeneration(store, "task-alpha"), 1, "initial pin = 1");

        // Simulate recompile: plan_node.generation advances to 2.
        // (In production this is done by compile(); here we do it directly so the
        // test stays hermetic without requiring a second compile call.)
        store.run(
          "UPDATE plan_node SET generation = 2 WHERE id = 'task-alpha'",
        );

        // A second call to pinGeneration must be a no-op for an already-pinned task.
        pinGeneration(store, "task-alpha");

        assert.equal(
          getPinnedGeneration(store, "task-alpha"),
          1,
          "pinned generation must still be 1 (G), not 2 (G+1), after plan_node advances",
        );
      } finally {
        store.close();
      }
    });

    test("a task not yet dispatched returns null for its pinned generation", () => {
      const store: Store = openStore(testDbPath, { busyTimeout: 1000 });
      try {
        // No pinGeneration call made — task has never been dispatched.
        assert.equal(
          getPinnedGeneration(store, "task-alpha"),
          null,
          "unpinned task must return null",
        );
      } finally {
        store.close();
      }
    });
  });

  // --------------------------------------------------------------------------
  // T2 — dirty plan halts new dispatch, running tasks continue
  // --------------------------------------------------------------------------

  describe("T2 — dirty plan halts new dispatch, running tasks continue", () => {
    let featDir2 = "";
    let testDir2 = "";
    let testDbPath2 = "";

    before(async () => {
      featDir2 = await mkdtemp(join(tmpdir(), "kanthord-gen-t2-feat-"));

      await writeFile(join(featDir2, "epic.md"), EPIC_MD);
      await writeFile(join(featDir2, "RUNBOOK.md"), "# Runbook\n");

      const sA = join(featDir2, "001-story-a");
      await mkdir(sA);
      await writeFile(join(sA, "INDEX.md"), "# Story A\n");
      await writeFile(join(sA, "001-task-alpha.md"), TASK_ALPHA_MD);

      const sB = join(featDir2, "002.1-story-b");
      await mkdir(sB);
      await writeFile(join(sB, "INDEX.md"), "# Story B\n");
      await writeFile(join(sB, "001-task-beta.md"), TASK_BETA_MD);

      const sC = join(featDir2, "002.2-story-c");
      await mkdir(sC);
      await writeFile(join(sC, "INDEX.md"), "# Story C\n");
      await writeFile(join(sC, "001-task-gamma.md"), TASK_GAMMA_MD);
    });

    after(async () => {
      if (featDir2) await rm(featDir2, { recursive: true, force: true });
    });

    beforeEach(async () => {
      testDir2 = await mkdtemp(join(tmpdir(), "kanthord-gen-t2-db-"));
      testDbPath2 = join(testDir2, "test.db");
      const store: Store = openStore(testDbPath2, { busyTimeout: 1000 });
      try {
        await compile(featDir2, store, COMPILE_OPTS);
        initSchema(store);
        loadTasks(store, "feat-001");
      } finally {
        store.close();
      }
    });

    afterEach(async () => {
      if (testDir2) await rm(testDir2, { recursive: true, force: true });
      testDir2 = "";
      testDbPath2 = "";
    });

    test("isPlanDirty: false when live hash matches stored generation, true when mismatched", () => {
      const store: Store = openStore(testDbPath2, { busyTimeout: 1000 });
      try {
        const genRow = store.get<{ compile_hash: string }>(
          "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
        );
        const storedHash = genRow?.compile_hash ?? "";
        assert.ok(storedHash.length > 0, "plan_generation must have compile_hash after compile");

        // Same hash → plan is NOT dirty
        assert.equal(
          isPlanDirty(store, "feat-001", storedHash),
          false,
          "plan is not dirty when live hash matches stored",
        );

        // Different hash → plan IS dirty
        assert.equal(
          isPlanDirty(store, "feat-001", "any-other-hash"),
          true,
          "plan is dirty when live hash differs from stored",
        );
      } finally {
        store.close();
      }
    });

    test("dirty plan: dispatchableForGeneration excludes pending tasks; running task not returned as fresh candidate", () => {
      const store: Store = openStore(testDbPath2, { busyTimeout: 1000 });
      try {
        const genRow = store.get<{ compile_hash: string }>(
          "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
        );
        const storedHash = genRow?.compile_hash ?? "";
        assert.ok(storedHash.length > 0, "plan_generation must have compile_hash after compile");

        // Baseline: task-alpha (root pending) is dispatchable when plan is clean
        const cleanResult = dispatchableForGeneration(store, "feat-001", storedHash);
        assert.ok(
          cleanResult.some((t) => t.id === "task-alpha"),
          "task-alpha dispatchable when plan is clean",
        );

        // Pin task-alpha as running under G=1
        pinGeneration(store, "task-alpha");
        setTaskStatus(store, "task-alpha", "running");
        assert.equal(getPinnedGeneration(store, "task-alpha"), 1, "task-alpha pinned at G=1");

        // Dirty plan: live hash differs from stored
        const dirtyResult = dispatchableForGeneration(store, "feat-001", "dirty-hash-mismatch");
        assert.equal(
          dirtyResult.length,
          0,
          "no tasks dispatched when dirty: pending tasks halted, running task not a fresh candidate",
        );

        // task-alpha's generation pin is unchanged (not restamped while running and dirty)
        assert.equal(
          getPinnedGeneration(store, "task-alpha"),
          1,
          "running task generation pin is unchanged when dirty",
        );
      } finally {
        store.close();
      }
    });

    test("after recompile to G+1: halted pending task dispatches and pins G+1; running G task keeps its G pin", () => {
      const store: Store = openStore(testDbPath2, { busyTimeout: 1000 });
      try {
        // task-alpha: dispatch under G=1, mark as running, pass its exit gate so task-beta unblocks
        pinGeneration(store, "task-alpha");
        setTaskStatus(store, "task-alpha", "running");
        markExitGatePassed(store, "task-alpha");

        // Confirm task-beta is halted when dirty
        const haltedResult = dispatchableForGeneration(store, "feat-001", "dirty-hash-mismatch");
        assert.equal(haltedResult.length, 0, "task-beta halted when dirty before recompile");

        // Simulate recompile → G=2:
        //   insert a new plan_generation row with the "clean" hash for G=2,
        //   advance plan_node.generation for all nodes to 2 (mirrors what compile() does).
        const cleanHashG2 = "clean-hash-after-recompile-g2";
        store.run(
          "INSERT INTO plan_generation (generation, compile_hash, feature_id, at) VALUES (2, ?, 'feat-001', '2026-07-04T00:00:00.000Z')",
          cleanHashG2,
        );
        store.run(
          "UPDATE plan_node SET generation = 2 WHERE feature_id = 'feat-001'",
        );

        // Plan is now clean with the new hash
        assert.equal(
          isPlanDirty(store, "feat-001", cleanHashG2),
          false,
          "plan is clean after recompile",
        );

        // Dirty-aware dispatch with new clean hash: task-beta should be dispatchable
        // (task-alpha's exit gate passed; task-beta is pending and not blocked)
        const afterRecompile = dispatchableForGeneration(store, "feat-001", cleanHashG2);
        assert.ok(
          afterRecompile.some((t) => t.id === "task-beta"),
          "task-beta is dispatchable after recompile",
        );

        // Stamp task-beta on dispatch → must receive G=2 (plan_node.generation = 2 after recompile)
        pinGeneration(store, "task-beta");
        assert.equal(
          getPinnedGeneration(store, "task-beta"),
          2,
          "task-beta stamped G=2 after recompile to G+1",
        );

        // task-alpha's pin is still G=1 (idempotent — never restamped)
        assert.equal(
          getPinnedGeneration(store, "task-alpha"),
          1,
          "task-alpha still pinned at G=1, not restamped after recompile",
        );
      } finally {
        store.close();
      }
    });
  });

  // --------------------------------------------------------------------------
  // No-self-migration contract — getPinnedGeneration must NOT perform its own
  // DDL. After schema-bootstrap-consolidation, initSchema() is the sole DDL
  // path. Callers (e.g. harness/lifecycle.ts) always call initSchema before
  // any scheduler read, so a fresh-but-initialised store with no pinned row
  // must return null cleanly.
  // --------------------------------------------------------------------------

  describe("no-self-migration — getPinnedGeneration reads without DDL", () => {
    let s2Dir = "";

    afterEach(async () => {
      if (s2Dir) await rm(s2Dir, { recursive: true, force: true });
      s2Dir = "";
    });

    test("getPinnedGeneration returns null when schema is initialised but no row exists", async () => {
      s2Dir = await mkdtemp(join(tmpdir(), "kanthord-gen-s2-"));
      const freshStore: Store = openStore(join(s2Dir, "s2.db"), { busyTimeout: 1000 });
      try {
        // initSchema is the sole DDL path — callers always invoke it before
        // any scheduler read. With the schema present but no pinned row,
        // getPinnedGeneration must return null without throwing.
        initSchema(freshStore);
        assert.doesNotThrow(
          () => getPinnedGeneration(freshStore, "nonexistent-task"),
          "getPinnedGeneration must not throw when schema is initialised but no row exists",
        );
        assert.equal(
          getPinnedGeneration(freshStore, "nonexistent-task"),
          null,
          "getPinnedGeneration must return null when no generation row is pinned",
        );
      } finally {
        freshStore.close();
      }
    });
  });
});
