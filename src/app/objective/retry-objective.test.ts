import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RetryObjective,
  ObjectiveNotRetryableError,
} from "./retry-objective.ts";
import { StaleCandidateError } from "../../domain/initiative.ts";
import type { Objective, Initiative } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { Event } from "../../domain/event.ts";
import {
  UnknownReferenceError,
  ObjectiveNotAwaitingConfirmationError,
} from "../errors.ts";

// ---------------------------------------------------------------------------
// Narrow interface the use case depends on
// ---------------------------------------------------------------------------

interface ObjectiveStore {
  getObjective(id: string): Objective | undefined;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveObjective(objective: Objective): void;
  resolveHomeDir(initiativeId: string): string;
  listTasksByObjective(objectiveId: string): Task[];
  saveTask(task: Task): void;
}

// ---------------------------------------------------------------------------
// Fake
// ---------------------------------------------------------------------------

class FakeObjectiveStore implements ObjectiveStore {
  readonly #objectives: Objective[];
  readonly #initiative: Initiative | undefined;
  readonly #tasks: Task[];
  readonly savedObjectives: Objective[] = [];
  readonly savedTasks: Task[] = [];

  constructor(
    objectives: Objective[],
    initiative?: Initiative,
    tasks: Task[] = [],
  ) {
    this.#objectives = objectives;
    this.#initiative = initiative;
    this.#tasks = tasks;
  }

  getObjective(id: string): Objective | undefined {
    return this.#objectives.find((o) => o.id === id);
  }

  listObjectives(initiativeId: string): Objective[] {
    return this.#objectives.filter((o) => o.initiativeId === initiativeId);
  }

  getInitiative(_initiativeId: string): Initiative | undefined {
    return this.#initiative;
  }

  saveObjective(objective: Objective): void {
    this.savedObjectives.push(objective);
  }

  resolveHomeDir(_initiativeId: string): string {
    return "/home/init-1.git";
  }

  listTasksByObjective(objectiveId: string): Task[] {
    return this.#tasks.filter((t) => t.objectiveId === objectiveId);
  }

  saveTask(task: Task): void {
    this.savedTasks.push(task);
  }
}

class FakeBroker {
  readonly currentTipCalls: Array<{ homeDir: string; ref: string }> = [];
  readonly #tip: string;

  constructor(tip: string) {
    this.#tip = tip;
  }

  async currentTip(homeDir: string, ref: string): Promise<string> {
    this.currentTipCalls.push({ homeDir, ref });
    return this.#tip;
  }
}

class FakeSquasher {
  readonly calls: Array<{ dir: string; parentOid: string; message: string }> =
    [];
  readonly #oid: string;

  constructor(oid: string) {
    this.#oid = oid;
  }

  async squashObjective(
    dir: string,
    parentOid: string,
    message: string,
  ): Promise<{ oid: string }> {
    this.calls.push({ dir, parentOid, message });
    return { oid: this.#oid };
  }
}

class FakeGate {
  readonly calls: string[] = [];
  readonly #result: { passed: boolean; reason?: string };

  constructor(result: { passed: boolean; reason?: string }) {
    this.#result = result;
  }

  async verify(dir: string): Promise<{ passed: boolean; reason?: string }> {
    this.calls.push(dir);
    return this.#result;
  }
}

class RecordingEventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    this.events.push(event);
  }
}

