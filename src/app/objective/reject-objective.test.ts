/**
 * Story 05 (i) — RejectObjective use case (discard-only per B3/B3.3).
 *
 * Verify (05-terminal-discard-path.md): `discard` from each of `building` /
 * `awaiting_confirmation` / `conflict` reaches `discarded`; `discard` from
 * `integrated` throws. `RejectObjective` no longer accepts a `resolution`
 * field or a `retry` path — routing between retry/discard is the CLI's job
 * (see `src/apps/cli/objective.test.ts`), and the retry-from-non-retryable
 * guard now lives on `RetryObjective` itself (see
 * `src/app/objective/retry-objective.test.ts`).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { RejectObjective, ImpactChangedError } from "./reject-objective.ts";
import { ObjectiveNotAwaitingConfirmationError } from "../errors.ts";
import { StaleCandidateError } from "../../domain/initiative.ts";
import type { Objective, Initiative } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type { Event } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";

const INI_ID = "01JZZZZZZZZZZZZZZZZZZZINIRO";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJRO";
const TASK_PENDING = "01JZZZZZZZZZZZZZZZZZZZTPRO1";
const TASK_FAILED = "01JZZZZZZZZZZZZZZZZZZZTFRO1";

interface RejectObjectiveStore {
  getObjective(id: string): Objective | undefined;
  saveObjective(objective: Objective): void;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveInitiative(initiative: Initiative): void;
  listTasksByObjective(objectiveId: string): Task[];
  saveTask(task: Task): void;
  listObjectiveAfter(objectiveId: string): string[];
  listInitiativeAfter(initiativeId: string): string[];
  listInitiatives(projectId: string): Initiative[];
  getProjectId(initiativeId: string): string | undefined;
  listTasksByInitiative(initiativeId: string): Task[];
}

class MemStore implements RejectObjectiveStore {
  readonly savedObjectives: Objective[] = [];
  readonly savedInitiatives: Initiative[] = [];
  readonly savedTasks: Task[] = [];
  readonly #objectives: Map<string, Objective>;
  readonly #initiatives: Map<string, Initiative>;
  readonly #tasks: Map<string, Task>;

  constructor(
    objectives: Objective[],
    initiatives: Initiative[],
    tasks: Task[] = [],
  ) {
    this.#objectives = new Map(objectives.map((o) => [o.id, o]));
    this.#initiatives = new Map(initiatives.map((i) => [i.id, i]));
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
  }

  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }

  saveObjective(objective: Objective): void {
    this.#objectives.set(objective.id, objective);
    this.savedObjectives.push(objective);
  }

  listObjectives(initiativeId: string): Objective[] {
    return [...this.#objectives.values()].filter(
      (o) => o.initiativeId === initiativeId,
    );
  }

  getInitiative(initiativeId: string): Initiative | undefined {
    return this.#initiatives.get(initiativeId);
  }

  saveInitiative(initiative: Initiative): void {
    this.#initiatives.set(initiative.id, initiative);
    this.savedInitiatives.push(initiative);
  }

  listTasksByObjective(objectiveId: string): Task[] {
    return [...this.#tasks.values()].filter(
      (t) => t.objectiveId === objectiveId,
    );
  }

  saveTask(task: Task): void {
    this.#tasks.set(task.id, task);
    this.savedTasks.push(task);
  }

  listObjectiveAfter(_objectiveId: string): string[] {
    return [];
  }

  listInitiativeAfter(_initiativeId: string): string[] {
    return [];
  }

  listInitiatives(projectId: string): Initiative[] {
    return [...this.#initiatives.values()].filter(
      (i) => i.projectId === projectId,
    );
  }

  getProjectId(initiativeId: string): string | undefined {
    return this.#initiatives.get(initiativeId)?.projectId;
  }

  listTasksByInitiative(initiativeId: string): Task[] {
    const objectiveIds = new Set(
      this.listObjectives(initiativeId).map((o) => o.id),
    );
    return [...this.#tasks.values()].filter((t) =>
      objectiveIds.has(t.objectiveId),
    );
  }
}

class MemFeed implements EventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    this.events.push(event);
  }
  readAfter(_cursor: string, _limit?: number): Event[] {
    return [];
  }
}

class MemUow implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

// A flag flipped only while `uow.transaction` is actually running — mirrors
// `reject-task.test.ts`'s `TransactionFlag`, used to prove `RejectObjective`'s
// `expectImpact` re-check (§B.5, reject-objective.ts:161-173) reads a
// freshly-changed graph specifically *inside* the transaction, not merely on
// some later call regardless of transaction state.
class TransactionFlag {
  inTransaction = false;
}

class FlaggingUow implements UnitOfWork {
  readonly #flag: TransactionFlag;
  constructor(flag: TransactionFlag) {
    this.#flag = flag;
  }
  transaction<T>(fn: () => T): T {
    this.#flag.inTransaction = true;
    try {
      return fn();
    } finally {
      this.#flag.inTransaction = false;
    }
  }
}

// A store whose `listTasksByInitiative` returns a different task graph
// depending on whether `uow.transaction` is currently running. Every read
// taken before the transaction (the pre-transaction digest compare) must see
// `firstGraph`; only a read taken while `flag.inTransaction` is `true` may see
// `secondGraph`.
class VaryingStore extends MemStore {
  readonly #flag: TransactionFlag;
  readonly #firstGraph: Task[];
  readonly #secondGraph: Task[];

  constructor(
    objectives: Objective[],
    initiatives: Initiative[],
    firstGraph: Task[],
    secondGraph: Task[],
    flag: TransactionFlag,
  ) {
    super(objectives, initiatives, firstGraph);
    this.#firstGraph = firstGraph;
    this.#secondGraph = secondGraph;
    this.#flag = flag;
  }

  override listTasksByInitiative(_initiativeId: string): Task[] {
    return this.#flag.inTransaction ? this.#secondGraph : this.#firstGraph;
  }
}

function tasks(): Task[] {
  return [
    {
      id: TASK_PENDING,
      objectiveId: OBJ_ID,
      title: "never ran",
      status: "pending",
      dependencies: [],
    },
    {
      id: TASK_FAILED,
      objectiveId: OBJ_ID,
      title: "unachievable",
      status: "failed",
      dependencies: [],
    },
  ];
}

describe("RejectObjective — discard from building/awaiting_confirmation/conflict reaches discarded", () => {
  for (const status of [
    "building",
    "awaiting_confirmation",
    "conflict",
  ] as const) {
    test(`discard from ${status} reaches discarded, discards non-terminal tasks, emits objective.discarded`, async () => {
      const objective: Objective = {
        id: OBJ_ID,
        initiativeId: INI_ID,
        name: "O",
        status,
        commitOid: "REVIEWED_OID",
      };
      const initiative: Initiative = {
        id: INI_ID,
        projectId: "proj-1",
        name: "I",
        paused: false,
        status: "building",
      };
      const store = new MemStore([objective], [initiative], tasks());
      const feed = new MemFeed();
      const uc = new RejectObjective(store, feed, new MemUow());

      await uc.execute({
        objectiveId: OBJ_ID,
        reason: "unachievable",
        expectedCommit: "REVIEWED_OID",
      });

      assert.equal(
        store.getObjective(OBJ_ID)?.status,
        "discarded",
        `objective must be discarded from ${status}`,
      );
      assert.equal(
        store.listTasksByObjective(OBJ_ID).find((t) => t.id === TASK_PENDING)
          ?.status,
        "discarded",
        "pending task must be discarded",
      );
      assert.equal(
        store.listTasksByObjective(OBJ_ID).find((t) => t.id === TASK_FAILED)
          ?.status,
        "discarded",
        "failed task must be discarded",
      );
      const objDiscarded = feed.events.find(
        (e) => e.type === "objective.discarded" && e.objectiveId === OBJ_ID,
      );
      assert.ok(
        objDiscarded !== undefined,
        "objective.discarded event must be appended",
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Review blocker S1 (007.16) — RejectObjective discards each `pending`/
// `failed` task of the objective but currently emits no `task.discarded`
// event for them; contract.md §7 requires each discarded task to emit
// task.discarded with payload {reason: "cascade", origin: <originating id>}.
// ---------------------------------------------------------------------------

test("RejectObjective: discard emits task.discarded with {reason: cascade, origin} for every discarded task (S1, contract.md §7)", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "building",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative], tasks());
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  await uc.execute({
    objectiveId: OBJ_ID,
    reason: "unachievable",
    expectedCommit: "REVIEWED_OID",
  });

  for (const taskId of [TASK_PENDING, TASK_FAILED]) {
    const discardedEvent = feed.events.find(
      (e) => e.type === "task.discarded" && e.taskId === taskId,
    );
    assert.ok(
      discardedEvent !== undefined,
      `expected a task.discarded event for ${taskId}; got types: ${feed.events.map((e) => e.type).join(", ")}`,
    );
    assert.equal(
      discardedEvent!.payload?.["reason"],
      "cascade",
      `task.discarded payload.reason must be "cascade" for ${taskId}`,
    );
    assert.equal(
      discardedEvent!.payload?.["origin"],
      OBJ_ID,
      `task.discarded payload.origin must name the originating objective for ${taskId}`,
    );
  }
});

test("RejectObjective: discard from building rolls up a single-objective initiative to discarded", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "building",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative], tasks());
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  await uc.execute({ objectiveId: OBJ_ID, expectedCommit: "REVIEWED_OID" });

  assert.equal(
    store.getInitiative(INI_ID)?.status,
    "discarded",
    "initiative must roll up to discarded when its sole objective discards",
  );
  const initDiscarded = feed.events.find(
    (e) => e.type === "initiative.discarded" && e.initiativeId === INI_ID,
  );
  assert.ok(
    initDiscarded !== undefined,
    "initiative.discarded event must be appended",
  );
});

test("RejectObjective: discard from integrated throws ObjectiveNotAwaitingConfirmationError", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "integrated",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative]);
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  await assert.rejects(
    () => uc.execute({ objectiveId: OBJ_ID, expectedCommit: "REVIEWED_OID" }),
    (err: unknown) => {
      assert.ok(
        err instanceof ObjectiveNotAwaitingConfirmationError,
        `must be ObjectiveNotAwaitingConfirmationError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
    "discard from integrated must throw ObjectiveNotAwaitingConfirmationError — integrated work is not discardable",
  );
});

// ---------------------------------------------------------------------------
// Story 4 (012) — RejectObjective requires the same `expectedCommit` guard
// as ApproveObjective. A stale guard is refused with StaleCandidateError
// and no state changes (no objective.discarded, no task.discarded).
// ---------------------------------------------------------------------------

test("RejectObjective: stale expectedCommit rejects with StaleCandidateError; no objective.discarded; no task.discarded; no save", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "awaiting_confirmation",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative], tasks());
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  await assert.rejects(
    () =>
      uc.execute({
        objectiveId: OBJ_ID,
        reason: "unachievable",
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

  assert.equal(store.savedObjectives.length, 0, "no objective must be saved");
  assert.equal(
    store.savedTasks.length,
    0,
    "no tasks must be discarded on stale reject",
  );
  assert.equal(
    feed.events.some(
      (e) => e.type === "objective.discarded" && e.objectiveId === OBJ_ID,
    ),
    false,
    "must not append objective.discarded",
  );
  assert.equal(
    feed.events.some(
      (e) => e.type === "task.discarded" && e.taskId === TASK_PENDING,
    ),
    false,
    "must not append task.discarded for the pending task",
  );
});

test("RejectObjective: in-transaction interleaving — early guard sees 'AAA', uow re-check sees 'BBB'; rejected with StaleCandidateError; nothing saved", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "awaiting_confirmation",
    commitOid: "AAA",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative], tasks());
  // First getObjective (early guard, outside the transaction) returns "AAA"
  // (matches expectedCommit, so guard passes). Every later getObjective
  // (inside the transaction re-check) returns "BBB" (mismatch, refused).
  let callIndex = 0;
  const originalGet = store.getObjective.bind(store);
  store.getObjective = (id: string) => {
    callIndex += 1;
    if (callIndex === 1) {
      return { ...objective, commitOid: "AAA" };
    }
    return { ...objective, commitOid: "BBB" };
  };
  void originalGet;

  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  await assert.rejects(
    () =>
      uc.execute({
        objectiveId: OBJ_ID,
        reason: "unachievable",
        expectedCommit: "AAA",
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
  assert.equal(feed.events.length, 0, "no event must be appended");
});

// ---------------------------------------------------------------------------
// Story 3 (017) §B — confirm protocol on RejectObjective: dryRun / expectImpact,
// derived from previewDiscard, with the 012 stale guard running first.
// ---------------------------------------------------------------------------

test("(017-S3-obj-dry-run-no-writes) RejectObjective discard --dry-run: returns a preview, writes nothing, emits nothing", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "conflict",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative], tasks());
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  const result = await uc.execute({
    objectiveId: OBJ_ID,
    expectedCommit: "REVIEWED_OID",
    dryRun: true,
  });

  assert.ok(result.preview !== undefined, "dryRun must return a preview");
  const pendingDamage = result.preview.damage.find(
    (d) => d.target.id === TASK_PENDING,
  );
  assert.equal(
    pendingDamage?.effect,
    "discarded-by-cascade",
    "the preview must name the pending task as discarded-by-cascade",
  );
  assert.equal(store.savedObjectives.length, 0, "no objective must be saved");
  assert.equal(store.savedTasks.length, 0, "no task must be saved");
  assert.equal(feed.events.length, 0, "no event must be appended");
});

test("(017-S3-obj-stale-commit-before-preview) RejectObjective discard: a mismatched --expected-commit rejects with StaleCandidateError, not ImpactChangedError, proving the 012 guard runs before any preview is built", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "conflict",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative], tasks());
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  await assert.rejects(
    () =>
      uc.execute({
        objectiveId: OBJ_ID,
        expectedCommit: "0".repeat(40),
        dryRun: true,
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError, not ImpactChangedError; got: ${(err as Error).constructor.name}`,
      );
      assert.ok(
        !(err instanceof ImpactChangedError),
        "must never be ImpactChangedError — the 012 guard runs first",
      );
      return true;
    },
  );
  assert.equal(store.savedObjectives.length, 0);
  assert.equal(store.savedTasks.length, 0);
  assert.equal(feed.events.length, 0);
});

test("(017-S3-obj-initiative-cascade-in-preview) RejectObjective discard --dry-run: preview names the initiative when the all-siblings-terminal rule fires, and omits it when a sibling is still building", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "conflict",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const store = new MemStore([objective], [initiative], tasks());
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new MemUow());

  const result = await uc.execute({
    objectiveId: OBJ_ID,
    expectedCommit: "REVIEWED_OID",
    dryRun: true,
  });
  const initiativeDamage = result.preview.damage.find(
    (d) => d.target.id === INI_ID,
  );
  assert.equal(
    initiativeDamage?.effect,
    "discarded-by-cascade",
    "the sole objective's discard must cascade to the initiative",
  );

  const OBJ_ID_2 = "01JZZZZZZZZZZZZZZZZZZZOBJRT";
  const otherObjective: Objective = {
    id: OBJ_ID_2,
    initiativeId: INI_ID,
    name: "O2",
    status: "building",
  };
  const store2 = new MemStore(
    [objective, otherObjective],
    [initiative],
    tasks(),
  );
  const feed2 = new MemFeed();
  const uc2 = new RejectObjective(store2, feed2, new MemUow());
  const result2 = await uc2.execute({
    objectiveId: OBJ_ID,
    expectedCommit: "REVIEWED_OID",
    dryRun: true,
  });
  const initiativeDamage2 = result2.preview.damage.find(
    (d) => d.target.id === INI_ID,
  );
  assert.equal(
    initiativeDamage2,
    undefined,
    "the initiative must not be reported when a sibling objective is still building",
  );
});

test("(017-S3-obj-in-transaction-recheck) RejectObjective discard: a store whose listTasksByInitiative changes between the pre-check and the in-transaction re-check is refused with ImpactChangedError, no objective saved", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "O",
    status: "conflict",
    commitOid: "REVIEWED_OID",
  };
  const initiative: Initiative = {
    id: INI_ID,
    projectId: "proj-1",
    name: "I",
    paused: false,
    status: "building",
  };
  const extraTask: Task = {
    id: "01JZZZZZZZZZZZZZZZZZZZTXTR1",
    objectiveId: OBJ_ID,
    title: "a task that appears only on the second read",
    status: "pending",
    dependencies: [],
  };

  const flag = new TransactionFlag();
  const store = new VaryingStore(
    [objective],
    [initiative],
    tasks(),
    [...tasks(), extraTask],
    flag,
  );
  const feed = new MemFeed();
  const uc = new RejectObjective(store, feed, new FlaggingUow(flag));

  const preview = await uc.execute({
    objectiveId: OBJ_ID,
    expectedCommit: "REVIEWED_OID",
    dryRun: true,
  });
  const staleDigest = preview.preview.digest;

  await assert.rejects(
    () =>
      uc.execute({
        objectiveId: OBJ_ID,
        expectedCommit: "REVIEWED_OID",
        expectImpact: staleDigest,
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof ImpactChangedError,
        `must be ImpactChangedError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
    "a graph that changed between the pre-check and the in-transaction re-check must be refused",
  );
  assert.equal(
    store.savedObjectives.length,
    0,
    "the in-transaction re-check must run before any objective is saved",
  );
});
