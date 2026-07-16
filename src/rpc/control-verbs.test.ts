/**
 * src/rpc/control-verbs.test.ts
 *
 * Story 002 — Control Verbs.
 *
 * Task T1 tests:
 *   (a) signOffPlan — invalid ⇒ verbatim planner-vocabulary diagnostics returned by
 *                     the Epic 002 compile seam; valid ⇒ generation stamped +
 *                     sign-off journaled with actor in control_journal.
 *   (b) haltTask — parks task (sets blocked_on) + journals halt with actor in
 *                  control_journal; a second halt on the same task throws a typed
 *                  HaltConflictError; the halted task is absent from the
 *                  pending-unblocked (blocked_on IS NULL) scheduler query.
 *
 * Task T2 tests:
 *   (a) approveReplan — applies edit set as one plan commit, mints G+1, re-opens only
 *                       the affected task gate; path traversal rejected as
 *                       PathViolationError; base-generation mismatch is a typed
 *                       GenerationConflictError; failing recompile rolls back to the
 *                       pre-apply commit.
 *   (b) budgetOverride — rate-limit rejection (OverrideRateLimitError); per-day-cap
 *                        rejection (OverrideDayCapError); accepted override annotates
 *                        budget_ledger and emits an interaction event; second override
 *                        on the same task is rejected one-shot (OverrideAlreadyAppliedError).
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { compile, applyCompiledPlanMigration } from "../compiler/compile.ts";
import type { LeafLogger } from "../foundations/log.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import {
  signOffPlan,
  haltTask,
  HaltConflictError,
  haltFeature,
  HaltFeatureConflictError,
  approveReplan,
  budgetOverride,
  PathViolationError,
  GenerationConflictError,
  OverrideRateLimitError,
  OverrideDayCapError,
  OverrideAlreadyAppliedError,
  DuplicateEditTargetError,
  type ControlVerbsDeps,
  type ReplanDiff,
  type BudgetOverrideDeps,
} from "./control-verbs.ts";

// ---------------------------------------------------------------------------
// S2 regression — PostDeleteInjectingStore: forwards all store.run calls until
// a "DELETE FROM plan_node" is observed, then throws on the next
// "INSERT INTO plan_node" call to simulate a post-DELETE store failure inside
// compile(). Used to assert that B5 SAVEPOINT in approveReplan rolls back
// all plan rows atomically.
// ---------------------------------------------------------------------------

class PostDeleteInjectingStore {
  private inner: Store;
  private deleteSeen: boolean;

  constructor(inner: Store) {
    this.inner = inner;
    this.deleteSeen = false;
  }

  run(sql: string, ...params: unknown[]): void {
    const upper = sql.trimStart().toUpperCase();
    if (upper.startsWith("DELETE FROM PLAN_NODE")) {
      this.deleteSeen = true;
    }
    if (this.deleteSeen && upper.startsWith("INSERT INTO PLAN_NODE ")) {
      throw new Error("INJECTED: post-delete plan_node insert failure");
    }
    this.inner.run(sql, ...params);
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.inner.get<T>(sql, ...params);
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.inner.all<T>(sql, ...params);
  }

  close(): void {
    this.inner.close();
  }
}

// ---------------------------------------------------------------------------
// T1 — Golden fixture constants
// ---------------------------------------------------------------------------

const FEAT_INVALID_ID = "feat-signoff-inv";
const FEAT_VALID_ID   = "feat-signoff-ok";
const ACTOR           = "ulrich";

// Task ID for the halt sequence (shared across halt tests in declaration order).
const HALT_TASK_ID    = "feat-halt-001/001-s1/task-halt-t1";

// B3 regression — feature halt
const HALT_FEAT_ID      = "feat-halt-feature-001";
const HALT_FEAT_TASK_ID = `${HALT_FEAT_ID}/001-s1/task-halt-feat`;

// B2 regression — non-ENOENT readFile error
const B2_FEAT_ID = "feat-approveReplan-b2";

// ---------------------------------------------------------------------------
// B2/B3 regression — fake injectable logger (captures warn/debug calls)
// ---------------------------------------------------------------------------

class FakeLeafLogger implements LeafLogger {
  warnCalls: Array<{ event: string; fields?: Record<string, unknown> }>;
  debugCalls: Array<{ event: string; fields?: Record<string, unknown> }>;

  constructor() {
    this.warnCalls = [];
    this.debugCalls = [];
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.debugCalls.push({ event, fields });
  }

  info(_event: string, _fields?: Record<string, unknown>): void {}

  warn(event: string, fields?: Record<string, unknown>): void {
    this.warnCalls.push({ event, fields });
  }

  error(_event: string, _fields?: Record<string, unknown>): void {}

  child(_bindings: Record<string, unknown>): LeafLogger {
    return this;
  }
}

// ---------------------------------------------------------------------------
// T1 — Minimal plan file contents
// ---------------------------------------------------------------------------

/** Epic with Acceptance section but NO story dirs → shapeLint: "must have at least one story". */
const INVALID_EPIC_MD = `---
id: ${FEAT_INVALID_ID}
---

## Acceptance

Control feature acceptance.
`;

/** Minimal valid epic (RUNBOOK + story + task will be created alongside). */
const VALID_EPIC_MD = `---
id: ${FEAT_VALID_ID}
repo: ctl-repo
ticket_system: jira
ticket: CTL-0
---

## Acceptance

Control feature complete when task passes TDD gates.
`;

/** Minimal valid task with all required shapeLint sections. */
const TASK_MD = `---
id: task-ctl-t1
workflow: tdd@1
repo: ctl-repo
ticket_system: jira
ticket: CTL-1
---

## Prerequisites

None.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

// ---------------------------------------------------------------------------
// T2 — approveReplan fixture constants
// ---------------------------------------------------------------------------

const RP_FEAT_ID   = "feat-replan-001";
const RP_TASK_A_ID = "task-rp-a";
const RP_TASK_B_ID = "task-rp-b";
const RP_TASK_C_ID = "task-rp-c";
const RP_ACTOR     = "ulrich";

const RP_EPIC_MD = `---
id: ${RP_FEAT_ID}
repo: rp-repo
ticket_system: jira
ticket: RP-0
---

## Acceptance

Replan feature acceptance criteria.
`;

/** Task A — valid; will be edited in the replan. */
const RP_TASK_A_MD = `---
id: ${RP_TASK_A_ID}
workflow: tdd@1
repo: rp-repo
ticket_system: jira
ticket: RP-1
---

## Prerequisites

Initial prerequisites.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

/** Task A v2 — same id, different Prerequisites content; used as the replan edit. */
const RP_TASK_A_MD_V2 = `---
id: ${RP_TASK_A_ID}
workflow: tdd@1
repo: rp-repo
ticket_system: jira
ticket: RP-1
---

## Prerequisites

Updated prerequisites after replan.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

/** Task B v2 — a second edited task, preserving the request edit order. */
const RP_TASK_B_MD_V2 = `---
id: ${RP_TASK_B_ID}
workflow: tdd@1
repo: rp-repo
ticket_system: jira
ticket: RP-2
---

## Prerequisites

Updated prerequisites for task B after replan.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

/**
 * Task A broken — missing required ## Outputs and ## Tests sections.
 * Causes shapeLint to throw during compile, exercising the rollback path.
 */
const RP_TASK_A_MD_BROKEN = `---
id: ${RP_TASK_A_ID}
workflow: tdd@1
repo: rp-repo
ticket_system: jira
ticket: RP-1
---

## Prerequisites

Only prerequisites section.

## Inputs

Nothing.
`;