const noopUow = { transaction: <T>(fn: () => T): T => fn() };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("execute throws UnknownReferenceError('objective', id) when the objective does not exist", async () => {
  const store = new FakeObjectiveStore([]);
  const useCase = new RetryObjective(store);

  await assert.rejects(
    () =>
      useCase.execute({ objectiveId: "missing-obj", expectedCommit: "MATCH" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      assert.equal(err.kind, "objective");
      assert.equal(err.id, "missing-obj");
      return true;
    },
  );
});

test("execute refuses retry on a non-tip integrated objective, guiding to a corrective objective or restart", async () => {
  // OBJ_A integrated first, OBJ_B integrated after it (tip) — mirrors the
  // epic Proof's Story D scenario: `retry objective --id $OBJ_A` after both
  // objectives have already been brokered into the initiative branch.
  const OBJ_A: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "integrated",
  };
  const OBJ_B: Objective = {
    id: "obj-b",
    initiativeId: "init-1",
    name: "frontend",
    status: "integrated",
  };
  const store = new FakeObjectiveStore([OBJ_A, OBJ_B]);
  const useCase = new RetryObjective(store);

  await assert.rejects(
    () => useCase.execute({ objectiveId: OBJ_A.id, expectedCommit: "MATCH" }),
    (err: unknown) => {
      assert.ok(err instanceof ObjectiveNotRetryableError);
      assert.match(
        err.message,
        /non-tip|corrective|restart|not rewritable|already integrated/i,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// B3.2 (review blocker fix) — RetryObjective now owns the retry-eligibility
// guard: a non-retryable status (only `awaiting_confirmation`/`conflict` are
// retryable, per domain `canRetryObjective`) throws
// ObjectiveNotAwaitingConfirmationError instead of silently no-oping. This
// replaces the dead fallthrough Story 03 A's defect class also hit.
// ---------------------------------------------------------------------------

test("execute throws ObjectiveNotAwaitingConfirmationError for a non-retryable status (building) instead of silently no-oping (B3.2)", async () => {
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "building",
  };
  const store = new FakeObjectiveStore([OBJ]);
  const useCase = new RetryObjective(store);

  await assert.rejects(
    () => useCase.execute({ objectiveId: OBJ.id, expectedCommit: "STALE_OID" }),
    (err: unknown) => {
      assert.ok(
        err instanceof ObjectiveNotAwaitingConfirmationError,
        `must be ObjectiveNotAwaitingConfirmationError; got: ${(err as Error).constructor.name}`,
      );
      assert.equal(err.objectiveId, OBJ.id);
      assert.equal(err.status, "building");
      return true;
    },
  );
  assert.equal(
    store.savedObjectives.length,
    0,
    "a rejected retry must not save the objective",
  );
});

test("execute on a conflict objective without the resolution dependency set (broker/workspaces/gate/feed/uow) stays a no-op (unchanged)", async () => {
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "STALE_OID",
    parentOid: "OLD_TIP",
  };
  const store = new FakeObjectiveStore([OBJ]);
  const useCase = new RetryObjective(store);

  await useCase.execute({ objectiveId: OBJ.id, expectedCommit: "STALE_OID" });

  assert.equal(
    store.savedObjectives.length,
    0,
    "a conflict objective with no resolution deps must not be saved",
  );
});

// ---------------------------------------------------------------------------
// Story E — conflict resolution: re-squash onto the current initiative tip,
// re-run the verification gate in the clone, and only return the objective to
// `awaiting_confirmation` when the gate passes (fail → stays `conflict` with a
// recorded reason).
// ---------------------------------------------------------------------------

test("execute resolves a conflict objective when the gate passes: re-squashes onto the current tip, records the new commitOid/parentOid, and transitions to awaiting_confirmation", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    paused: false,
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "STALE_OID",
    parentOid: "OLD_TIP",
  };
  const store = new FakeObjectiveStore([OBJ], initiative);
  const broker = new FakeBroker("NEW_TIP");
  const squasher = new FakeSquasher("RESQUASHED_OID");
  const gate = new FakeGate({ passed: true });
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await useCase.execute({ objectiveId: OBJ.id, expectedCommit: "STALE_OID" });

  assert.equal(
    broker.currentTipCalls.length,
    1,
    "must read the current initiative tip in home",
  );
  assert.deepEqual(squasher.calls, [
    {
      dir: "/clones/init-1",
      parentOid: "NEW_TIP",
      message: squasher.calls[0]!.message,
    },
  ]);
  assert.deepEqual(
    gate.calls,
    ["/clones/init-1"],
    "gate must run in the clone",
  );

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(saved.status, "awaiting_confirmation");
  assert.equal(saved.commitOid, "RESQUASHED_OID");
  assert.equal(saved.parentOid, "NEW_TIP");

  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0]!.type, "objective.awaiting_confirmation");
});

