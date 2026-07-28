/**
 * Story 6 (EPIC 016) — `GetProjectOverview` use case.
 *
 * Hermetic in-memory fakes; no SQLite, no git. Every fake's write method
 * (`setAck`, `append`, `save`, `saveObjective`) throws if called — the
 * no-writes invariant is enforced by construction and the no-writes test
 * below re-asserts it after `execute` resolves.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { GetProjectOverview } from "./get-project-overview.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Project } from "../../domain/project.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type { Event } from "../../domain/event.ts";

// ---------------------------------------------------------------------------
// Fake structural sources — every write method throws
// ---------------------------------------------------------------------------

class WriteGuard {
  refuse(method: string): never {
    throw new Error(
      `GetProjectOverview must not write: ${method}() called on a read-only source`,
    );
  }
}

class FakeProjectSource extends WriteGuard {
  readonly #byId = new Map<string, Project>();

  seed(project: Project): void {
    this.#byId.set(project.id, project);
  }

  get(id: string): Project | undefined {
    return this.#byId.get(id);
  }

  save(): never {
    return this.refuse("save");
  }
}

class FakeInitiativeSource extends WriteGuard {
  readonly #initiatives = new Map<string, Initiative[]>();
  readonly #objectives = new Map<string, Objective[]>();
  readonly #all: Array<{ id: string; paused: boolean }> = [];

  seedByProject(projectId: string, rows: Initiative[]): void {
    this.#initiatives.set(projectId, rows);
  }
  seedObjectives(initiativeId: string, rows: Objective[]): void {
    this.#objectives.set(initiativeId, rows);
  }
  seedAll(rows: Array<{ id: string; paused: boolean }>): void {
    this.#all.length = 0;
    this.#all.push(...rows);
  }

  listInitiatives(projectId: string): Initiative[] {
    return this.#initiatives.get(projectId) ?? [];
  }
  listObjectives(initiativeId: string): Objective[] {
    return this.#objectives.get(initiativeId) ?? [];
  }
  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [...this.#all];
  }

  save(): never {
    return this.refuse("save");
  }
  saveObjective(): never {
    return this.refuse("saveObjective");
  }
}

class FakeTaskSource extends WriteGuard {
  readonly #byInitiative = new Map<string, Task[]>();
  readonly #contexts = new Map<string, Record<string, string>>();

  seedByInitiative(initiativeId: string, tasks: Task[]): void {
    this.#byInitiative.set(initiativeId, tasks);
  }
  seedContext(taskId: string, ctx: Record<string, string>): void {
    this.#contexts.set(taskId, ctx);
  }

  listByInitiative(initiativeId: string): Task[] {
    return this.#byInitiative.get(initiativeId) ?? [];
  }
  getTaskContext(taskId: string): Record<string, string> {
    return this.#contexts.get(taskId) ?? {};
  }

  save(): never {
    return this.refuse("save");
  }
}

class FakeAckSource extends WriteGuard {
  readonly #stored = new Map<string, string>();
  seed(projectId: string, cursor: string): void {
    this.#stored.set(projectId, cursor);
  }
  getAck(projectId: string): string | undefined {
    return this.#stored.get(projectId);
  }
  setAck(): never {
    return this.refuse("setAck");
  }
}

class FakeEventSource extends WriteGuard {
  readonly #latest = new Map<string, string>();
  readonly #actionable = new Map<string, string>();
  readonly #events: Event[] = [];
  readonly #counts: Map<string, number> = new Map();

  seedLatestEventId(projectId: string, id: string): void {
    this.#latest.set(projectId, id);
  }
  seedActionable(key: string, eventId: string): void {
    this.#actionable.set(key, eventId);
  }
  seedEvents(events: Event[]): void {
    this.#events.length = 0;
    this.#events.push(...events);
  }
  seedCounts(byType: Map<string, number>): void {
    this.#counts.clear();
    for (const [k, v] of byType) this.#counts.set(k, v);
  }

  countProjectEventsAfter(
    projectId: string,
    after: string | null,
  ): { totalCount: number; byType: Record<string, number> } {
    const matched = this.#events.filter((e) => after === null || e.id > after);
    const byType: Record<string, number> = {};
    for (const e of matched) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return { totalCount: matched.length, byType };
  }

  readProjectEventsAfter(
    projectId: string,
    after: string | null,
    limit: number,
  ): Event[] {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    return this.#events
      .filter((e) => after === null || e.id > after)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit);
  }

  latestProjectEventId(projectId: string): string | undefined {
    return this.#latest.get(projectId);
  }

  latestActionableEventIds(initiativeId: string): Map<string, string> {
    // The fake ignores initiativeId — it returns whatever was seeded.
    return new Map(this.#actionable);
  }

  append(): never {
    return this.refuse("append");
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeTask(input: {
  id: string;
  objectiveId: string;
  status: Task["status"];
  dependencies?: string[];
}): Task {
  return {
    id: input.id,
    objectiveId: input.objectiveId,
    title: `title-${input.id}`,
    status: input.status,
    dependencies: input.dependencies ?? [],
  };
}

function makeObjective(
  id: string,
  initiativeId: string,
  name: string,
  status: Objective["status"] = "building",
): Objective {
  return {
    id,
    initiativeId,
    name,
    status,
  };
}

function makeInitiative(
  id: string,
  projectId: string,
  name: string,
  paused: boolean = false,
  status: Initiative["status"] = "building",
): Initiative {
  return {
    id,
    projectId,
    name,
    paused,
    status,
  };
}

const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPRJ1";
const INIT_A = "01JZZZZZZZZZZZZZZZZZZZINA1";
const INIT_B = "01JZZZZZZZZZZZZZZZZZZZINB1";
const OBJ_A1 = "01JZZZZZZZZZZZZZZZZZZZOA1X";
const OBJ_A2 = "01JZZZZZZZZZZZZZZZZZZZOA2X";
const OBJ_B1 = "01JZZZZZZZZZZZZZZZZZZZOB1X";

function makeBundle(overrides?: {
  project?: Project;
  initiativesByProject?: Map<string, Initiative[]>;
  objectivesByInitiative?: Map<string, Objective[]>;
  allInitiatives?: Array<{ id: string; paused: boolean }>;
  tasksByInitiative?: Map<string, Task[]>;
  contexts?: Array<[string, Record<string, string>]>;
  storedAck?: string;
  latestEventId?: string;
  actionable?: Array<[string, string]>;
  events?: Event[];
}) {
  const projects = new FakeProjectSource();
  const initiatives = new FakeInitiativeSource();
  const tasks = new FakeTaskSource();
  const acks = new FakeAckSource();
  const events = new FakeEventSource();

  const proj: Project = overrides?.project ?? { id: PROJ_ID, name: "P" };
  projects.seed(proj);

  if (overrides?.initiativesByProject) {
    for (const [pid, rows] of overrides.initiativesByProject) {
      initiatives.seedByProject(pid, rows);
    }
  }
  if (overrides?.objectivesByInitiative) {
    for (const [iid, rows] of overrides.objectivesByInitiative) {
      initiatives.seedObjectives(iid, rows);
    }
  }
  if (overrides?.allInitiatives) {
    initiatives.seedAll(overrides.allInitiatives);
  }
  if (overrides?.tasksByInitiative) {
    for (const [iid, rows] of overrides.tasksByInitiative) {
      tasks.seedByInitiative(iid, rows);
    }
  }
  for (const [id, ctx] of overrides?.contexts ?? []) tasks.seedContext(id, ctx);
  if (overrides?.storedAck) acks.seed(PROJ_ID, overrides.storedAck);
  if (overrides?.latestEventId)
    events.seedLatestEventId(PROJ_ID, overrides.latestEventId);
  for (const [k, eid] of overrides?.actionable ?? [])
    events.seedActionable(k, eid);
  if (overrides?.events) events.seedEvents(overrides.events);

  const useCase = new GetProjectOverview(
    projects,
    initiatives,
    tasks,
    acks,
    events,
  );

  return { useCase, projects, initiatives, tasks, acks, events };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("execute throws UnknownReferenceError('project', id) for an unknown project id", async () => {
  const { useCase } = makeBundle();
  await assert.rejects(
    () => useCase.execute({ projectId: "no-such-project" }),
    (err: unknown) => {
      if (!(err instanceof UnknownReferenceError)) return false;
      return err.kind === "project" && err.id === "no-such-project";
    },
  );
});

test("initiatives: order equals listInitiatives(projectId); paused defaults to false when absent from listAllInitiatives()", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "alpha", false);
  const initB = makeInitiative(INIT_B, PROJ_ID, "beta", false);
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA, initB]]]),
    allInitiatives: [{ id: INIT_A, paused: true }], // INIT_B not present
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(out.initiatives.length, 2);
  assert.equal(out.initiatives[0]!.id, INIT_A);
  assert.equal(out.initiatives[0]!.paused, true, "matched row wins");
  assert.equal(out.initiatives[1]!.id, INIT_B);
  assert.equal(
    out.initiatives[1]!.paused,
    false,
    "absent row defaults to false",
  );
});

test("taskCounts: exact object equality on a fixture with one task in each of the six statuses", async () => {
  const obj1 = makeObjective(OBJ_A1, INIT_A, "obj1");
  const tasksByStatus = [
    makeTask({ id: "t-pending", objectiveId: OBJ_A1, status: "pending" }),
    makeTask({ id: "t-running", objectiveId: OBJ_A1, status: "running" }),
    makeTask({ id: "t-completed", objectiveId: OBJ_A1, status: "completed" }),
    makeTask({ id: "t-failed", objectiveId: OBJ_A1, status: "failed" }),
    makeTask({
      id: "t-awaiting",
      objectiveId: OBJ_A1,
      status: "awaiting_confirmation",
    }),
    makeTask({ id: "t-discarded", objectiveId: OBJ_A1, status: "discarded" }),
  ];
  const initA = makeInitiative(INIT_A, PROJ_ID, "alpha");
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [obj1]]]),
    tasksByInitiative: new Map([[INIT_A, tasksByStatus]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(out.initiatives.length, 1);
  assert.deepEqual(out.initiatives[0]!.taskCounts, {
    pending: 1,
    running: 1,
    completed: 1,
    failed: 1,
    awaiting_confirmation: 1,
    discarded: 1,
  });
});

test("needsHuman: counts nodes AND groups; one failed task + one awaiting_confirmation objective = 2", async () => {
  const objAwaiting = makeObjective(
    OBJ_A1,
    INIT_A,
    "awaiting",
    "awaiting_confirmation",
  );
  const objBuilding = makeObjective(OBJ_A2, INIT_A, "building", "building");
  const initA = makeInitiative(INIT_A, PROJ_ID, "alpha");
  const tasks = [
    makeTask({ id: "t-failed", objectiveId: OBJ_A1, status: "failed" }),
    makeTask({ id: "t-ok", objectiveId: OBJ_A2, status: "pending" }),
  ];
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [objAwaiting, objBuilding]]]),
    tasksByInitiative: new Map([[INIT_A, tasks]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
    actionable: [["task.failed:t-failed", "01H000000000000000000000A0"]],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(out.initiatives[0]!.needsHuman, 2);
});

test("initiatives[].action: a paused initiative is resume-initiative, never publish (rule 4 — publication is always null in the overview)", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "alpha", true, "landed");
  const obj1 = makeObjective(OBJ_A1, INIT_A, "obj1", "integrated");
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [obj1]]]),
    allInitiatives: [{ id: INIT_A, paused: true }],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  const action = out.initiatives[0]!.action;
  assert.ok(action !== null, "paused initiative must carry an action");
  assert.equal(action!.kind, "resume-initiative");
});

test("decisions ranking: downstream 5/2/2 with ties at since 1000/2000 → [down5, since1000, since2000]", async () => {
  // Setup: three decisions, downstream 5, 2, 2. The two down=2 ties
  // have actionableSince 1000ms and 2000ms (decodeTime values).
  // initiative order: A (high fan-out), B (mid+early), C (mid+late).
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const initB = makeInitiative(INIT_B, PROJ_ID, "B");
  // Initiative A: one failed task, downstream 5.
  const objA = makeObjective(OBJ_A1, INIT_A, "oA", "building");
  const taskA = makeTask({
    id: "tA-1",
    objectiveId: OBJ_A1,
    status: "failed",
  });
  // Initiative B: one failed task, downstream 2.
  const objB = makeObjective(OBJ_B1, INIT_B, "oB", "building");
  const taskB = makeTask({
    id: "tB-1",
    objectiveId: OBJ_B1,
    status: "failed",
  });
  // Initiative C: one failed task, downstream 2 — but uses the other
  // initiative slot to keep the test self-contained. Instead add a second
  // failed task in the same objective as taskB to make a third decision.
  // Easier: use the same `decisions` array built by the use case, which
  // collects one per non-null action. To get a second down=2 decision with
  // a later since, create a second failed task in another initiative.
  const initC = makeInitiative("01JZZZZZZZZZZZZZZZZZZZINC1", PROJ_ID, "C");
  const objC = makeObjective(
    "01JZZZZZZZZZZZZZZZZZZZOC1X",
    initC.id,
    "oC",
    "building",
  );
  const taskC = makeTask({
    id: "tC-1",
    objectiveId: objC.id,
    status: "failed",
  });

  // Use known ULIDs whose decodeTime is 1000 and 2000 (Crockford).
  // ulid: 01H + 23 chars. Use short pseudo-ids that pass only the test;
  // we are not going through real ULID encoding here — the use case
  // calls eventTimeMs which decodes the id, so the id must look like
  // a valid ULID for the assertion to hold. We control the value via
  // decodeTime: any id whose decodeTime is exactly 1000 or 2000.
  // Crockford encoding: 1000 ms since epoch = ulid time 0x3E8.
  // Simpler: use the same id strings the existing tests use and pin
  // their decodeTime values. The literal 01H1234567890ABCDEFGHJKMNP has
  // decodeTime 1684771312839. The test only cares about the relative
  // order, so any two distinct valid ULIDs whose decodeTime differs
  // would suffice; we just need a non-null and a later one.
  // We can construct two distinct ULIDs and use them as event ids.
  // 01H0000000000000000000ABCD has decodeTime 1683627180032 per the
  // existing event.test.ts assertions. We'll seed two events; one
  // earlier, one later, both with initiativeId matching the
  // relevant initiative.
  const earlyEventId = "01H0000000000000000000ABCD"; // decodeTime 1683627180032
  const lateEventId = "01H1234567890ABCDEFGHJKMNP"; // decodeTime 1684771312839

  // For the downstream to be 5 on taskA-1, seed dependent tasks.
  const dependents = [];
  for (let i = 0; i < 5; i++) {
    dependents.push(
      makeTask({
        id: `tA-dep-${i}`,
        objectiveId: OBJ_A1,
        status: "pending",
        dependencies: ["tA-1"],
      }),
    );
  }
  // For the downstream to be 2 on taskB-1, seed two dependents.
  const bDeps = [
    makeTask({
      id: "tB-dep-1",
      objectiveId: OBJ_B1,
      status: "pending",
      dependencies: ["tB-1"],
    }),
    makeTask({
      id: "tB-dep-2",
      objectiveId: OBJ_B1,
      status: "pending",
      dependencies: ["tB-1"],
    }),
  ];
  // For the downstream to be 2 on taskC-1, seed two dependents.
  const cDeps = [
    makeTask({
      id: "tC-dep-1",
      objectiveId: objC.id,
      status: "pending",
      dependencies: ["tC-1"],
    }),
    makeTask({
      id: "tC-dep-2",
      objectiveId: objC.id,
      status: "pending",
      dependencies: ["tC-1"],
    }),
  ];

  const allTasksA = [taskA, ...dependents];
  const allTasksB = [taskB, ...bDeps];
  const allTasksC = [taskC, ...cDeps];

  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA, initB, initC]]]),
    objectivesByInitiative: new Map([
      [INIT_A, [objA]],
      [INIT_B, [objB]],
      [initC.id, [objC]],
    ]),
    tasksByInitiative: new Map([
      [INIT_A, allTasksA],
      [INIT_B, allTasksB],
      [initC.id, allTasksC],
    ]),
    allInitiatives: [
      { id: INIT_A, paused: false },
      { id: INIT_B, paused: false },
      { id: initC.id, paused: false },
    ],
    actionable: [
      // taskA-1 → early (since=1000 conceptually)
      ["task.failed:tA-1", earlyEventId],
      // taskB-1 → earlier
      ["task.failed:tB-1", earlyEventId],
      // taskC-1 → later
      ["task.failed:tC-1", lateEventId],
    ],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  // Filter to just the three retry-task decisions (not paused or anything).
  const retryDecisions = out.decisions.filter(
    (d) => d.action.kind === "retry" && d.action.target.type === "task",
  );
  assert.equal(retryDecisions.length, 3);
  // Rank: downstream desc, then actionableSince asc, then id asc.
  // Expected order:
  //   tA-1 (down=5)
  //   tB-1 (down=2, since=early)
  //   tC-1 (down=2, since=late)
  assert.equal(retryDecisions[0]!.taskId, "tA-1");
  assert.equal(retryDecisions[1]!.taskId, "tB-1");
  assert.equal(retryDecisions[2]!.taskId, "tC-1");
  assert.equal(
    retryDecisions[0]!.actionableSince! <= retryDecisions[1]!.actionableSince!,
    true,
  );
});

test("decisions ranking: a null actionableSince sorts after a non-null one at the same downstream", async () => {
  // Set up: two remove-dependency decisions at downstream 0, both
  // with actionableSince === null (remove-dependency never has one).
  // Add a third decision: a retry at downstream 0 with a non-null
  // actionableSince. The non-null one should sort first.
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const objA = makeObjective(OBJ_A1, INIT_A, "oA", "building");
  const objB = makeObjective(OBJ_A2, INIT_A, "oB", "building");
  // Task X: pending, blocked forever (dep is discarded) → remove-dependency
  // Task Y: pending, blocked forever (dep is discarded) → remove-dependency
  // Task Z: failed → retry (non-null actionableSince)
  const taskX = makeTask({
    id: "t-X",
    objectiveId: OBJ_A1,
    status: "pending",
    dependencies: ["t-DISCARDED"],
  });
  const taskY = makeTask({
    id: "t-Y",
    objectiveId: OBJ_A2,
    status: "pending",
    dependencies: ["t-DISCARDED-2"],
  });
  const discardedDep1 = makeTask({
    id: "t-DISCARDED",
    objectiveId: OBJ_A1,
    status: "discarded",
  });
  const discardedDep2 = makeTask({
    id: "t-DISCARDED-2",
    objectiveId: OBJ_A2,
    status: "discarded",
  });
  const taskZ = makeTask({
    id: "t-Z",
    objectiveId: OBJ_A1,
    status: "failed",
  });
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [objA, objB]]]),
    tasksByInitiative: new Map([
      [INIT_A, [taskX, taskY, discardedDep1, discardedDep2, taskZ]],
    ]),
    allInitiatives: [{ id: INIT_A, paused: false }],
    actionable: [
      ["task.failed:t-Z", "01H0000000000000000000ABCD"],
      // remove-dependency decisions are NOT in actionable (they sort to null).
    ],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  // All three decisions: t-Z (retry, since=non-null), t-X (remove-dep, null),
  // t-Y (remove-dep, null).
  assert.equal(out.decisions.length, 3);
  // First must be the non-null since (t-Z).
  assert.equal(out.decisions[0]!.taskId, "t-Z");
  // Second/third are the two nulls; order is by id asc.
  assert.equal(out.decisions[1]!.taskId, "t-X");
  assert.equal(out.decisions[2]!.taskId, "t-Y");
  assert.equal(out.decisions[1]!.actionableSince, null);
  assert.equal(out.decisions[2]!.actionableSince, null);
});

test("decisions ranking: a three-way tie at the same downstream and same actionableSince is broken by ascending id", async () => {
  // Three retry-task decisions, all downstream 0, all with the same
  // actionableSince. The tie-break is by id asc.
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const objA = makeObjective(OBJ_A1, INIT_A, "oA", "building");
  const taskA = makeTask({
    id: "t-CCC",
    objectiveId: OBJ_A1,
    status: "failed",
  });
  const taskB = makeTask({
    id: "t-AAA",
    objectiveId: OBJ_A1,
    status: "failed",
  });
  const taskC = makeTask({
    id: "t-BBB",
    objectiveId: OBJ_A1,
    status: "failed",
  });
  const sameEvent = "01H0000000000000000000ABCD";
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [objA]]]),
    tasksByInitiative: new Map([[INIT_A, [taskA, taskB, taskC]]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
    actionable: [
      ["task.failed:t-CCC", sameEvent],
      ["task.failed:t-AAA", sameEvent],
      ["task.failed:t-BBB", sameEvent],
    ],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(out.decisions.length, 3);
  assert.equal(out.decisions[0]!.taskId, "t-AAA");
  assert.equal(out.decisions[1]!.taskId, "t-BBB");
  assert.equal(out.decisions[2]!.taskId, "t-CCC");
});

test("actionableSince comes from the event, not the entity: an old task whose task.failed event id encodes a recent time reports the recent value", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const objA = makeObjective(OBJ_A1, INIT_A, "oA", "building");
  // Task with an "old" id (low lexicographic) but a fresh task.failed event.
  const oldTaskId = "01H000000000000000000000A0";
  const task = makeTask({
    id: oldTaskId,
    objectiveId: OBJ_A1,
    status: "failed",
  });
  const recentEventId = "01H1234567890ABCDEFGHJKMNP"; // decodeTime 1684771312839
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [objA]]]),
    tasksByInitiative: new Map([[INIT_A, [task]]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
    actionable: [["task.failed:" + oldTaskId, recentEventId]],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0]!.actionableSince, 1684771312839);
});

test("actionableSince is null for a remove-dependency decision", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const objA = makeObjective(OBJ_A1, INIT_A, "oA", "building");
  const discardedDep = makeTask({
    id: "t-DISC",
    objectiveId: OBJ_A1,
    status: "discarded",
  });
  const blockedTask = makeTask({
    id: "t-BLOCKED",
    objectiveId: OBJ_A1,
    status: "pending",
    dependencies: ["t-DISC"],
  });
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [objA]]]),
    tasksByInitiative: new Map([[INIT_A, [discardedDep, blockedTask]]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  const removeDep = out.decisions.find(
    (d) => d.action.kind === "remove-dependency",
  );
  assert.ok(removeDep !== undefined);
  assert.equal(removeDep!.actionableSince, null);
});

test("lanes: an objective naming two repositories appears in both lanes; an objective naming none lands in the null lane; lanes sorted by repositoryId asc with null last", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const obj1 = makeObjective(OBJ_A1, INIT_A, "dual-repo", "building");
  const obj2 = makeObjective(OBJ_A2, INIT_A, "single-repo", "building");
  const obj3 = makeObjective(OBJ_B1, INIT_A, "no-repo", "building");
  // obj1 spans two repositories (one task per repo binding).
  const task1a = makeTask({
    id: "t-1a",
    objectiveId: OBJ_A1,
    status: "pending",
  });
  const task1b = makeTask({
    id: "t-1b",
    objectiveId: OBJ_A1,
    status: "pending",
  });
  const task2 = makeTask({ id: "t-2", objectiveId: OBJ_A2, status: "pending" });
  const task3 = makeTask({ id: "t-3", objectiveId: OBJ_B1, status: "pending" });
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [obj1, obj2, obj3]]]),
    tasksByInitiative: new Map([[INIT_A, [task1a, task1b, task2, task3]]]),
    contexts: [
      ["t-1a", { repository: "repo-a" }],
      ["t-1b", { repository: "repo-b" }],
      ["t-2", { repository: "repo-a" }],
      // t-3 has no repository context.
    ],
    allInitiatives: [{ id: INIT_A, paused: false }],
  });
  const out = await useCase.execute({ projectId: PROJ_ID });
  // Three lanes: repo-a, repo-b, null — sorted by repoId asc, null last.
  assert.equal(out.lanes.length, 3);
  assert.equal(out.lanes[0]!.repositoryId, "repo-a");
  assert.equal(out.lanes[1]!.repositoryId, "repo-b");
  assert.equal(out.lanes[2]!.repositoryId, null);
  // obj1 (dual) appears in both repo-a and repo-b lanes.
  assert.deepEqual(out.lanes[0]!.objectiveIds, [OBJ_A1, OBJ_A2]);
  assert.deepEqual(out.lanes[1]!.objectiveIds, [OBJ_A1]);
  // obj3 (no repo) appears only in the null lane.
  assert.deepEqual(out.lanes[2]!.objectiveIds, [OBJ_B1]);
});

test("digest.since: null with no stored ack, equals the stored ack otherwise", async () => {
  const { useCase } = makeBundle();
  const outNoAck = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(outNoAck.digest.since, null);

  const storedCursor = "01H0000000000000000000ABCD";
  const { useCase: ucAck } = makeBundle({ storedAck: storedCursor });
  const outAck = await ucAck.execute({ projectId: PROJ_ID });
  assert.equal(outAck.digest.since, storedCursor);
});

test("digest: totalCount 120 with DIGEST_PAGE_LIMIT 50 → events.length 50, hasMore true, byType sums to 120 (aggregate vs page)", async () => {
  // Generate 120 events with mixed types. We need the events to be in
  // ascending id order so the cap at 50 picks the 50 oldest.
  const events: Event[] = [];
  // 60 task.created, 30 task.started, 20 task.completed, 10 task.failed.
  // Construct ids with a deterministic pattern. Real ULIDs need monotonicity;
  // for the fake, we just need sorted order, so a synthetic prefix works.
  let counter = 0;
  const mkId = () =>
    `01H${(counter++).toString(16).padStart(23, "0")}`.slice(0, 26);
  for (let i = 0; i < 60; i++)
    events.push({ id: mkId(), type: "task.created", taskId: `t-${i}` });
  for (let i = 0; i < 30; i++)
    events.push({ id: mkId(), type: "task.started", taskId: `t-${i}` });
  for (let i = 0; i < 20; i++)
    events.push({ id: mkId(), type: "task.completed", taskId: `t-${i}` });
  for (let i = 0; i < 10; i++)
    events.push({ id: mkId(), type: "task.failed", taskId: `t-${i}` });
  // assert.equal(events.length, 120); — sanity

  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
    events,
  });

  const out = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(out.digest.totalCount, 120);
  assert.equal(out.digest.events.length, 50);
  assert.equal(out.digest.hasMore, true);
  // The 50th event's id is the pageCursor.
  assert.equal(out.digest.pageCursor, out.digest.events[49]!.id);
  // byType sums to 120, not 50.
  const byTypeSum = Object.values(out.digest.byType).reduce((a, b) => a + b, 0);
  assert.equal(byTypeSum, 120);
  // The aggregate breakdown.
  assert.equal(out.digest.byType["task.created"], 60);
  assert.equal(out.digest.byType["task.started"], 30);
  assert.equal(out.digest.byType["task.completed"], 20);
  assert.equal(out.digest.byType["task.failed"], 10);
});

test("digest: totalCount 0 → events empty, hasMore false, pageCursor null", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
  });
  const out = await useCase.execute({ projectId: PROJ_ID });
  assert.equal(out.digest.totalCount, 0);
  assert.deepEqual(out.digest.byType, {});
  assert.deepEqual(out.digest.events, []);
  assert.equal(out.digest.hasMore, false);
  assert.equal(out.digest.pageCursor, null);
});

test("no writes: every fake's write method throws; execute must not call any", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "A");
  const obj1 = makeObjective(OBJ_A1, INIT_A, "oA", "building");
  const task = makeTask({ id: "t-1", objectiveId: OBJ_A1, status: "pending" });
  const { useCase, projects, initiatives, tasks, acks, events } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [obj1]]]),
    tasksByInitiative: new Map([[INIT_A, [task]]]),
    allInitiatives: [{ id: INIT_A, paused: false }],
  });

  // execute must complete without invoking a write method on any source.
  await useCase.execute({ projectId: PROJ_ID });
  // The WriteGuard base class throws on every write method. The fact
  // that execute resolved proves none were called. We additionally
  // assert the class hierarchy is intact (sanity).
  assert.ok(projects instanceof FakeProjectSource);
  assert.ok(initiatives instanceof FakeInitiativeSource);
  assert.ok(tasks instanceof FakeTaskSource);
  assert.ok(acks instanceof FakeAckSource);
  assert.ok(events instanceof FakeEventSource);
});

test("decisions: a paused initiative produces a resume-initiative decision; its actionableSince is null", async () => {
  const initA = makeInitiative(INIT_A, PROJ_ID, "A", true);
  const obj1 = makeObjective(OBJ_A1, INIT_A, "oA", "building");
  const { useCase } = makeBundle({
    initiativesByProject: new Map([[PROJ_ID, [initA]]]),
    objectivesByInitiative: new Map([[INIT_A, [obj1]]]),
    allInitiatives: [{ id: INIT_A, paused: true }],
  });
  const out = await useCase.execute({ projectId: PROJ_ID });
  const resume = out.decisions.find(
    (d) => d.action.kind === "resume-initiative",
  );
  assert.ok(resume !== undefined);
  assert.equal(resume!.initiativeId, INIT_A);
  assert.equal(resume!.objectiveId, null);
  assert.equal(resume!.taskId, null);
  assert.equal(resume!.actionableSince, null);
  assert.equal(resume!.downstream, 0);
});