/** Task B — valid, unedited in all T2 replan tests. */
const RP_TASK_B_MD = `---
id: ${RP_TASK_B_ID}
workflow: tdd@1
repo: rp-repo
ticket_system: jira
ticket: RP-2
---

## Prerequisites

None.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

/** Task C — valid and unedited in the replan response-order test. */
const RP_TASK_C_MD = `---
id: ${RP_TASK_C_ID}
workflow: tdd@1
repo: rp-repo
ticket_system: jira
ticket: RP-3
---

## Prerequisites

None.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

// ---------------------------------------------------------------------------
// T2 — budgetOverride fixture constants
// ---------------------------------------------------------------------------

const OV_TASK_ID = "task-override-t1";
const OV_FEAT_ID = "feat-override-001";
const OV_ACTOR   = "ulrich";
const OV_AMOUNT  = 100;
const OV_REASON  = "need more budget for final sprint";

// ---------------------------------------------------------------------------
// T1 — Module-level fixture state
// ---------------------------------------------------------------------------

let tmpDir: string;
let store: Store;
let invalidFeatureDir: string;
let validFeatureDir: string;

describe("src/rpc/control-verbs.ts", () => {
  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ctl-verbs-"));

    // Open store and initialise all schema (creates control_journal, scheduler_task, etc.).
    store = openStore(join(tmpDir, "test.db"), { busyTimeout: 1000 });
    initSchema(store);

    // Invalid feature dir: has epic.md + RUNBOOK.md, but NO story dirs.
    // crossCheck passes (RUNBOOK present); shapeLint throws "must have at least one story".
    invalidFeatureDir = join(tmpDir, "feat-invalid");
    await mkdir(invalidFeatureDir, { recursive: true });
    await writeFile(join(invalidFeatureDir, "epic.md"), INVALID_EPIC_MD, "utf8");
    await writeFile(join(invalidFeatureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");

    // Valid feature dir: epic.md + RUNBOOK.md + 001-s1/(INDEX.md + 001-task.md).
    validFeatureDir = join(tmpDir, "feat-valid");
    await mkdir(join(validFeatureDir, "001-s1"), { recursive: true });
    await writeFile(join(validFeatureDir, "epic.md"), VALID_EPIC_MD, "utf8");
    await writeFile(join(validFeatureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await writeFile(join(validFeatureDir, "001-s1", "INDEX.md"), "# Story 1\n", "utf8");
    await writeFile(join(validFeatureDir, "001-s1", "001-task.md"), TASK_MD, "utf8");

    // Pre-insert a pending task row for the halt sequence tests.
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, max_attempts) VALUES (?, ?, ?, ?)",
      HALT_TASK_ID, "feat-halt-001", "pending", 3,
    );

    // Pre-insert a task row for the feature-halt (B3) tests.
    store.run(
      "INSERT INTO scheduler_task (node_id, feature_id, status, max_attempts) VALUES (?, ?, ?, ?)",
      HALT_FEAT_TASK_ID, HALT_FEAT_ID, "pending", 3,
    );
  });

  after(async () => {
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // T1 (a) signOffPlan
  // ---------------------------------------------------------------------------

  test("signOffPlan — invalid plan returns verbatim diagnostics", async () => {
    const deps: ControlVerbsDeps = {
      store,
      featureDirFn: (_featureId: string) => invalidFeatureDir,
    };
    const result = await signOffPlan(FEAT_INVALID_ID, ACTOR, deps);
    assert.equal(result.valid, false, "invalid plan must return valid=false");
    assert.ok(result.diagnostics.length > 0, "diagnostics must be non-empty");
    const diagText = result.diagnostics.join(" ");
    assert.ok(
      diagText.includes("story"),
      `expected 'story' in diagnostics; got: "${diagText}"`,
    );
  });

  test("signOffPlan — valid plan stamps generation and journals sign-off with actor", async () => {
    const deps: ControlVerbsDeps = {
      store,
      featureDirFn: (_featureId: string) => validFeatureDir,
    };
    const result = await signOffPlan(FEAT_VALID_ID, ACTOR, deps);
    assert.equal(result.valid, true, "valid plan must return valid=true");
    assert.equal(result.generation, 1, "first compile stamps generation 1");

    // Journal row must exist in control_journal.
    const jRow = store.get<{ action: string; target_id: string; actor: string }>(
      "SELECT action, target_id, actor FROM control_journal WHERE target_id = ? AND action = 'sign_off'",
      FEAT_VALID_ID,
    );
    assert.ok(jRow !== undefined, "control_journal must have a sign_off row for the feature");
    assert.equal(jRow.actor, ACTOR, "journal row must record the actor");
  });

  // ---------------------------------------------------------------------------
  // T1 (b) haltTask — ordered sequence on HALT_TASK_ID
  // ---------------------------------------------------------------------------

  test("haltTask — parks task and journals halt with actor", () => {
    const deps: ControlVerbsDeps = {
      store,
      featureDirFn: (_featureId: string) => "",
    };
    haltTask(HALT_TASK_ID, ACTOR, deps);

    // blocked_on must be set (task is parked — not re-dispatchable).
    const stRow = store.get<{ blocked_on: string | null }>(
      "SELECT blocked_on FROM scheduler_task WHERE node_id = ?",
      HALT_TASK_ID,
    );
    assert.ok(stRow !== undefined, "scheduler_task row must exist after halt");
    assert.notEqual(stRow.blocked_on, null, "blocked_on must be non-null after halt");

    // control_journal must have a halt_task row with the actor.
    const jRow = store.get<{ action: string; actor: string }>(
      "SELECT action, actor FROM control_journal WHERE target_id = ? AND action = 'halt_task'",
      HALT_TASK_ID,
    );
    assert.ok(jRow !== undefined, "control_journal must have a halt_task row");
    assert.equal(jRow.actor, ACTOR, "halt journal row must record the actor");
  });

  test("haltTask — double halt on already-halted task is a typed conflict", () => {
    // HALT_TASK_ID is already halted from the previous test.
    const deps: ControlVerbsDeps = {
      store,
      featureDirFn: (_featureId: string) => "",
    };
    assert.throws(
      () => haltTask(HALT_TASK_ID, ACTOR, deps),
      (err: unknown) => err instanceof HaltConflictError,
      "second halt must throw HaltConflictError",
    );
  });

  test("haltTask — halted task is not returned by pending-unblocked scheduler query", () => {
    // HALT_TASK_ID is already halted; scheduler dispatches only WHERE blocked_on IS NULL.
    const dispatchable = store.all<{ node_id: string }>(
      "SELECT node_id FROM scheduler_task WHERE node_id = ? AND blocked_on IS NULL AND status = 'pending'",
      HALT_TASK_ID,
    );
    assert.equal(
      dispatchable.length,
      0,
      "halted task must not appear in the pending-unblocked scheduler query",
    );
  });

  // ---------------------------------------------------------------------------
  // B3 regression — haltFeature: parks feature through Epic 004 transitions,
  // journaled with actor; second halt is a typed HaltFeatureConflictError.
  // ---------------------------------------------------------------------------

  test("haltFeature — parks feature and journals halt with actor (B3 regression)", () => {
    const deps: ControlVerbsDeps = {
      store,
      featureDirFn: (_featureId: string) => "",
    };
    haltFeature(HALT_FEAT_ID, ACTOR, deps);

    // control_journal must record a halt_feature action for the feature.
    const jRow = store.get<{ action: string; actor: string }>(
      "SELECT action, actor FROM control_journal WHERE target_id = ? AND action = 'halt_feature'",
      HALT_FEAT_ID,
    );
    assert.ok(jRow !== undefined, "control_journal must have a halt_feature row after haltFeature");
    assert.equal(jRow.actor, ACTOR, "halt_feature journal row must record the actor");
  });

  test("haltFeature — second halt on already-halted feature throws HaltFeatureConflictError (B3 regression)", () => {
    // HALT_FEAT_ID was halted in the preceding test.
    const deps: ControlVerbsDeps = {
      store,
      featureDirFn: (_featureId: string) => "",
    };
    assert.throws(
      () => haltFeature(HALT_FEAT_ID, ACTOR, deps),
      (err: unknown) => err instanceof HaltFeatureConflictError,
      "second haltFeature must throw HaltFeatureConflictError",
    );
  });

  // ---------------------------------------------------------------------------
  // T2 (a) approveReplan — nested suite with its own fixture
  // ---------------------------------------------------------------------------

  describe("approveReplan", () => {
    let rpTmpDir: string;
    let rpStore: Store;
    let rpFeatureDir: string;

    before(async () => {
      rpTmpDir = await mkdtemp(join(tmpdir(), "ctl-replan-"));
      rpFeatureDir = join(rpTmpDir, RP_FEAT_ID);

      // Create feature directory structure: three parallel stories with one task each.
      await mkdir(join(rpFeatureDir, "001-s1"), { recursive: true });
      await mkdir(join(rpFeatureDir, "002-s2"), { recursive: true });
      await mkdir(join(rpFeatureDir, "003-s3"), { recursive: true });

      await writeFile(join(rpFeatureDir, "epic.md"), RP_EPIC_MD, "utf8");
      await writeFile(join(rpFeatureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
      await writeFile(join(rpFeatureDir, "001-s1", "INDEX.md"), "# Story 1\n", "utf8");
      await writeFile(join(rpFeatureDir, "001-s1", "001-task-a.md"), RP_TASK_A_MD, "utf8");
      await writeFile(join(rpFeatureDir, "002-s2", "INDEX.md"), "# Story 2\n", "utf8");
      await writeFile(join(rpFeatureDir, "002-s2", "001-task-b.md"), RP_TASK_B_MD, "utf8");
      await writeFile(join(rpFeatureDir, "003-s3", "INDEX.md"), "# Story 3\n", "utf8");
      await writeFile(join(rpFeatureDir, "003-s3", "001-task-c.md"), RP_TASK_C_MD, "utf8");

      // Open store and initialise schema; compile creates plan tables.
      rpStore = openStore(join(rpTmpDir, "test.db"), { busyTimeout: 1000 });
      initSchema(rpStore);

      // Compile to G=1 — creates plan_node, plan_generation, plan_edge rows.
      await compile(rpFeatureDir, rpStore, {});

      // Pre-insert scheduler_task rows for both tasks with exit_gate_passed=1
      // (simulating tasks that have run and passed their exit gate).
      rpStore.run(
        "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed, max_attempts) VALUES (?, ?, ?, ?, ?)",
        RP_TASK_A_ID, RP_FEAT_ID, "pending", 1, 3,
      );
      rpStore.run(
        "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed, max_attempts) VALUES (?, ?, ?, ?, ?)",
        RP_TASK_B_ID, RP_FEAT_ID, "pending", 1, 3,
      );
      rpStore.run(
        "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed, max_attempts) VALUES (?, ?, ?, ?, ?)",
        RP_TASK_C_ID, RP_FEAT_ID, "pending", 1, 3,
      );
    });

    after(async () => {
      rpStore.close();
      await rm(rpTmpDir, { recursive: true, force: true });
    });

    test("approveReplan — applies edit set, mints G+1, and returns edited task ids in edit order", async () => {
      const deps: ControlVerbsDeps = {
        store: rpStore,
        featureDirFn: (_id: string) => rpFeatureDir,
      };
      const diff: ReplanDiff = {
        featureId: RP_FEAT_ID,
        baseGeneration: 1,
        edits: [
          { path: "001-s1/001-task-a.md", newContent: RP_TASK_A_MD_V2 },
          { path: "002-s2/001-task-b.md", newContent: RP_TASK_B_MD_V2 },
        ],
      };

      const result = await approveReplan(diff, RP_ACTOR, deps);
      assert.equal(result.generation, 2, "approveReplan must mint G+1=2");
      assert.deepEqual(
        result.reopenedTaskIds,
        [RP_TASK_A_ID, RP_TASK_B_ID],
        "approveReplan must return only edited task ids in request edit order",
      );

      // plan_generation must have a G=2 row.
      const genRow = rpStore.get<{ max_gen: number }>(
        "SELECT MAX(generation) AS max_gen FROM plan_generation WHERE feature_id = ?",
        RP_FEAT_ID,
      );
      assert.equal(genRow?.max_gen, 2, "plan_generation must record generation 2");

      // Affected task (its file was edited): exit_gate_passed must be reset to 0.
      const affectedRow = rpStore.get<{ exit_gate_passed: number }>(
        "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
        RP_TASK_A_ID,
      );
      assert.ok(affectedRow !== undefined, "scheduler_task row for task-a must exist");
      assert.equal(
        affectedRow.exit_gate_passed,
        0,
        "edited task's exit_gate_passed must be re-opened (reset to 0)",
      );

      // Second affected task (its file was edited): exit gate is also re-opened.
      const secondAffectedRow = rpStore.get<{ exit_gate_passed: number }>(
        "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
        RP_TASK_B_ID,
      );
      assert.ok(secondAffectedRow !== undefined, "scheduler_task row for task-b must exist");
      assert.equal(
        secondAffectedRow.exit_gate_passed,
        0,
        "edited task-b exit_gate_passed must be re-opened (reset to 0)",
      );

      // Unaffected task (parallel story, file not edited): gate stays closed (1).
      const unaffectedRow = rpStore.get<{ exit_gate_passed: number }>(
        "SELECT exit_gate_passed FROM scheduler_task WHERE node_id = ?",
        RP_TASK_C_ID,
      );
      assert.ok(unaffectedRow !== undefined, "scheduler_task row for task-c must exist");
      assert.equal(
        unaffectedRow.exit_gate_passed,
        1,
        "unaffected task's exit_gate_passed must remain closed (1)",
      );
    });

    test("approveReplan — path traversal outside feature dir is rejected as PathViolationError", async () => {
      const deps: ControlVerbsDeps = {
        store: rpStore,
        featureDirFn: (_id: string) => rpFeatureDir,
      };
      // Current G is 2 after the previous test.
      const traversalDiff: ReplanDiff = {
        featureId: RP_FEAT_ID,
        baseGeneration: 2,
        edits: [{ path: "../../../evil.txt", newContent: "malicious content" }],
      };

      await assert.rejects(
        async () => approveReplan(traversalDiff, RP_ACTOR, deps),
        (err: unknown) => err instanceof PathViolationError,
        "traversal path must throw PathViolationError before any disk or DB write",
      );
    });

    test("approveReplan — base-generation mismatch is a typed GenerationConflictError", async () => {
      const deps: ControlVerbsDeps = {
        store: rpStore,
        featureDirFn: (_id: string) => rpFeatureDir,
      };
      // Current G is 2; submitting baseGeneration=99 forces a mismatch.
      const mismatchDiff: ReplanDiff = {
        featureId: RP_FEAT_ID,
        baseGeneration: 99,
        edits: [{ path: "001-s1/001-task-a.md", newContent: RP_TASK_A_MD_V2 }],
      };

      await assert.rejects(
        async () => approveReplan(mismatchDiff, RP_ACTOR, deps),
        (err: unknown) => err instanceof GenerationConflictError,
        "baseGeneration mismatch must throw GenerationConflictError",
      );
    });

    test("approveReplan — failing recompile rolls back to the pre-apply commit", async () => {
      const deps: ControlVerbsDeps = {
        store: rpStore,
        featureDirFn: (_id: string) => rpFeatureDir,
      };
      // Current G is 2; use matching baseGeneration.
      const brokenDiff: ReplanDiff = {
        featureId: RP_FEAT_ID,
        baseGeneration: 2,
        edits: [{ path: "001-s1/001-task-a.md", newContent: RP_TASK_A_MD_BROKEN }],
      };

      // approveReplan must throw (compile fails due to missing required sections).
      await assert.rejects(
        async () => approveReplan(brokenDiff, RP_ACTOR, deps),
        (err: unknown) => err instanceof Error,
        "failing recompile must cause approveReplan to throw",
      );

      // After rollback: generation must stay at 2 (no G=3 row).
      const genRow = rpStore.get<{ max_gen: number }>(
        "SELECT MAX(generation) AS max_gen FROM plan_generation WHERE feature_id = ?",
        RP_FEAT_ID,
      );
      assert.equal(
        genRow?.max_gen,
        2,
        "generation must remain at 2 after a failed recompile (no G=3 row)",
      );

      // After rollback: the file must be restored to its pre-edit content (V2).
      const restoredContent = await readFile(
        join(rpFeatureDir, "001-s1", "001-task-a.md"),
        "utf8",
      );
      assert.ok(
        restoredContent.includes("Updated prerequisites after replan"),
        "task-a.md must be restored to its V2 content after rollback; got: " +
          restoredContent.slice(0, 200),
      );
    });

    // -----------------------------------------------------------------------
    // B6 regression — symlink inside featureDir must be rejected typed.
    // Current G after all preceding approveReplan tests = 2.
    // -----------------------------------------------------------------------

    test("approveReplan — symlink inside featureDir is rejected as PathViolationError (B6 regression)", async () => {
      const deps: ControlVerbsDeps = {
        store: rpStore,
        featureDirFn: (_id: string) => rpFeatureDir,
      };

      // Create a symlink inside rpFeatureDir that points outside it.
      const symlinkPath = join(rpFeatureDir, "symlink-plan.md");
      await symlink("/tmp", symlinkPath);

      const symlinkDiff: ReplanDiff = {
        featureId: RP_FEAT_ID,
        baseGeneration: 2,
        edits: [{ path: "symlink-plan.md", newContent: "malicious overwrite" }],
      };

      try {
        await assert.rejects(
          async () => approveReplan(symlinkDiff, RP_ACTOR, deps),
          (err: unknown) => err instanceof PathViolationError,
          "a symlink inside featureDir must be rejected with PathViolationError before any write",
        );
      } finally {
        await rm(symlinkPath, { force: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // B2 regression — approveReplan non-ENOENT readFile error must be logged
  // and re-thrown, not silently swallowed.
  // ---------------------------------------------------------------------------

  describe("approveReplan — non-ENOENT readFile error handling (B2 regression)", () => {
    let b2TmpDir: string;
    let b2Store: Store;
    let b2FeatureDir: string;

    before(async () => {
      b2TmpDir = await mkdtemp(join(tmpdir(), "ctl-b2-replan-"));
      b2FeatureDir = join(b2TmpDir, B2_FEAT_ID);
      await mkdir(b2FeatureDir, { recursive: true });

      b2Store = openStore(join(b2TmpDir, "test.db"), { busyTimeout: 1000 });
      initSchema(b2Store);
      applyCompiledPlanMigration(b2Store);

      // Seed plan_generation so the generation-check in approveReplan passes.
      b2Store.run(
        "INSERT INTO plan_generation (generation, compile_hash, feature_id, at) VALUES (?, ?, ?, ?)",
        1, "hash-b2", B2_FEAT_ID, new Date().toISOString(),
      );

      // Create a directory named "epic.md" at the edit path — this path passes
      // the B7 allowlist (root-level epic.md is allowed) AND causes readFile to
      // throw EISDIR (code ≠ 'ENOENT'), which must be logged + re-thrown.
      await mkdir(join(b2FeatureDir, "epic.md"), { recursive: true });
    });

    after(async () => {
      b2Store.close();
      await rm(b2TmpDir, { recursive: true, force: true });
    });

    test("approveReplan — non-ENOENT readFile error is logged and re-thrown (not silently swallowed)", async () => {
      const fakeLogger = new FakeLeafLogger();
      // Wider object satisfies ControlVerbsDeps (structural typing); the SE will
      // add logger?: LeafLogger to ControlVerbsDeps and use it in the readFile catch.
      const deps = {
        store: b2Store,
        featureDirFn: (): string => b2FeatureDir,
        logger: fakeLogger,
      };

      const diff: ReplanDiff = {
        featureId: B2_FEAT_ID,
        baseGeneration: 1,
        edits: [{ path: "epic.md", newContent: "content" }],
      };

      // approveReplan must throw (readFile EISDIR → logged+rethrown in fixed code).
      await assert.rejects(
        async () => approveReplan(diff, "ulrich", deps),
        (err: unknown) => err instanceof Error,
        "approveReplan must throw when readFile fails with a non-ENOENT error",
      );

      // The non-ENOENT error from readFile must have been logged.
      // Broken code: readFile EISDIR is caught silently → 0 logger calls.
      // Fixed code:  readFile EISDIR is logged then re-thrown → ≥1 logger calls.
      const loggedCalls = [...fakeLogger.warnCalls, ...fakeLogger.debugCalls];
      assert.ok(
        loggedCalls.length > 0,
        "non-ENOENT readFile error must be logged via deps.logger (not silently swallowed)",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T2 (b) budgetOverride — nested suite with its own fixture
  // ---------------------------------------------------------------------------

  describe("budgetOverride", () => {
    let ovTmpDir: string;
    let ovStore: Store;

    before(async () => {
      ovTmpDir = await mkdtemp(join(tmpdir(), "ctl-override-"));
      ovStore = openStore(join(ovTmpDir, "test.db"), { busyTimeout: 1000 });
      initSchema(ovStore);
      // No pre-seeding needed: budgetOverride handles absent budget_ledger rows.
    });

    after(async () => {
      ovStore.close();
      await rm(ovTmpDir, { recursive: true, force: true });
    });

    test("budgetOverride — rejected when rate limit reached", async () => {
      const deps: BudgetOverrideDeps = {
        store: ovStore,
        overrideRateLimitFn: (_taskId: string) => ({ allowed: false }),
        overrideDayCapFn: (_taskId: string) => ({ allowed: true }),
        nowMs: Date.now(),
      };
      await assert.rejects(
        async () =>
          budgetOverride(
            { taskId: OV_TASK_ID, featureId: OV_FEAT_ID, amount: OV_AMOUNT, reason: OV_REASON, actor: OV_ACTOR },
            deps,
          ),
        (err: unknown) => err instanceof OverrideRateLimitError,
        "rate limit exceeded must throw OverrideRateLimitError",
      );
    });

    test("budgetOverride — rejected when per-day cap reached", async () => {
      const deps: BudgetOverrideDeps = {
        store: ovStore,
        overrideRateLimitFn: (_taskId: string) => ({ allowed: true }),
        overrideDayCapFn: (_taskId: string) => ({ allowed: false }),
        nowMs: Date.now(),
      };
      await assert.rejects(
        async () =>
          budgetOverride(
            { taskId: OV_TASK_ID, featureId: OV_FEAT_ID, amount: OV_AMOUNT, reason: OV_REASON, actor: OV_ACTOR },
            deps,
          ),
        (err: unknown) => err instanceof OverrideDayCapError,
        "per-day cap exceeded must throw OverrideDayCapError",
      );
    });

    test("budgetOverride — accepted override annotates ledger and emits interaction event", async () => {
      const deps: BudgetOverrideDeps = {
        store: ovStore,
        overrideRateLimitFn: (_taskId: string) => ({ allowed: true }),
        overrideDayCapFn: (_taskId: string) => ({ allowed: true }),
        nowMs: Date.now(),
      };
      const result = await budgetOverride(
        { taskId: OV_TASK_ID, featureId: OV_FEAT_ID, amount: OV_AMOUNT, reason: OV_REASON, actor: OV_ACTOR },
        deps,
      );
      assert.equal(result.applied, true, "accepted override must return { applied: true }");

      // Ledger annotation: budget_ledger must have a row with an override entry.
      const ledgerRow = ovStore.get<{ ledger: string }>(
        "SELECT ledger FROM budget_ledger WHERE task_id = ?",
        OV_TASK_ID,
      );
      assert.ok(ledgerRow !== undefined, "budget_ledger must have a row for the override task");
      const entries = JSON.parse(ledgerRow.ledger) as Array<{
        kind: string;
        amount?: number;
        reason?: string;
        actor?: string;
      }>;
      const overrideEntry = entries.find((e) => e.kind === "override");
      assert.ok(overrideEntry !== undefined, "ledger must contain an { kind: 'override' } entry");
      assert.equal(overrideEntry["amount"], OV_AMOUNT, "override entry must record the amount");
      assert.equal(overrideEntry["reason"], OV_REASON, "override entry must record the reason");
      assert.equal(overrideEntry["actor"], OV_ACTOR, "override entry must record the actor");

      // Interaction event: interaction_outbox must have an event recording actor/amount/reason.
      const allOutbox = ovStore.all<{ event_json: string }>(
        "SELECT event_json FROM interaction_outbox",
      );
      assert.equal(
        allOutbox.length,
        1,
        "exactly one interaction event must be in interaction_outbox after the override",
      );
      const evtRaw = allOutbox[0];
      assert.ok(evtRaw !== undefined, "outbox row must be present");
      const evt = JSON.parse(evtRaw.event_json) as Record<string, unknown>;
      assert.equal(evt["actor"], OV_ACTOR, "interaction event must record the actor");
      assert.equal(evt["amount"], OV_AMOUNT, "interaction event must record the amount");
      assert.equal(evt["reason"], OV_REASON, "interaction event must record the reason");
    });

    test("budgetOverride — second override on same task is rejected one-shot", async () => {
      // OV_TASK_ID already has an override from the preceding test.
      const deps: BudgetOverrideDeps = {
        store: ovStore,
        overrideRateLimitFn: (_taskId: string) => ({ allowed: true }),
        overrideDayCapFn: (_taskId: string) => ({ allowed: true }),
        nowMs: Date.now(),
      };
      await assert.rejects(
        async () =>
          budgetOverride(
            { taskId: OV_TASK_ID, featureId: OV_FEAT_ID, amount: 200, reason: "second attempt", actor: OV_ACTOR },
            deps,
          ),
        (err: unknown) => err instanceof OverrideAlreadyAppliedError,
        "second override on same task must throw OverrideAlreadyAppliedError (one-shot enforcement)",
      );
    });

    // -----------------------------------------------------------------------
    // S1 regression — budgetOverride must use injected nowMs for recorded_at.
    // Currently nowMs is declared in BudgetOverrideDeps but unused; the
    // interaction event has no recorded_at field. After fix: event_json carries
    // recorded_at equal to deps.nowMs.
    // -----------------------------------------------------------------------

    test("budgetOverride — recorded_at in interaction event equals injected nowMs (S1 regression)", async () => {
      const FIXED_NOW_MS = 1640000000000; // deterministic, well below Date.now()
      const S1_TASK_ID = "task-override-s1-nowms";
      const deps: BudgetOverrideDeps = {
        store: ovStore,
        overrideRateLimitFn: () => ({ allowed: true }),
        overrideDayCapFn: () => ({ allowed: true }),
        nowMs: FIXED_NOW_MS,
      };
      await budgetOverride(
        { taskId: S1_TASK_ID, featureId: OV_FEAT_ID, amount: 50, reason: "nowMs wire test", actor: OV_ACTOR },
        deps,
      );

      // The interaction event must carry recorded_at = injected nowMs, not Date.now().
      const rows = ovStore.all<{ event_json: string }>(
        "SELECT event_json FROM interaction_outbox WHERE event_json LIKE ?",
        `%${S1_TASK_ID}%`,
      );
      assert.equal(rows.length, 1, "exactly one outbox row for the S1 task");
      const row = rows[0];
      assert.ok(row !== undefined, "outbox row must be defined");
      const evt = JSON.parse(row.event_json) as Record<string, unknown>;
      assert.equal(
        evt["recorded_at"],
        FIXED_NOW_MS,
        `interaction event recorded_at must equal injected nowMs (${FIXED_NOW_MS}), not Date.now()`,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // B7 regression — approveReplan path allowlist: only covered plan files
  // (epic.md, INDEX.md, story task files) are accepted; RUNBOOK.md, *.state.md,
  // *.journal.jsonl, and unknown root-level files are rejected with PathViolationError.
  // Uses a null store (nullStore.get returns undefined → baseGeneration=0 matches liveGen=0)
  // so rejected paths throw PathViolationError before any DB or disk write.
  // ---------------------------------------------------------------------------

  describe("approveReplan — B7 allowlist (covered plan files only)", () => {
    let b7TmpDir: string;
    const nullStore: Store = {
      get<T>(): T | undefined { return undefined; },
      run(): void {},
      all<T>(): T[] { return []; },
      close(): void {},
    };

    before(async () => {
      b7TmpDir = await mkdtemp(join(tmpdir(), "ctl-b7-"));
      // Create the 001-s1 subdir so story-level paths can be resolved
      await mkdir(join(b7TmpDir, "001-s1"), { recursive: true });
    });

    after(async () => {
      await rm(b7TmpDir, { recursive: true, force: true });
    });

    const makeDeps = (featureDir: string): ControlVerbsDeps => ({
      store: nullStore,
      featureDirFn: () => featureDir,
    });

    test("approveReplan — RUNBOOK.md at feature root is rejected as PathViolationError (B7 allowlist)", async () => {
      await assert.rejects(
        async () => approveReplan(
          { featureId: "feat-b7", baseGeneration: 0, edits: [{ path: "RUNBOOK.md", newContent: "# Runbook\n" }] },
          "ulrich",
          makeDeps(b7TmpDir),
        ),
        (err: unknown) => err instanceof PathViolationError,
        "RUNBOOK.md must be rejected by B7 allowlist with PathViolationError",
      );
    });

    test("approveReplan — *.state.md inside a story dir is rejected as PathViolationError (B7 allowlist)", async () => {
      await assert.rejects(
        async () => approveReplan(
          { featureId: "feat-b7", baseGeneration: 0, edits: [{ path: "001-s1/task-a.state.md", newContent: "" }] },
          "ulrich",
          makeDeps(b7TmpDir),
        ),
        (err: unknown) => err instanceof PathViolationError,
        "*.state.md must be rejected by B7 allowlist with PathViolationError",
      );
    });

    test("approveReplan — unknown file at feature root is rejected as PathViolationError (B7 allowlist)", async () => {
      await assert.rejects(
        async () => approveReplan(
          { featureId: "feat-b7", baseGeneration: 0, edits: [{ path: "NOTES.md", newContent: "notes" }] },
          "ulrich",
          makeDeps(b7TmpDir),
        ),
        (err: unknown) => err instanceof PathViolationError,
        "unknown root-level file must be rejected by B7 allowlist with PathViolationError",
      );
    });

    test("approveReplan — epic.md, INDEX.md, and story task file are NOT rejected by B7 allowlist", async () => {
      // These paths are in the covered set; approveReplan may fail for other reasons
      // (disk/compile) but must NOT throw PathViolationError.
      for (const path of ["epic.md", "INDEX.md", "001-s1/001-task.md"]) {
        let caughtErr: unknown = undefined;
        try {
          await approveReplan(
            { featureId: "feat-b7", baseGeneration: 0, edits: [{ path, newContent: "content" }] },
            "ulrich",
            makeDeps(b7TmpDir),
          );
        } catch (err) {
          caughtErr = err;
        }
        assert.ok(
          !(caughtErr instanceof PathViolationError),
          `path "${path}" must NOT throw PathViolationError; got: ${String(caughtErr)}`,
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // B5/S2 regression — approveReplan wraps compile in a SQLite SAVEPOINT so
  // that a post-DELETE store failure rolls back ALL plan tables atomically.
  // Uses PostDeleteInjectingStore to inject a failure after DELETE FROM plan_node
  // but before INSERT INTO plan_node (the transition from step 7 to step 9 in
  // compile.ts). Without B5 SAVEPOINT the plan rows stay deleted; with it they
  // are fully restored by ROLLBACK TO.
  // ---------------------------------------------------------------------------

  describe("approveReplan — B5/S2 post-DELETE store failure rolls back plan rows", () => {
    let s2TmpDir: string;
    let s2Store: Store;
    let s2FeatureDir: string;
    const S2_FEAT_ID_LOCAL = "feat-s2-rollback-001";

    const S2_EPIC = `---
id: ${S2_FEAT_ID_LOCAL}
repo: s2-repo
ticket_system: jira
ticket: S2-0
---

## Acceptance

S2 rollback regression test feature.
`;

    const S2_TASK = `---
id: task-s2-a
workflow: tdd@1
repo: s2-repo
ticket_system: jira
ticket: S2-1
---

## Prerequisites

Initial prerequisites.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

    const S2_TASK_V2 = S2_TASK.replace("Initial prerequisites.", "Updated prerequisites (v2).");

    before(async () => {
      s2TmpDir = await mkdtemp(join(tmpdir(), "ctl-s2-"));
      s2FeatureDir = join(s2TmpDir, S2_FEAT_ID_LOCAL);
      await mkdir(join(s2FeatureDir, "001-s1"), { recursive: true });
      await writeFile(join(s2FeatureDir, "epic.md"), S2_EPIC, "utf8");
      await writeFile(join(s2FeatureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
      await writeFile(join(s2FeatureDir, "001-s1", "INDEX.md"), "# Story\n", "utf8");
      await writeFile(join(s2FeatureDir, "001-s1", "001-task.md"), S2_TASK, "utf8");
      s2Store = openStore(join(s2TmpDir, "test.db"), { busyTimeout: 1000 });
      initSchema(s2Store);
      // Compile to G=1 with the real store (no injection yet) — creates plan_node, plan_edge, plan_gate rows
      await compile(s2FeatureDir, s2Store, {});
    });

    after(async () => {
      s2Store.close();
      await rm(s2TmpDir, { recursive: true, force: true });
    });

    test("approveReplan — post-DELETE store failure rolls back plan_node, plan_edge, plan_gate, plan_artifact, plan_generation (S2 regression)", async () => {
      // Count pre-apply rows from the G=1 compile
      const cnt = (q: string) => s2Store.get<{ c: number }>(q)?.c ?? 0;
      const beforeNodeCount = cnt("SELECT count(*) AS c FROM plan_node");
      const beforeEdgeCount = cnt("SELECT count(*) AS c FROM plan_edge");
      const beforeGateCount = cnt("SELECT count(*) AS c FROM plan_gate");
      const beforeArtCount  = cnt("SELECT count(*) AS c FROM plan_artifact");
      const beforeGenCount  = cnt("SELECT count(*) AS c FROM plan_generation");

      assert.ok(beforeNodeCount > 0, "pre-apply: plan_node must have rows after G=1 compile");

      // Wrap the real store with the injecting proxy; wrap ONLY for compile's calls
      // (approveReplan also calls store.run for SAVEPOINT/ROLLBACK — these pass through)
      const injectingStore = new PostDeleteInjectingStore(s2Store);
      const deps: ControlVerbsDeps = {
        store: injectingStore,
        featureDirFn: () => s2FeatureDir,
      };
      const diff: ReplanDiff = {
        featureId: S2_FEAT_ID_LOCAL,
        baseGeneration: 1,
        edits: [{ path: "001-s1/001-task.md", newContent: S2_TASK_V2 }],
      };

      // approveReplan must throw (injected failure after DELETE FROM plan_node)
      await assert.rejects(
        async () => approveReplan(diff, "ulrich", deps),
        (err: unknown) => err instanceof Error,
        "approveReplan must throw due to injected post-DELETE store failure",
      );

      // CRITICAL: all plan rows must be UNCHANGED.
      // Without B5 SAVEPOINT: plan_node was deleted and not restored → assertion fails.
      // With B5 SAVEPOINT: ROLLBACK TO restores all deleted rows → assertion passes.
      const afterNodeCount = cnt("SELECT count(*) AS c FROM plan_node");
      const afterEdgeCount = cnt("SELECT count(*) AS c FROM plan_edge");
      const afterGateCount = cnt("SELECT count(*) AS c FROM plan_gate");
      const afterArtCount  = cnt("SELECT count(*) AS c FROM plan_artifact");
      const afterGenCount  = cnt("SELECT count(*) AS c FROM plan_generation");

      assert.equal(afterNodeCount, beforeNodeCount, "plan_node rows must be unchanged after failed approveReplan (B5 SAVEPOINT rollback)");
      assert.equal(afterEdgeCount, beforeEdgeCount, "plan_edge rows must be unchanged after failed approveReplan");
      assert.equal(afterGateCount, beforeGateCount, "plan_gate rows must be unchanged after failed approveReplan");
      assert.equal(afterArtCount,  beforeArtCount,  "plan_artifact rows must be unchanged after failed approveReplan");
      assert.equal(afterGenCount,  beforeGenCount,  "plan_generation rows must be unchanged after failed approveReplan");
    });
  });

  // ---------------------------------------------------------------------------
  // S4 regression — approveReplan new-file tracking:
  //   (a) Newly-created files are UNLINKed on rollback (not written with empty "").
  //   (b) Duplicate resolved edit targets are rejected with DuplicateEditTargetError.
  // ---------------------------------------------------------------------------

  describe("approveReplan — S4 new-file unlink on rollback + duplicate target rejection", () => {
    let s4TmpDir: string;
    let s4Store: Store;
    let s4FeatureDir: string;
    const S4_FEAT_ID_LOCAL = "feat-s4-newfile-001";

    const S4_EPIC = `---
id: ${S4_FEAT_ID_LOCAL}
repo: s4-repo
ticket_system: jira
ticket: S4-0
---

## Acceptance

S4 newfile rollback regression.
`;

    const S4_TASK = `---
id: task-s4-t1
workflow: tdd@1
repo: s4-repo
ticket_system: jira
ticket: S4-1
---

## Prerequisites

None.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

    // Broken task — missing Inputs/Outputs/Tests sections → shapeLint throws
    const S4_NEW_TASK_BROKEN = `---
id: task-s4-new
workflow: tdd@1
repo: s4-repo
ticket_system: jira
ticket: S4-99
---

## Prerequisites

Only prerequisites section — shapeLint will reject this.
`;

    before(async () => {
      s4TmpDir = await mkdtemp(join(tmpdir(), "ctl-s4-"));
      s4FeatureDir = join(s4TmpDir, S4_FEAT_ID_LOCAL);
      await mkdir(join(s4FeatureDir, "001-s1"), { recursive: true });
      await writeFile(join(s4FeatureDir, "epic.md"), S4_EPIC, "utf8");
      await writeFile(join(s4FeatureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
      await writeFile(join(s4FeatureDir, "001-s1", "INDEX.md"), "# Story\n", "utf8");
      await writeFile(join(s4FeatureDir, "001-s1", "001-task.md"), S4_TASK, "utf8");
      s4Store = openStore(join(s4TmpDir, "test.db"), { busyTimeout: 1000 });
      initSchema(s4Store);
      await compile(s4FeatureDir, s4Store, {});
    });

    after(async () => {
      s4Store.close();
      await rm(s4TmpDir, { recursive: true, force: true });
    });

    test("approveReplan — newly-created file is UNLINKED (not written empty) on rollback (S4a regression)", async () => {
      const newFilePath = join(s4FeatureDir, "001-s1", "002-new-task.md");

      // Assert the new file does not exist before the test
      let preExisted = false;
      try {
        await readFile(newFilePath, "utf8");
        preExisted = true;
      } catch { /* ENOENT expected */ }
      assert.ok(!preExisted, "new file must not exist before the test");

      const deps: ControlVerbsDeps = {
        store: s4Store,
        featureDirFn: () => s4FeatureDir,
      };
      const diff: ReplanDiff = {
        featureId: S4_FEAT_ID_LOCAL,
        baseGeneration: 1,
        edits: [{ path: "001-s1/002-new-task.md", newContent: S4_NEW_TASK_BROKEN }],
      };

      // approveReplan must throw — compile rejects the broken new task at shapeLint
      await assert.rejects(
        async () => approveReplan(diff, "ulrich", deps),
        (err: unknown) => err instanceof Error,
        "approveReplan must throw when compile fails on a broken new-file edit",
      );

      // CRITICAL: after rollback the new file must NOT exist on disk.
      // Current (broken) code: restores new file as writeFile(path, "") → file EXISTS.
      // Fixed code: tracks new paths in a Set, unlinks them on rollback → file ABSENT.
      let postExists = false;
      try {
        await readFile(newFilePath, "utf8");
        postExists = true;
      } catch { /* ENOENT expected after fix */ }
      assert.ok(
        !postExists,
        "newly-created file must be UNLINKED on rollback (not left as empty stub)",
      );
    });

    test("approveReplan — duplicate resolved edit targets are rejected as DuplicateEditTargetError (S4b regression)", async () => {
      const deps: ControlVerbsDeps = {
        store: s4Store,
        featureDirFn: () => s4FeatureDir,
      };
      // Both edits resolve to the same absolute path
      const diff: ReplanDiff = {
        featureId: S4_FEAT_ID_LOCAL,
        baseGeneration: 1,
        edits: [
          { path: "001-s1/001-task.md", newContent: S4_TASK },
          { path: "001-s1/001-task.md", newContent: "duplicate edit — same resolved path" },
        ],
      };

      await assert.rejects(
        async () => approveReplan(diff, "ulrich", deps),
        (err: unknown) => err instanceof DuplicateEditTargetError,
        "duplicate resolved edit targets must throw DuplicateEditTargetError before any disk or DB write",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // RB1 regression — approveReplan introduced two empty catch blocks (B5 fix):
  //   1. ROLLBACK TO replan_apply / RELEASE catch (~L376)
  //   2. Per-file unlink/writeFile disk-restore catch (~L392)
  // Both swallow errors silently — AGENTS.md never-swallow violation.
  // Fix: bind the error and call deps.logger?.warn before continuing.
  // Test: inject a store whose ROLLBACK TO throws during the compile-failure path
  //       and assert deps.logger?.warn was called (not silently swallowed).
  // ---------------------------------------------------------------------------

  describe("approveReplan — RB1 rollback-cleanup error must be logged, not swallowed", () => {
    let rb1TmpDir: string;
    let rb1Store: Store;
    let rb1FeatureDir: string;
    const RB1_FEAT_ID_LOCAL = "feat-rb1-cleanup-001";

    const RB1_EPIC = `---
id: ${RB1_FEAT_ID_LOCAL}
repo: rb1-repo
ticket_system: jira
ticket: RB1-0
---

## Acceptance

RB1 rollback-cleanup regression.
`;

    const RB1_TASK = `---
id: task-rb1-t1
workflow: tdd@1
repo: rb1-repo
ticket_system: jira
ticket: RB1-1
---

## Prerequisites

None.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

    const RB1_TASK_V2 = RB1_TASK.replace("None.", "Updated prerequisites (rb1 v2).");

    before(async () => {
      rb1TmpDir = await mkdtemp(join(tmpdir(), "ctl-rb1-"));
      rb1FeatureDir = join(rb1TmpDir, RB1_FEAT_ID_LOCAL);
      await mkdir(join(rb1FeatureDir, "001-s1"), { recursive: true });
      await writeFile(join(rb1FeatureDir, "epic.md"), RB1_EPIC, "utf8");
      await writeFile(join(rb1FeatureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
      await writeFile(join(rb1FeatureDir, "001-s1", "INDEX.md"), "# Story\n", "utf8");
      await writeFile(join(rb1FeatureDir, "001-s1", "001-task.md"), RB1_TASK, "utf8");
      rb1Store = openStore(join(rb1TmpDir, "test.db"), { busyTimeout: 1000 });
      initSchema(rb1Store);
      // Compile to G=1 — creates plan rows that prove the feature is valid.
      await compile(rb1FeatureDir, rb1Store, {});
    });

    after(async () => {
      rb1Store.close();
      await rm(rb1TmpDir, { recursive: true, force: true });
    });

    test("approveReplan — ROLLBACK TO cleanup failure is logged via deps.logger.warn, not silently swallowed (RB1 regression)", async () => {
      // Store wrapper:
      //   - Forwards SAVEPOINT and DELETE FROM plan_node (with deleteSeen flag set).
      //   - Throws on INSERT INTO plan_node (to trigger approveReplan's outer catch).
      //   - Throws on ROLLBACK TO (to exercise the inner empty-catch block).
      //   - Forwards all other SQL to the inner store.
      class RollbackCleanupThrowingStore {
        inner: Store;
        deleteSeen: boolean;

        constructor(inner: Store) {
          this.inner = inner;
          this.deleteSeen = false;
        }

        run(sql: string, ...params: unknown[]): void {
          const upper = sql.trimStart().toUpperCase();
          if (upper.startsWith("DELETE FROM PLAN_NODE")) {
            this.deleteSeen = true;
            this.inner.run(sql, ...params);
            return;
          }
          if (this.deleteSeen && upper.startsWith("INSERT INTO PLAN_NODE ")) {
            throw new Error("INJECTED: post-delete plan_node insert failure (rb1)");
          }
          if (upper.startsWith("ROLLBACK TO")) {
            throw new Error("INJECTED: ROLLBACK TO replan_apply failed (rb1)");
          }
          this.inner.run(sql, ...params);
        }

        get<T>(sql: string, ...params: unknown[]): T | undefined {
          return this.inner.get<T>(sql, ...params);
        }

        all<T>(sql: string, ...params: unknown[]): T[] {
          return this.inner.all<T>(sql, ...params);
        }

        close(): void {
          // rb1Store is closed in after() — do not double-close.
        }
      }

      const fakeLogger = new FakeLeafLogger();
      const rollbackThrowingStore = new RollbackCleanupThrowingStore(rb1Store);
      const deps = {
        store: rollbackThrowingStore,
        featureDirFn: () => rb1FeatureDir,
        logger: fakeLogger,
      };
      const diff: ReplanDiff = {
        featureId: RB1_FEAT_ID_LOCAL,
        baseGeneration: 1,
        edits: [{ path: "001-s1/001-task.md", newContent: RB1_TASK_V2 }],
      };

      // approveReplan must still throw (original INSERT error re-thrown even when ROLLBACK also fails).
      await assert.rejects(
        async () => approveReplan(diff, "ulrich", deps),
        (err: unknown) => err instanceof Error,
        "approveReplan must throw even when ROLLBACK TO cleanup also fails",
      );

      // ROLLBACK TO cleanup failure must be logged via deps.logger?.warn.
      // Broken code (empty catch {}): fakeLogger.warnCalls stays empty → assertion FAILS.
      // Fixed code (bind error + warn):  ≥1 warnCall recorded → assertion PASSES.
      assert.ok(
        fakeLogger.warnCalls.length > 0,
        "ROLLBACK TO cleanup error must be logged via deps.logger?.warn (not silently swallowed); " +
          `got warnCalls: ${JSON.stringify(fakeLogger.warnCalls)}`,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent serialization regression (deferred follow-up)
  //
  // approveReplan's critical section (read liveGen → validate → apply edits →
  // compile → stamp new gen) is NOT protected by an async mutex in the current
  // code. The comment at line ~358-362 in control-verbs.ts acknowledges this
  // and defers serializing concurrent approvals as a follow-up.
  //
  // Race mechanism (Node.js cooperative multitasking):
  //   Both calls start concurrently via Promise.allSettled. Each hits
  //   `await lstat(...)` inside the path-validation loop before reaching the
  //   liveGen check (store.get is synchronous, no yield). Because both lstat
  //   requests are queued to libuv in the same tick, both calls suspend before
  //   either advances past its lstat. When each lstat resolves the call resumes,
  //   runs the synchronous liveGen check, and immediately suspends again at
  //   `await readFile(...)`. By this point BOTH have read liveGen=N (=1) and
  //   PASSED the generation check — before either has called compile() or
  //   stamped a new generation. Both therefore proceed to compile and attempt to
  //   write gen N+1 (or N+2) to the store.
  //
  // Expected serialized behavior (post-fix):
  //   A per-feature async mutex wraps the read-liveGen→compile→stamp→journal
  //   critical section. Whichever call acquires the lock first succeeds
  //   (gen→N+1); the second call enters the lock, reads liveGen=N+1 ≠ N, and
  //   throws GenerationConflictError. Final MAX(generation) = N+1 = 2.
  //
  // Current (unserialized) behavior:
  //   Both calls pass the liveGen check, both compile, both stamp. The
  //   SAVEPOINT same-name nesting means A's RELEASE releases B's savepoint and
  //   vice-versa (both still succeed). Final MAX(generation) > 2 (or =2 when
  //   compile's hash-equality early-return fires for the second call, in which
  //   case both calls STILL return fulfilled — the GenerationConflictError is
  //   never thrown). Either way the assertions below fail. That is the RED.
  // ---------------------------------------------------------------------------

  describe("approveReplan — concurrent serialization (deferred follow-up)", () => {
    let concTmpDir: string;
    let concStore: Store;
    let concFeatureDir: string;

    const CONC_FEAT_ID   = "feat-replan-conc";
    const CONC_TASK_A_ID = "task-conc-a";
    const CONC_TASK_B_ID = "task-conc-b";

    const CONC_EPIC_MD = `---
id: ${CONC_FEAT_ID}
repo: conc-repo
ticket_system: jira
ticket: CONC-0
---

## Acceptance

Concurrent replan serialization feature.
`;

    const CONC_TASK_A_MD = `---
id: ${CONC_TASK_A_ID}
workflow: tdd@1
repo: conc-repo
ticket_system: jira
ticket: CONC-1
---

## Prerequisites

Initial prerequisites before concurrent replan.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

    const CONC_TASK_A_MD_V2 = `---
id: ${CONC_TASK_A_ID}
workflow: tdd@1
repo: conc-repo
ticket_system: jira
ticket: CONC-1
---

## Prerequisites

Updated prerequisites after concurrent replan.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

    const CONC_TASK_B_MD = `---
id: ${CONC_TASK_B_ID}
workflow: tdd@1
repo: conc-repo
ticket_system: jira
ticket: CONC-2
---

## Prerequisites

None.

## Inputs

Nothing.

## Outputs

Nothing.

## Tests

Unit tests.
`;

    before(async () => {
      concTmpDir = await mkdtemp(join(tmpdir(), "ctl-conc-replan-"));
      concFeatureDir = join(concTmpDir, CONC_FEAT_ID);

      await mkdir(join(concFeatureDir, "001-s1"), { recursive: true });
      await mkdir(join(concFeatureDir, "002-s2"), { recursive: true });
      await writeFile(join(concFeatureDir, "epic.md"), CONC_EPIC_MD, "utf8");
      await writeFile(join(concFeatureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
      await writeFile(join(concFeatureDir, "001-s1", "INDEX.md"), "# Story 1\n", "utf8");
      await writeFile(join(concFeatureDir, "001-s1", "001-task-a.md"), CONC_TASK_A_MD, "utf8");
      await writeFile(join(concFeatureDir, "002-s2", "INDEX.md"), "# Story 2\n", "utf8");
      await writeFile(join(concFeatureDir, "002-s2", "001-task-b.md"), CONC_TASK_B_MD, "utf8");

      concStore = openStore(join(concTmpDir, "test.db"), { busyTimeout: 1000 });
      initSchema(concStore);

      // Compile to G=1 — creates plan_node, plan_generation, plan_edge rows.
      await compile(concFeatureDir, concStore, {});

      // Pre-insert scheduler_task rows (simulating tasks that have run and passed
      // their exit gate, so re-opening the gate on replan is observable).
      concStore.run(
        "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed, max_attempts) VALUES (?, ?, ?, ?, ?)",
        CONC_TASK_A_ID, CONC_FEAT_ID, "pending", 1, 3,
      );
      concStore.run(
        "INSERT INTO scheduler_task (node_id, feature_id, status, exit_gate_passed, max_attempts) VALUES (?, ?, ?, ?, ?)",
        CONC_TASK_B_ID, CONC_FEAT_ID, "pending", 1, 3,
      );
    });

    after(async () => {
      concStore.close();
      await rm(concTmpDir, { recursive: true, force: true });
    });

    test(
      "approveReplan — concurrent calls for same feature are serialized: exactly one succeeds, the other throws GenerationConflictError",
      async () => {
        const deps: ControlVerbsDeps = {
          store: concStore,
          featureDirFn: (_id: string) => concFeatureDir,
        };
        // Both calls are submitted at baseGeneration=1 concurrently — each sees
        // the same live generation before either can commit a new generation.
        const diff: ReplanDiff = {
          featureId: CONC_FEAT_ID,
          baseGeneration: 1,
          edits: [{ path: "001-s1/001-task-a.md", newContent: CONC_TASK_A_MD_V2 }],
        };

        const [resultA, resultB] = await Promise.allSettled([
          approveReplan(diff, "actor-a", deps),
          approveReplan(diff, "actor-b", deps),
        ]);

        const fulfilled = [resultA, resultB].filter((r) => r.status === "fulfilled");
        const rejected  = [resultA, resultB].filter((r) => r.status === "rejected");

        // Serialized behavior: exactly one call must succeed.
        assert.equal(
          fulfilled.length,
          1,
          `serialized approveReplan: expected exactly 1 fulfilled result; got ${fulfilled.length} ` +
            "(both succeeded — the race was not serialized; the second call must have " +
            "thrown GenerationConflictError after acquiring the per-feature lock)",
        );
        assert.equal(
          rejected.length,
          1,
          `serialized approveReplan: expected exactly 1 rejected result; got ${rejected.length}`,
        );

        // The rejection must be a GenerationConflictError (serialized second call
        // reads the already-bumped generation and detects the mismatch).
        const rejected0 = rejected[0];
        assert.ok(rejected0 !== undefined, "rejected result must be defined");
        assert.ok(
          (rejected0 as PromiseRejectedResult).reason instanceof GenerationConflictError,
          `the losing concurrent call must reject with GenerationConflictError; ` +
            `got: ${String((rejected0 as PromiseRejectedResult).reason)}`,
        );

        // Final generation must be N+1=2, not N+2=3 (double-apply).
        const finalGenRow = concStore.get<{ max_gen: number }>(
          "SELECT MAX(generation) AS max_gen FROM plan_generation WHERE feature_id = ?",
          CONC_FEAT_ID,
        );
        assert.equal(
          finalGenRow?.max_gen,
          2,
          `final generation must be 2 (N+1=1+1); got ${String(finalGenRow?.max_gen)} ` +
            "(value > 2 indicates double-apply; no serialization in place)",
        );
      },
    );
  });
});