test("execute resolves a conflict objective when the gate fails: stays conflict, records the failure reason, does not transition", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    paused: false,
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "STALE_OID",
    parentOid: "OLD_TIP",
  };
  const store = new FakeObjectiveStore([OBJ], initiative);
  const broker = new FakeBroker("NEW_TIP");
  const squasher = new FakeSquasher("RESQUASHED_OID");
  const gate = new FakeGate({ passed: false, reason: "tests failed: 2 red" });
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await useCase.execute({ objectiveId: OBJ.id, expectedCommit: "STALE_OID" });

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(
    saved.status,
    "conflict",
    "must stay conflict when the gate fails",
  );
  assert.equal(saved.conflictReason, "tests failed: 2 red");

  assert.equal(
    feed.events.some((e) => e.type === "objective.awaiting_confirmation"),
    false,
    "must not surface awaiting_confirmation when the gate failed",
  );
});

// ---------------------------------------------------------------------------
// B5 regression — `--note` must NOT re-queue tasks (no `failed->pending`
// transition invented). It only writes `note` onto every non-terminal task
// of the objective (status untouched); terminal tasks (`completed`,
// `discarded`) are left untouched; with no `--note`, nothing is rewritten.
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task-a",
    objectiveId: "obj-a",
    title: "do the thing",
    status: "failed",
    dependencies: [],
    ...overrides,
  };
}

test("execute resolves a conflict objective with a note: writes the note onto every non-terminal task without changing status; completed/discarded tasks are untouched (B5 regression)", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    paused: false,
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "STALE_OID",
    parentOid: "OLD_TIP",
  };
  const taskFailed = makeTask({ id: "task-failed", status: "failed" });
  const taskPending = makeTask({ id: "task-pending", status: "pending" });
  const taskCompleted = makeTask({ id: "task-completed", status: "completed" });
  const taskDiscarded = makeTask({ id: "task-discarded", status: "discarded" });
  const store = new FakeObjectiveStore([OBJ], initiative, [
    taskFailed,
    taskPending,
    taskCompleted,
    taskDiscarded,
  ]);
  const broker = new FakeBroker("NEW_TIP");
  const squasher = new FakeSquasher("RESQUASHED_OID");
  const gate = new FakeGate({ passed: true });
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await useCase.execute({
    objectiveId: OBJ.id,
    expectedCommit: "STALE_OID",
    note: "guidance",
  });

  const savedFailed = store.savedTasks.find((t) => t.id === "task-failed");
  assert.ok(savedFailed, "the failed task must have the note written onto it");
  assert.equal(
    savedFailed!.status,
    "failed",
    "the failed task's status must NOT be re-queued to pending",
  );
  assert.equal(savedFailed!.note, "guidance");

  const savedPending = store.savedTasks.find((t) => t.id === "task-pending");
  assert.ok(savedPending, "a non-terminal pending task must also get the note");
  assert.equal(savedPending!.status, "pending");
  assert.equal(savedPending!.note, "guidance");

  assert.ok(
    !store.savedTasks.some((t) => t.id === "task-completed"),
    "a completed (terminal) task must not be touched",
  );
  assert.ok(
    !store.savedTasks.some((t) => t.id === "task-discarded"),
    "a discarded (terminal) task must not be touched",
  );
});

test("execute resolves a conflict objective without a note: no task is rewritten at all (B5 regression)", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    paused: false,
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "STALE_OID",
    parentOid: "OLD_TIP",
  };
  const taskFailed = makeTask({
    id: "task-failed",
    status: "failed",
    note: "prior",
  });
  const taskPending = makeTask({ id: "task-pending", status: "pending" });
  const store = new FakeObjectiveStore([OBJ], initiative, [
    taskFailed,
    taskPending,
  ]);
  const broker = new FakeBroker("NEW_TIP");
  const squasher = new FakeSquasher("RESQUASHED_OID");
  const gate = new FakeGate({ passed: true });
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await useCase.execute({ objectiveId: OBJ.id, expectedCommit: "STALE_OID" });

  assert.equal(
    store.savedTasks.length,
    0,
    "with no --note, no task should be saved/rewritten",
  );
});

