import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { compile } from "../compiler/compile.ts";
import { loadTasks, markExitGatePassed, setTaskStatus } from "./dispatch.ts";
import { initSchema } from "../store/schema.ts";
import { LeaseManager } from "./leases.ts";
import type { Capability } from "./leases.ts";
import { park } from "./blocked-on.ts";
import { pollOnce } from "./poll.ts";
import type { DispatchedTask } from "./poll.ts";

// ---------------------------------------------------------------------------
// Golden fixture — three-task DAG
//   task-alpha (root), task-beta (depends task-alpha), task-gamma (depends task-alpha)
// Same fixture used across all scheduler tests.
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
// Suite: src/scheduler/poll
// ---------------------------------------------------------------------------

describe("src/scheduler/poll", () => {
  describe("T1 — composed dispatch predicate + collision in one pass", () => {
    let featDir = "";
    let testDir = "";
    let store: Store;
    let clock: FakeClock;
    let lm: LeaseManager;
    let liveHash = "";

    before(async () => {
      featDir = await mkdtemp(join(tmpdir(), "kanthord-poll-t1-feat-"));

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
      testDir = await mkdtemp(join(tmpdir(), "kanthord-poll-t1-db-"));
      const dbPath = join(testDir, "test.db");
      store = openStore(dbPath, { busyTimeout: 1000 });
      clock = new FakeClock(0);
      lm = new LeaseManager(store, clock);
      await compile(featDir, store, COMPILE_OPTS);
      initSchema(store);
      loadTasks(store, "feat-001");

      const genRow = store.get<{ compile_hash: string }>(
        "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
      );
      liveHash = genRow?.compile_hash ?? "";
      assert.ok(liveHash.length > 0, "liveHash must be set from compiled plan_generation");
    });

    afterEach(async () => {
      store.close();
      if (testDir) await rm(testDir, { recursive: true, force: true });
      testDir = "";
    });

    // -----------------------------------------------------------------------
    // Condition 1 (gates): a task whose dependency exit gate has not passed
    // is not dispatched even though it is otherwise pending.
    // -----------------------------------------------------------------------

    test("gates condition false: dependent not dispatched until dependency exit gate passes", () => {
      // Round 1: only task-alpha is a root (no task-kind predecessors) — it dispatches.
      const r1 = pollOnce(store, "feat-001", liveHash, lm, new Map());
      const ids1 = r1.map((t: DispatchedTask) => t.taskId);
      assert.deepEqual(ids1, ["task-alpha"], "only root task dispatched in first pass");

      // task-alpha is now 'running' (set by pollOnce); its exit gate has NOT been marked.
      // Round 2: task-beta and task-gamma are gate-blocked → nothing dispatched.
      const r2 = pollOnce(store, "feat-001", liveHash, lm, new Map());
      assert.equal(r2.length, 0, "nothing dispatched when dependency exit gate not passed");
      assert.ok(
        !r2.some((t: DispatchedTask) => t.taskId === "task-beta"),
        "task-beta absent when alpha exit gate not passed",
      );
      assert.ok(
        !r2.some((t: DispatchedTask) => t.taskId === "task-gamma"),
        "task-gamma absent when alpha exit gate not passed",
      );
    });

    // -----------------------------------------------------------------------
    // Condition 2 (leases): a task whose required capability is already held
    // by another task is not dispatched.
    // -----------------------------------------------------------------------

    test("lease condition false: task not dispatched when its capability is already held", () => {
      // Put task-alpha in a terminal state so task-beta and task-gamma are gate-ready.
      setTaskStatus(store, "task-alpha", "done");
      markExitGatePassed(store, "task-alpha");

      // Pre-acquire task-beta's exclusive capability with a separate holder.
      const betaCap: Capability = { kind: "write_scope", path: "ios/**" };
      lm.acquire("pre-holder", [betaCap]);

      // task-beta needs ios/**, task-gamma needs nothing.
      const caps = new Map<string, Capability[]>([
        ["task-beta", [betaCap]],
        ["task-gamma", []],
      ]);

      const result = pollOnce(store, "feat-001", liveHash, lm, caps);
      const ids = result.map((t: DispatchedTask) => t.taskId);

      assert.ok(!ids.includes("task-beta"), "task-beta blocked by held lease");
      assert.ok(ids.includes("task-gamma"), "task-gamma dispatches (no lease conflict)");
    });

    // -----------------------------------------------------------------------
    // Condition 3 (parked): a parked task is not dispatched even when its
    // gates are satisfied.
    // -----------------------------------------------------------------------

    test("park condition false: parked task not dispatched even when gates pass", () => {
      // task-alpha is root and normally the only dispatchable task. Park it.
      park(store, "task-alpha", "op-999", [], lm);

      const result = pollOnce(store, "feat-001", liveHash, lm, new Map());
      assert.equal(result.length, 0, "parked task-alpha must not be dispatched");
      assert.ok(
        !result.some((t: DispatchedTask) => t.taskId === "task-alpha"),
        "parked task absent from dispatch result",
      );
    });

    // -----------------------------------------------------------------------
    // Condition 4 (generation / dirty): a dirty plan halts all new dispatch.
    // -----------------------------------------------------------------------

    test("dirty plan: nothing dispatched when liveHash does not match stored compile_hash", () => {
      const result = pollOnce(store, "feat-001", "wrong-hash-mismatch", lm, new Map());
      assert.equal(result.length, 0, "no task dispatched when plan is dirty");
    });

    // -----------------------------------------------------------------------
    // Collision: two DAG-ready tasks competing for the same capability →
    // exactly one dispatched per pass; the other dispatches only after release.
    // This is the EPIC §7.3 combined-pass gate: dispatch = gates ∧ leases.
    // -----------------------------------------------------------------------

    test("collision: two DAG-ready tasks on same capability → exactly one dispatched; loser dispatches after release", () => {
      // Bring task-alpha to terminal state so task-beta and task-gamma are both gate-ready.
      setTaskStatus(store, "task-alpha", "done");
      markExitGatePassed(store, "task-alpha");

      // Both task-beta and task-gamma want the same write_scope capability.
      const sharedCap: Capability = { kind: "write_scope", path: "ios/**" };
      const caps = new Map<string, Capability[]>([
        ["task-beta", [sharedCap]],
        ["task-gamma", [sharedCap]],
      ]);

      // Pass 1: exactly one task acquires the lease and is dispatched.
      const r1 = pollOnce(store, "feat-001", liveHash, lm, caps);
      assert.equal(r1.length, 1, "first pass dispatches exactly one task (lease collision)");

      const winner = r1[0]?.taskId ?? "";
      assert.ok(
        winner === "task-beta" || winner === "task-gamma",
        "winner must be one of the two competing tasks",
      );
      const loser = winner === "task-beta" ? "task-gamma" : "task-beta";

      // Pass 2: winner is now 'running' (no longer pending); loser is still
      // pending but the lease is held → nothing dispatched.
      const r2 = pollOnce(store, "feat-001", liveHash, lm, caps);
      assert.equal(
        r2.length,
        0,
        "second pass dispatches nothing: winner is running, loser lease-blocked",
      );

      // Release the winner's lease (simulates task completion freeing the capability).
      lm.release(winner);

      // Pass 3: loser can now acquire the released capability and is dispatched.
      const r3 = pollOnce(store, "feat-001", liveHash, lm, caps);
      assert.equal(r3.length, 1, "third pass dispatches exactly one after release");
      assert.equal(
        r3[0]?.taskId,
        loser,
        "the previously lease-blocked task dispatches after the winner releases",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T2 — Full golden-feature drain, deterministic pass
  // ---------------------------------------------------------------------------

  describe("T2 — full golden-feature drain, deterministic pass", () => {
    let featDir2 = "";
    let testDir2 = "";
    let store2: Store;
    let clock2: FakeClock;
    let lm2: LeaseManager;
    let liveHash2 = "";

    before(async () => {
      featDir2 = await mkdtemp(join(tmpdir(), "kanthord-poll-t2-feat-"));

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
      testDir2 = await mkdtemp(join(tmpdir(), "kanthord-poll-t2-db-"));
      const dbPath = join(testDir2, "test.db");
      store2 = openStore(dbPath, { busyTimeout: 1000 });
      clock2 = new FakeClock(0);
      lm2 = new LeaseManager(store2, clock2);
      await compile(featDir2, store2, COMPILE_OPTS);
      initSchema(store2);
      loadTasks(store2, "feat-001");

      const genRow = store2.get<{ compile_hash: string }>(
        "SELECT compile_hash FROM plan_generation WHERE feature_id = 'feat-001' ORDER BY generation DESC LIMIT 1",
      );
      liveHash2 = genRow?.compile_hash ?? "";
      assert.ok(liveHash2.length > 0, "liveHash2 must be set from compiled plan_generation");
    });

    afterEach(async () => {
      store2.close();
      if (testDir2) await rm(testDir2, { recursive: true, force: true });
      testDir2 = "";
    });

    // -----------------------------------------------------------------------
    // Full drain: drive the golden feature to all-tasks-done via repeated
    // pollOnce passes (marking exit gates as tasks "finish"), asserting
    // dispatch order is DAG-valid (dependents never before dependency's gate).
    // -----------------------------------------------------------------------

    test("full drain without capability conflicts: all tasks dispatch in DAG-valid order", () => {
      // Wave 1: only root task-alpha should dispatch.
      const w1 = pollOnce(store2, "feat-001", liveHash2, lm2, new Map());
      const w1Ids = w1.map((t: DispatchedTask) => t.taskId);
      assert.deepEqual(w1Ids, ["task-alpha"], "wave 1: only root task-alpha dispatches");
      // DAG-validity: dependents must NOT appear before task-alpha's exit gate.
      assert.ok(!w1Ids.includes("task-beta"), "task-beta must not appear in wave 1");
      assert.ok(!w1Ids.includes("task-gamma"), "task-gamma must not appear in wave 1");

      // Simulate task-alpha completing (exit gate passes).
      setTaskStatus(store2, "task-alpha", "done");
      markExitGatePassed(store2, "task-alpha");

      // Wave 2: task-beta and task-gamma are now gate-ready; no capability conflicts.
      const w2 = pollOnce(store2, "feat-001", liveHash2, lm2, new Map());
      const w2Ids = w2.map((t: DispatchedTask) => t.taskId);
      assert.ok(
        w2Ids.includes("task-beta") && w2Ids.includes("task-gamma"),
        "wave 2: both task-beta and task-gamma dispatch after task-alpha exit gate passes",
      );
      assert.equal(w2Ids.length, 2, "wave 2: exactly two tasks dispatched");

      // Simulate both completing.
      setTaskStatus(store2, "task-beta", "done");
      markExitGatePassed(store2, "task-beta");
      setTaskStatus(store2, "task-gamma", "done");
      markExitGatePassed(store2, "task-gamma");

      // Wave 3: all tasks done — drain complete, nothing left.
      const w3 = pollOnce(store2, "feat-001", liveHash2, lm2, new Map());
      assert.equal(w3.length, 0, "wave 3: drain complete — no tasks dispatched");
    });

    // -----------------------------------------------------------------------
    // Full drain with lease collision: tasks sharing a write-scope capability
    // dispatch sequentially (never concurrently on the same capability).
    // -----------------------------------------------------------------------

    test("full drain with shared capability: lease-respecting sequential dispatch", () => {
      const sharedCap: Capability = { kind: "write_scope", path: "ios/**" };
      const caps = new Map<string, Capability[]>([
        ["task-beta", [sharedCap]],
        ["task-gamma", [sharedCap]],
      ]);

      // Wave 1: task-alpha root (no assigned capability → acquires [] atomically).
      const w1 = pollOnce(store2, "feat-001", liveHash2, lm2, caps);
      assert.equal(w1.length, 1, "wave 1: only task-alpha dispatches (no capability conflict)");
      assert.equal(w1[0]?.taskId, "task-alpha", "wave 1 task is task-alpha");

      setTaskStatus(store2, "task-alpha", "done");
      markExitGatePassed(store2, "task-alpha");

      // Wave 2: both gate-ready but collide on ios/** → exactly one wins the lease.
      const w2 = pollOnce(store2, "feat-001", liveHash2, lm2, caps);
      assert.equal(w2.length, 1, "wave 2: exactly one task dispatches (lease collision)");
      const winner = w2[0]?.taskId ?? "";
      assert.ok(
        winner === "task-beta" || winner === "task-gamma",
        "wave 2 winner is task-beta or task-gamma",
      );
      const loser = winner === "task-beta" ? "task-gamma" : "task-beta";

      // Wave 3: winner running, loser lease-blocked → nothing dispatches.
      const w3 = pollOnce(store2, "feat-001", liveHash2, lm2, caps);
      assert.equal(w3.length, 0, "wave 3: loser lease-blocked, winner running → nothing dispatched");

      // Simulate winner completing and releasing its lease.
      setTaskStatus(store2, winner, "done");
      markExitGatePassed(store2, winner);
      lm2.release(winner);

      // Wave 4: loser can now acquire the released capability and dispatches.
      const w4 = pollOnce(store2, "feat-001", liveHash2, lm2, caps);
      assert.equal(w4.length, 1, "wave 4: loser dispatches after winner releases the lease");
      assert.equal(w4[0]?.taskId, loser, "wave 4 dispatches the previously lease-blocked task");
    });

    // -----------------------------------------------------------------------
    // Deterministic / idempotent: two successive pollOnce calls over unchanged
    // persisted state return the identical dispatch set (no hidden timers).
    // -----------------------------------------------------------------------

    test("two successive pollOnce calls over unchanged persisted state return identical dispatch sets", () => {
      // First call: task-alpha (root, pending) dispatches and transitions to 'running'.
      const r1 = pollOnce(store2, "feat-001", liveHash2, lm2, new Map());
      assert.equal(r1.length, 1, "first call dispatches task-alpha");

      // No external state changes.
      // Second call: task-alpha is 'running' (excluded from dispatchable);
      // task-beta and task-gamma are gate-blocked → empty result.
      const r2 = pollOnce(store2, "feat-001", liveHash2, lm2, new Map());
      assert.equal(r2.length, 0, "second call: task-alpha running, others gate-blocked → empty");

      // Third call over still-unchanged state: same result as second (idempotent).
      const r3 = pollOnce(store2, "feat-001", liveHash2, lm2, new Map());
      assert.equal(r3.length, 0, "third call over unchanged state: empty (idempotent)");
      assert.deepEqual(
        r2.map((t: DispatchedTask) => t.taskId),
        r3.map((t: DispatchedTask) => t.taskId),
        "successive pollOnce calls over unchanged persisted state return the identical dispatch set",
      );
    });
  });
});