// ---------------------------------------------------------------------------
// Story 4 (012) — Required `--expected-commit` on RetryObjective.
//
// (a) a stale guard on a `conflict` objective is refused BEFORE the
//     broker.currentTip / workspaces.squashObjective / gate.verify calls —
//     SQLite cannot roll back a moved ref, so the refusal must precede any
//     git work. Pinned by a broker whose `currentTip` throws if reached.
// (b) a stale guard on an `awaiting_confirmation` objective (the path that
//     currently falls into the silent no-op at retry-objective.ts:129-130)
//     must also be refused — the client never reviewed the current
//     candidate, so the guard fires before the no-op.
// (c) the in-transaction re-check inside the success branch of
//     #resolveConflict: store.getObjective returns "AAA" on the early guard
//     and "BBB" inside the uow.transaction; the verdict is refused.
// ---------------------------------------------------------------------------

test("execute stale retry (a): conflict objective, broker never reached; rejects with StaleCandidateError; nothing saved", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    paused: false,
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "REVIEWED_OID",
    parentOid: "OLD_TIP",
  };
  const store = new FakeObjectiveStore([OBJ], initiative);
  // A broker whose currentTip throws if called — proves the early guard
  // fires before any git work.
  const broker = {
    async currentTip(): Promise<string> {
      throw new Error("broker reached: currentTip");
    },
  };
  const squasher = {
    async squashObjective(): Promise<{ oid: string }> {
      throw new Error("broker reached: squashObjective");
    },
  };
  const gate = {
    async verify(): Promise<{ passed: boolean; reason?: string }> {
      throw new Error("broker reached: gate.verify");
    },
  };
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await assert.rejects(
    () =>
      useCase.execute({
        objectiveId: OBJ.id,
        expectedCommit: "0".repeat(40),
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}: ${(err as Error).message}`,
      );
      return true;
    },
  );

  assert.equal(store.savedObjectives.length, 0);
  assert.equal(store.savedTasks.length, 0);
  assert.equal(
    feed.events.length,
    0,
    "no event must be appended on stale retry",
  );
});

test("execute stale retry (b): awaiting_confirmation objective (silent no-op path) refuses a stale guard; nothing saved", async () => {
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "awaiting_confirmation",
    commitOid: "REVIEWED_OID",
  };
  const store = new FakeObjectiveStore([OBJ]);
  const useCase = new RetryObjective(store);

  await assert.rejects(
    () =>
      useCase.execute({
        objectiveId: OBJ.id,
        expectedCommit: "0".repeat(40),
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
  );

  assert.equal(store.savedObjectives.length, 0);
  assert.equal(store.savedTasks.length, 0);
});

test("execute matching retry on conflict with interleaved store: store returns 'AAA' on the early guard then 'BBB' inside the uow — refused with StaleCandidateError; nothing saved", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    paused: false,
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "AAA",
    parentOid: "OLD_TIP",
  };
  const store = new FakeObjectiveStore([OBJ], initiative);
  // First getObjective (early guard, outside the transaction) returns "AAA"
  // (matches expectedCommit, guard passes). Subsequent getObjective calls
  // (inside the uow.transaction re-check) return "BBB" (mismatch, refused).
  let callIndex = 0;
  const originalGetObjective = store.getObjective.bind(store);
  store.getObjective = (id: string) => {
    callIndex += 1;
    if (callIndex === 1) {
      return { ...OBJ, commitOid: "AAA" };
    }
    return { ...OBJ, commitOid: "BBB" };
  };
  void originalGetObjective;

  const broker = new FakeBroker("NEW_TIP");
  const squasher = new FakeSquasher("RESQUASHED_OID");
  const gate = new FakeGate({ passed: true });
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await assert.rejects(
    () => useCase.execute({ objectiveId: OBJ.id, expectedCommit: "AAA" }),
    (err: unknown) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
  );

  assert.equal(store.savedObjectives.length, 0);
  assert.equal(
    feed.events.some((e) => e.type === "objective.awaiting_confirmation"),
    false,
    "no objective.awaiting_confirmation must be appended",
  );
});
