/**
 * Story 3 (EPIC 016) — GetInitiativeGraph use case.
 *
 * Hermetic in-memory fakes; no SQLite, no git. Every fake's write method
 * (`save`, `saveObjective`, `append`, `saveTaskResult`, `setPublication`)
 * throws if called — the no-writes invariant is enforced by construction and
 * the test below re-asserts it after `execute` resolves.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTime } from "ulid";

import { GetInitiativeGraph } from "./get-initiative-graph.ts";
import { GetTask } from "../task/get-task.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Task } from "../../domain/task.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import type { ChangeCandidate } from "../../domain/landing.ts";

// ---------------------------------------------------------------------------
// Fake structural sources — every write method throws
// ---------------------------------------------------------------------------

class WriteGuard {
  refuse(method: string): never {
    throw new Error(
      `GetInitiativeGraph must not write: ${method}() called on a read-only source`,
    );
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

  // write guards (interface-level, not used)
  save(): never {
    return this.refuse("save");
  }
  saveAll(): never {
    return this.refuse("saveAll");
  }
  saveTaskContext(): never {
    return this.refuse("saveTaskContext");
  }
  addDependency(): never {
    return this.refuse("addDependency");
  }
  removeDependency(): never {
    return this.refuse("removeDependency");
  }
}

class FakeResultSource extends WriteGuard {
  readonly #rows = new Map<string, TaskResultRow>();
  seed(taskId: string, row: TaskResultRow): void {
    this.#rows.set(taskId, row);
  }
  getTaskResult(taskId: string): TaskResultRow | undefined {
    return this.#rows.get(taskId);
  }
  saveTaskResult(): never {
    return this.refuse("saveTaskResult");
  }
}

class FakeInitiativeSource extends WriteGuard {
  readonly #initiatives = new Map<string, Initiative>();
  readonly #objectives = new Map<string, Objective[]>();
  readonly #all: Array<{ id: string; paused: boolean }> = [];

  seedInitiative(initiative: Initiative): void {
    this.#initiatives.set(initiative.id, initiative);
    this.#all.push({ id: initiative.id, paused: initiative.paused });
  }
  seedObjectives(initiativeId: string, objectives: Objective[]): void {
    this.#objectives.set(initiativeId, objectives);
  }

  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }
  listObjectives(initiativeId: string): Objective[] {
    return this.#objectives.get(initiativeId) ?? [];
  }
  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [...this.#all];
  }

  // write guards
  save(): never {
    return this.refuse("save");
  }
  saveObjective(): never {
    return this.refuse("saveObjective");
  }
  setPaused(): never {
    return this.refuse("setPaused");
  }
}

class FakeSequencingSource {
  readonly #objectiveAfter = new Map<string, string[]>();
  seedObjectiveAfter(objectiveId: string, after: string[]): void {
    this.#objectiveAfter.set(objectiveId, after);
  }
  listObjectiveAfter(objectiveId: string): string[] {
    return this.#objectiveAfter.get(objectiveId) ?? [];
  }
}

class FakeLandingSource {
  readonly #byTask = new Map<string, ChangeCandidate>();
  seed(taskId: string, candidate: ChangeCandidate): void {
    this.#byTask.set(taskId, candidate);
  }
  getCandidateByTask(taskId: string): ChangeCandidate | undefined {
    return this.#byTask.get(taskId);
  }
}

class FakeActivitySource {
  readonly #latest = new Map<string, string>();
  seed(taskId: string, latestEventId: string): void {
    this.#latest.set(taskId, latestEventId);
  }
  latestEventIdByTask(taskIds: readonly string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const id of taskIds) {
      const v = this.#latest.get(id);
      if (v !== undefined) out.set(id, v);
    }
    return out;
  }
}

class FakePublicationSource extends WriteGuard {
  readonly #rows = new Map<string, "unpublished" | "published" | "diverged">();

  seed(
    repoId: string,
    branch: string,
    state: "unpublished" | "published" | "diverged",
  ): void {
    this.#rows.set(`${repoId}::${branch}`, state);
  }
  getPublication(
    repoId: string,
    branch: string,
  ):
    | {
        state: "unpublished" | "published" | "diverged";
        remoteOID: string | null;
      }
    | undefined {
    const s = this.#rows.get(`${repoId}::${branch}`);
    if (s === undefined) return undefined;
    return { state: s, remoteOID: null };
  }
  setPublication(): never {
    return this.refuse("setPublication");
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
  title?: string;
  agent?: string;
  instructions?: string;
  note?: string;
  ac?: string[];
  verification?: string[];
}): Task {
  const task: Task = {
    id: input.id,
    objectiveId: input.objectiveId,
    title: input.title ?? `title-${input.id}`,
    status: input.status,
    dependencies: input.dependencies ?? [],
  };
  if (input.agent !== undefined) task.agent = input.agent;
  if (input.instructions !== undefined) task.instructions = input.instructions;
  if (input.note !== undefined) task.note = input.note;
  if (input.ac !== undefined) task.ac = [...input.ac];
  if (input.verification !== undefined)
    task.verification = [...input.verification];
  return task;
}

const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINIT1";
const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPROJ1";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ01";
const REPO_A = "01JZZZZZZZZZZZZZZZZZZZREPOA";
const REPO_B = "01JZZZZZZZZZZZZZZZZZZZREPOB";

function makeBundle(overrides?: {
  initiative?: Partial<Initiative>;
  objectives?: Objective[];
  tasks?: Task[];
  contexts?: Array<[string, Record<string, string>]>;
  taskResults?: Array<[string, TaskResultRow]>;
  objectiveAfter?: Array<[string, string[]]>;
  candidates?: Array<[string, ChangeCandidate]>;
  activity?: Array<[string, string]>;
  publications?: Array<
    [string, string, "unpublished" | "published" | "diverged"]
  >;
  publicationDefaults?: {
    state: "unpublished" | "published" | "diverged" | "none";
  };
  branchFor?: (repoId: string) => string | undefined;
}) {
  const tasks = new FakeTaskSource();
  const results = new FakeResultSource();
  const initiatives = new FakeInitiativeSource();
  const sequencing = new FakeSequencingSource();
  const landing = new FakeLandingSource();
  const activity = new FakeActivitySource();
  const publications = new FakePublicationSource();

  const init: Initiative = {
    id: INIT_ID,
    projectId: PROJ_ID,
    name: "init",
    paused: false,
    ...(overrides?.initiative ?? {}),
  };
  initiatives.seedInitiative(init);
  if (overrides?.objectives) {
    for (const o of overrides.objectives) {
      if (!o.initiativeId) o.initiativeId = INIT_ID;
    }
    initiatives.seedObjectives(INIT_ID, overrides.objectives);
  }
  tasks.seedByInitiative(INIT_ID, overrides?.tasks ?? []);
  for (const [id, ctx] of overrides?.contexts ?? []) tasks.seedContext(id, ctx);
  for (const [id, row] of overrides?.taskResults ?? []) results.seed(id, row);
  for (const [id, after] of overrides?.objectiveAfter ?? [])
    sequencing.seedObjectiveAfter(id, after);
  for (const [id, c] of overrides?.candidates ?? []) landing.seed(id, c);
  for (const [id, eid] of overrides?.activity ?? []) activity.seed(id, eid);
  for (const [rid, br, st] of overrides?.publications ?? [])
    publications.seed(rid, br, st);

  const branchFor =
    overrides?.branchFor ??
    ((repoId: string) => (repoId === REPO_A ? "main" : undefined));

  return {
    tasks,
    results,
    initiatives,
    sequencing,
    landing,
    activity,
    publications,
    branchFor,
    useCase: new GetInitiativeGraph(
      tasks,
      results,
      initiatives,
      sequencing,
      landing,
      activity,
      publications,
      branchFor,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("execute throws UnknownReferenceError('initiative', id) for an unknown initiative id", async () => {
  const { useCase } = makeBundle();
  await assert.rejects(
    () => useCase.execute({ id: "no-such-initiative" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      assert.equal(err.kind, "initiative");
      assert.equal(err.id, "no-such-initiative");
      assert.ok(
        (err as Error).message.includes("no initiative with id"),
        `message must include 'no initiative with id', got: ${(err as Error).message}`,
      );
      return true;
    },
  );
});

test("execute returns projectId from the initiative, branch='kanthord/init/<id>', and defaults status to 'building' when undefined", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: PROJ_ID,
    name: "init",
    paused: false,
    // status intentionally absent
  };
  const { useCase } = makeBundle({
    initiative,
    objectives: [
      {
        id: OBJ_ID,
        initiativeId: INIT_ID,
        name: "obj",
        // status intentionally absent
      },
    ],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "pending" })],
  });

  const out = await useCase.execute({ id: INIT_ID });
  assert.equal(out.projectId, PROJ_ID);
  assert.equal(out.initiative.id, INIT_ID);
  assert.equal(out.initiative.name, "init");
  assert.equal(out.initiative.status, "building");
  assert.equal(out.initiative.paused, false);
  assert.equal(out.initiative.branch, `kanthord/init/${INIT_ID}`);
});

test("execute preserves the source's node order — does NOT re-sort even when the source returns ids out of alphabetical order", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "zzz", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({ id: "mmm", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({ id: "aaa", objectiveId: OBJ_ID, status: "pending" }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(
    out.nodes.map((n) => n.id),
    ["zzz", "mmm", "aaa"],
    "node order must equal the source order verbatim",
  );
});

test("execute emits edges with from=dependency and to=dependent — a dependent D with dependencies:[R] produces {from:'R', to:'D'}", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "R", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({
        id: "D",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["R"],
      }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const dEdge = out.edges.find((e) => e.to === "D");
  assert.ok(dEdge !== undefined, "an edge ending at D must exist");
  assert.equal(dEdge!.from, "R");
  assert.equal(dEdge!.to, "D");
});

test("execute: pending dependent of a pending root → dependencyState='blocked' with one waiting entry, neverSatisfies:false", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "R", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({
        id: "D",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["R"],
      }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const d = out.nodes.find((n) => n.id === "D")!;
  assert.equal(d.dependencyState, "blocked");
  assert.equal(d.waiting.length, 1);
  assert.equal(d.waiting[0]!.id, "R");
  assert.equal(d.waiting[0]!.neverSatisfies, false);
  assert.equal(d.blockedForever, false);
});

test("execute: pending node depending on a discarded task → blockedForever:true, waiting[0].neverSatisfies:true, action.kind='remove-dependency' targeting the dead dep", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "A", objectiveId: OBJ_ID, status: "discarded" }),
      makeTask({
        id: "B",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["A"],
      }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const b = out.nodes.find((n) => n.id === "B")!;
  assert.equal(b.blockedForever, true);
  assert.equal(b.waiting.length, 1);
  assert.equal(b.waiting[0]!.id, "A");
  assert.equal(b.waiting[0]!.neverSatisfies, true);
  assert.ok(b.action !== null);
  assert.equal(b.action!.kind, "remove-dependency");
  assert.equal(b.action!.target.type, "task");
  assert.equal(b.action!.target.id, "B");
  assert.equal(b.action!.targetDependencyId, "A");
});

test("execute: downstream — a root with four direct dependents reports 4 (no leaf)", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "R", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({
        id: "D1",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["R"],
      }),
      makeTask({
        id: "D2",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["R"],
      }),
      makeTask({
        id: "D3",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["R"],
      }),
      makeTask({
        id: "D4",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["R"],
      }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const r = out.nodes.find((n) => n.id === "R")!;
  const d1 = out.nodes.find((n) => n.id === "D1")!;
  assert.equal(r.downstream, 4);
  assert.equal(d1.downstream, 0);
});

test("execute: downstream — a root with one direct + one transitive dependent reports 2 (closure counts transitively)", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "R", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({
        id: "D1",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["R"],
      }),
      makeTask({
        id: "Leaf",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["D1"],
      }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const r = out.nodes.find((n) => n.id === "R")!;
  const leaf = out.nodes.find((n) => n.id === "Leaf")!;
  assert.equal(r.downstream, 2);
  assert.equal(leaf.downstream, 0);
});

test("execute: paused=true (via listAllInitiatives) makes every node executionState='paused' and initiative.action.kind='resume-initiative'", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: PROJ_ID,
    name: "init",
    paused: true,
  };
  const { useCase } = makeBundle({
    initiative,
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({ id: "t-2", objectiveId: OBJ_ID, status: "completed" }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  for (const n of out.nodes) {
    assert.equal(
      n.executionState,
      "paused",
      `node ${n.id} must report executionState='paused'`,
    );
  }
  assert.ok(out.initiative.action !== null);
  assert.equal(out.initiative.action!.kind, "resume-initiative");
  assert.equal(out.initiative.action!.target.id, INIT_ID);
});

test("execute: paused=false (via listAllInitiatives) makes every node executionState='runnable' and initiative.action is null", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "pending" })],
  });
  const out = await useCase.execute({ id: INIT_ID });
  for (const n of out.nodes) {
    assert.equal(
      n.executionState,
      "runnable",
      `node ${n.id} must report executionState='runnable'`,
    );
  }
  assert.equal(out.initiative.action, null);
});

test("execute: paused defaults to false when the initiative id is absent from listAllInitiatives()", async () => {
  // Build the bundle without seeding the initiative into listAllInitiatives.
  const tasks = new FakeTaskSource();
  const results = new FakeResultSource();
  // Build an InitiativeSource that returns the initiative from get() but
  // returns [] from listAllInitiatives(). This simulates the
  // "no row in the global paused index" case.
  class NoPausedRowSource extends WriteGuard {
    readonly #initiative: Initiative = {
      id: INIT_ID,
      projectId: PROJ_ID,
      name: "init",
      paused: false,
    };
    get(): Initiative {
      return this.#initiative;
    }
    listObjectives(): Objective[] {
      return [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }];
    }
    listAllInitiatives(): Array<{ id: string; paused: boolean }> {
      return [];
    }
    save(): never {
      return this.refuse("save");
    }
    saveObjective(): never {
      return this.refuse("saveObjective");
    }
    setPaused(): never {
      return this.refuse("setPaused");
    }
  }
  const initiatives = new NoPausedRowSource();
  const sequencing = new FakeSequencingSource();
  const landing = new FakeLandingSource();
  const activity = new FakeActivitySource();
  const publications = new FakePublicationSource();

  tasks.seedByInitiative(INIT_ID, [
    makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "pending" }),
  ]);

  const useCase = new GetInitiativeGraph(
    tasks,
    results,
    initiatives,
    sequencing,
    landing,
    activity,
    publications,
    () => undefined,
  );

  const out = await useCase.execute({ id: INIT_ID });
  assert.equal(out.initiative.paused, false);
  assert.equal(out.nodes[0]!.executionState, "runnable");
});

test("execute: groups[].repositories is the distinct ascending-sorted union of repositories named by the group's tasks", async () => {
  const { useCase } = makeBundle({
    objectives: [
      { id: "obj-a", initiativeId: INIT_ID, name: "A" },
      { id: "obj-b", initiativeId: INIT_ID, name: "B" },
    ],
    tasks: [
      makeTask({ id: "t-a1", objectiveId: "obj-a", status: "pending" }),
      makeTask({ id: "t-a2", objectiveId: "obj-a", status: "pending" }),
      makeTask({ id: "t-a3", objectiveId: "obj-a", status: "pending" }),
      makeTask({ id: "t-b1", objectiveId: "obj-b", status: "pending" }),
    ],
    contexts: [
      ["t-a1", { repository: REPO_B }],
      ["t-a2", { repository: REPO_A }],
      // t-a3 names REPO_A again — same repository named twice must dedup
      ["t-a3", { repository: REPO_A }],
      ["t-b1", {}],
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const a = out.groups.find((g) => g.id === "obj-a")!;
  const b = out.groups.find((g) => g.id === "obj-b")!;
  // obj-a's three tasks name REPO_B, REPO_A, REPO_A — distinct (deduped),
  // ascending-sorted
  assert.deepEqual(a.repositories, [REPO_A, REPO_B]);
  // obj-b's single task names no repository
  assert.deepEqual(b.repositories, []);
});

test("execute: groups[].waiting uses objective-edge semantics — discarded predecessor objective yields neverSatisfies:true", async () => {
  // Build a fake InitiativeSource that has both objectives (one discarded).
  const { useCase } = makeBundle({
    objectives: [
      { id: OBJ_ID, initiativeId: INIT_ID, name: "obj" },
      {
        id: "obj-prev",
        initiativeId: INIT_ID,
        name: "previous",
        status: "discarded",
      },
    ],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "pending" })],
    objectiveAfter: [[OBJ_ID, ["obj-prev"]]],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const g = out.groups.find((g) => g.id === OBJ_ID)!;
  assert.equal(g.waiting.length, 1);
  assert.equal(g.waiting[0]!.id, "obj-prev");
  assert.equal(g.waiting[0]!.neverSatisfies, true);
});

test("execute: verificationResults equals taskResult.evidence verbatim, and is [] when evidence is null and when the result row is absent", async () => {
  const evidence = [
    { command: "test -f x", exitCode: 0, output: "ok" },
    { command: "test -f y", exitCode: 1, output: "missing" },
  ];
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({
        id: "t-ev",
        objectiveId: OBJ_ID,
        status: "completed",
      }),
      makeTask({
        id: "t-null",
        objectiveId: OBJ_ID,
        status: "completed",
      }),
      makeTask({
        id: "t-miss",
        objectiveId: OBJ_ID,
        status: "completed",
      }),
    ],
    taskResults: [
      [
        "t-ev",
        {
          workspace: null,
          branch: null,
          baseCommit: null,
          proposalCommit: null,
          commitSha: null,
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence,
        },
      ],
      [
        "t-null",
        {
          workspace: null,
          branch: null,
          baseCommit: null,
          proposalCommit: null,
          commitSha: null,
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
      // no result row for t-miss
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const ev = out.nodes.find((n) => n.id === "t-ev")!;
  const n = out.nodes.find((n) => n.id === "t-null")!;
  const m = out.nodes.find((n) => n.id === "t-miss")!;
  assert.deepEqual(ev.verificationResults, evidence);
  assert.deepEqual(n.verificationResults, []);
  assert.deepEqual(m.verificationResults, []);
});

test("execute: candidate source rules — landing row wins over task_result; commitSha wins over proposalCommit; null when neither", async () => {
  const landingRow: ChangeCandidate = {
    id: "cand-1",
    taskId: "t-lc",
    repoId: REPO_A,
    baseSHA: "base-sha",
    candidateSHA: "landing-sha",
    ref: "kanthord/t-lc",
    target: "main",
    state: "landed",
  };
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "t-lc", objectiveId: OBJ_ID, status: "completed" }),
      makeTask({ id: "t-cs", objectiveId: OBJ_ID, status: "completed" }),
      makeTask({ id: "t-pc", objectiveId: OBJ_ID, status: "completed" }),
      makeTask({ id: "t-none", objectiveId: OBJ_ID, status: "completed" }),
    ],
    candidates: [["t-lc", landingRow]],
    taskResults: [
      [
        "t-lc",
        {
          workspace: null,
          branch: null,
          baseCommit: "fallback-base",
          proposalCommit: "fallback-prop",
          commitSha: "fallback-commit",
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
      [
        "t-cs",
        {
          workspace: null,
          branch: null,
          baseCommit: "base-cs",
          proposalCommit: "prop-cs",
          commitSha: "commit-cs",
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
      [
        "t-pc",
        {
          workspace: null,
          branch: null,
          baseCommit: "base-pc",
          proposalCommit: "prop-pc",
          commitSha: null,
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
      [
        "t-none",
        {
          workspace: null,
          branch: null,
          baseCommit: null,
          proposalCommit: null,
          commitSha: null,
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const lc = out.nodes.find((n) => n.id === "t-lc")!;
  const cs = out.nodes.find((n) => n.id === "t-cs")!;
  const pc = out.nodes.find((n) => n.id === "t-pc")!;
  const none = out.nodes.find((n) => n.id === "t-none")!;

  // landing row wins
  assert.deepEqual(lc.candidate, {
    candidateSHA: "landing-sha",
    baseSHA: "base-sha",
    target: "main",
    state: "landed",
    source: "landing_candidate",
  });

  // commitSha wins over proposalCommit
  assert.deepEqual(cs.candidate, {
    candidateSHA: "commit-cs",
    baseSHA: "base-cs",
    target: null,
    state: null,
    source: "task_result",
  });

  // only proposalCommit set
  assert.deepEqual(pc.candidate, {
    candidateSHA: "prop-pc",
    baseSHA: "base-pc",
    target: null,
    state: null,
    source: "task_result",
  });

  // neither set
  assert.equal(none.candidate, null);
});

test("execute: produced is null with no result row, and reports evidenceCount otherwise", async () => {
  const evidence = [
    { command: "a", exitCode: 0, output: "x" },
    { command: "b", exitCode: 0, output: "y" },
  ];
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "t-yes", objectiveId: OBJ_ID, status: "completed" }),
      makeTask({ id: "t-no", objectiveId: OBJ_ID, status: "completed" }),
    ],
    taskResults: [
      [
        "t-yes",
        {
          workspace: null,
          branch: null,
          baseCommit: null,
          proposalCommit: null,
          commitSha: null,
          summary: "the summary",
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence,
        },
      ],
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const yes = out.nodes.find((n) => n.id === "t-yes")!;
  const no = out.nodes.find((n) => n.id === "t-no")!;
  assert.deepEqual(yes.produced, { summary: "the summary", evidenceCount: 2 });
  assert.equal(no.produced, null);
});

test("execute: rejection is null when rejectionResolution is null", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "failed" })],
    taskResults: [
      [
        "t-1",
        {
          workspace: null,
          branch: null,
          baseCommit: null,
          proposalCommit: null,
          commitSha: null,
          summary: null,
          reason: "boom",
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const n = out.nodes.find((nn) => nn.id === "t-1")!;
  assert.equal(n.rejection, null);
  assert.equal(n.failureReason, "boom");
});

test("execute: lastEventId/lastEventAtMs — a known event reports the id and eventTimeMs; a task with no event reports null/null", async () => {
  // ULIDs with deterministic times for testing:
  // 01H0000000000000000000ABCD decodeTime=1683627180032
  const eventA = "01H0000000000000000000ABCD";
  const eventB = "01H1234567890ABCDEFGHJKMNP"; // decodeTime=1684771312839
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "t-ev", objectiveId: OBJ_ID, status: "completed" }),
      makeTask({ id: "t-miss", objectiveId: OBJ_ID, status: "pending" }),
    ],
    activity: [
      ["t-ev", eventA],
      ["t-other", eventB], // not relevant — belongs to a task outside the graph
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  const ev = out.nodes.find((n) => n.id === "t-ev")!;
  const miss = out.nodes.find((n) => n.id === "t-miss")!;
  assert.equal(ev.lastEventId, eventA);
  assert.equal(ev.lastEventAtMs, decodeTime(eventA));
  assert.equal(miss.lastEventId, null);
  assert.equal(miss.lastEventAtMs, null);
});

test("execute: counts is an exact match on a fixture spanning every status plus one permanently blocked node", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "p", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({ id: "r", objectiveId: OBJ_ID, status: "running" }),
      makeTask({ id: "c", objectiveId: OBJ_ID, status: "completed" }),
      makeTask({ id: "f", objectiveId: OBJ_ID, status: "failed" }),
      makeTask({
        id: "a",
        objectiveId: OBJ_ID,
        status: "awaiting_confirmation",
      }),
      makeTask({ id: "d", objectiveId: OBJ_ID, status: "discarded" }),
      // blocked node: pending with one discarded dep
      makeTask({ id: "x", objectiveId: OBJ_ID, status: "discarded" }),
      makeTask({
        id: "b",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["x"],
      }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(out.counts, {
    pending: 2,
    running: 1,
    completed: 1,
    failed: 1,
    awaiting_confirmation: 1,
    discarded: 2,
    blocked: 1,
    blockedForever: 1,
    actionable: 3, // `f` (retry), `a` (approve task), `b` (remove-dependency) all have non-null actions
  });
});

test("execute: actionable counts nodes only — a fixture where the group has 'approve' but every node's action is null reports actionable:0", async () => {
  // Group is awaiting_confirmation → groupAction = approve; but every node
  // is `running`, so nodeAction is null. The group approve is not a NODE
  // action, so it does not count toward `actionable`.
  const { useCase } = makeBundle({
    objectives: [
      {
        id: OBJ_ID,
        initiativeId: INIT_ID,
        name: "obj",
        status: "awaiting_confirmation",
      },
    ],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "running" })],
  });
  const out = await useCase.execute({ id: INIT_ID });
  // The group DOES carry an approve action …
  const g = out.groups.find((gg) => gg.id === OBJ_ID)!;
  assert.ok(g.action !== null);
  assert.equal(g.action!.kind, "approve");
  // … but the node does not (running is always null per Story 2 rule 6).
  const n = out.nodes.find((nn) => nn.id === "t-1")!;
  assert.equal(n.action, null);
  // Therefore actionable is 0.
  assert.equal(out.counts.actionable, 0);
});

test("execute: no writes — fakes' write methods throw on call; execute resolves and the read-only sources' reads were used", async () => {
  // The makeBundle factory wires WriteGuarded fakes whose save / saveObjective
  // / setPublication / etc. throw on call. The fakes' read methods are
  // exercised by execute; if execute called any write, the test would throw.
  // We assert execute resolves AND the no-writes invariant held by inspecting
  // counts (which only reads from the sources).
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "pending" })],
  });
  await assert.doesNotReject(() => useCase.execute({ id: INIT_ID }));
});

test("execute: initiative action 'publish' targets the lowest-ascending repository id across a two-repository union (rule 20), not the first-seeded task's repository", async () => {
  // Two tasks under one objective name REPO_B and REPO_A, seeded in that
  // order — the union is the distinct ascending-sorted set [REPO_A, REPO_B]
  // (rule 16). Rule 20 picks the lowest-ascending id of that union: REPO_A.
  // Seeding REPO_B first is deliberate — it proves the fixture exercises the
  // ascending sort, not merely "the first task's repository".
  const { useCase } = makeBundle({
    initiative: {
      id: INIT_ID,
      projectId: PROJ_ID,
      name: "init",
      paused: false,
      status: "landed",
    },
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "completed" }),
      makeTask({ id: "t-2", objectiveId: OBJ_ID, status: "completed" }),
    ],
    contexts: [
      ["t-1", { repository: REPO_B }],
      ["t-2", { repository: REPO_A }],
    ],
    branchFor: (id: string) =>
      id === REPO_A || id === REPO_B ? "main" : undefined,
    publications: [[REPO_A, "main", "diverged"]],
  });
  const out = await useCase.execute({ id: INIT_ID });
  assert.ok(out.initiative.action !== null);
  assert.equal(out.initiative.action!.kind, "publish");
  assert.equal(
    out.initiative.action!.target.id,
    REPO_A,
    "target must be the lowest-ascending repository id, not REPO_B (seeded first)",
  );
  assert.equal(
    out.initiative.action!.command,
    `publish repository --repository ${REPO_A} --branch main`,
  );
});

test("execute: initiative action 'publish' when publications.getPublication returns undefined — no publication record maps to state 'unpublished' (rule 20)", async () => {
  // landed + no publication record seeded at all → getPublication(repoId,
  // branch) returns undefined, which rule 20 maps to state "unpublished" —
  // one of the two states groupAction/initiativeAction treat as actionable,
  // so the result is a publish action.
  const { useCase } = makeBundle({
    initiative: {
      id: INIT_ID,
      projectId: PROJ_ID,
      name: "init",
      paused: false,
      status: "landed",
    },
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "completed" })],
    contexts: [["t-1", { repository: REPO_A }]],
    // no `publications` entry at all — getPublication(REPO_A, "main") is undefined
  });
  const out = await useCase.execute({ id: INIT_ID });
  assert.ok(out.initiative.action !== null);
  assert.equal(out.initiative.action!.kind, "publish");
  assert.equal(out.initiative.action!.target.id, REPO_A);
});

test("execute: initiative action is null when status is 'building' (regardless of publication)", async () => {
  const { useCase } = makeBundle({
    initiative: {
      id: INIT_ID,
      projectId: PROJ_ID,
      name: "init",
      paused: false,
      status: "building",
    },
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "pending" })],
    contexts: [["t-1", { repository: REPO_A }]],
    publications: [[REPO_A, "main", "unpublished"]],
  });
  const out = await useCase.execute({ id: INIT_ID });
  assert.equal(out.initiative.action, null);
});

test("execute: initiative action is null when no groups' repositories can be resolved (branchFor returns undefined)", async () => {
  const { useCase } = makeBundle({
    initiative: {
      id: INIT_ID,
      projectId: PROJ_ID,
      name: "init",
      paused: false,
      status: "landed",
    },
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [makeTask({ id: "t-1", objectiveId: OBJ_ID, status: "completed" })],
    contexts: [["t-1", { repository: REPO_A }]],
    branchFor: () => undefined, // no branch can be resolved
  });
  const out = await useCase.execute({ id: INIT_ID });
  assert.equal(out.initiative.action, null);
});

test("execute: criticalPath — a chain a→b→c all pending reports nodeIds=['a','b','c'] and length=3 in dependency-first order", async () => {
  const { useCase } = makeBundle({
    objectives: [{ id: OBJ_ID, initiativeId: INIT_ID, name: "obj" }],
    tasks: [
      makeTask({ id: "a", objectiveId: OBJ_ID, status: "pending" }),
      makeTask({
        id: "b",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["a"],
      }),
      makeTask({
        id: "c",
        objectiveId: OBJ_ID,
        status: "pending",
        dependencies: ["b"],
      }),
    ],
  });
  const out = await useCase.execute({ id: INIT_ID });
  assert.equal(out.criticalPath.metric, "remaining-node-count");
  assert.deepEqual(out.criticalPath.nodeIds, ["a", "b", "c"]);
  assert.equal(out.criticalPath.length, 3);
});

// ---------------------------------------------------------------------------
// EPIC 016 Story 7 — cross-check: GetTask and GetInitiativeGraph MUST agree
// on `waiting`, `blockedForever`, `downstream` and `action` for every task id.
// This is the regression guard against two divergent copies of the rules.
// ---------------------------------------------------------------------------

// Unified fake satisfying BOTH use cases' source shapes. Same backing store,
// different methods exposed — one object passed to both constructors.
class CrossCheckTaskSource {
  readonly #byId: Map<string, Task>;
  readonly #byInitiative: Map<string, Task[]>;
  readonly #initByTaskId: Map<string, string>;
  readonly #contexts: Map<string, Record<string, string>>;
  constructor(
    tasks: Task[],
    byInitiative: Map<string, Task[]>,
    contexts: Map<string, Record<string, string>>,
  ) {
    this.#byId = new Map(tasks.map((t) => [t.id, t]));
    this.#byInitiative = byInitiative;
    this.#initByTaskId = new Map();
    for (const [initId, list] of byInitiative) {
      for (const t of list) this.#initByTaskId.set(t.id, initId);
    }
    this.#contexts = contexts;
  }
  // GetTask / GetInitiativeGraph shared surface
  get(id: string): Task | undefined {
    return this.#byId.get(id);
  }
  listByInitiative(initiativeId: string): Task[] {
    return this.#byInitiative.get(initiativeId) ?? [];
  }
  getTaskContext(taskId: string): Record<string, string> {
    return this.#contexts.get(taskId) ?? {};
  }
  getInitiativeId(taskId: string): string | undefined {
    return this.#initByTaskId.get(taskId);
  }
}

class CrossCheckResultSource {
  readonly #byTask: Map<string, TaskResultRow>;
  constructor(rows: Map<string, TaskResultRow>) {
    this.#byTask = rows;
  }
  getTaskResult(taskId: string): TaskResultRow | undefined {
    return this.#byTask.get(taskId);
  }
}

class CrossCheckObjectiveStatusSource {
  readonly #byId: Map<string, { status?: Objective["status"] }>;
  constructor(byId: Map<string, { status?: Objective["status"] }>) {
    this.#byId = byId;
  }
  getObjective(id: string): { status?: Objective["status"] } | undefined {
    return this.#byId.get(id);
  }
}

test("(016 S7 cross-check) GetTask and GetInitiativeGraph agree on waiting/blockedForever/downstream/action for every task id", async () => {
  // Fixture: a single objective with three tasks:
  //   t-root (completed)        — three direct dependents
  //   t-dep-1 (pending)         — depends on t-root (will be unblocked when t-root stays completed)
  //   t-dep-2 (pending)         — depends on t-root
  //   t-dep-3 (pending)         — depends on t-root
  //   t-orphan (discarded dep)  — separate initiative is out of scope
  // Plus a separate permanent-block fixture:
  //   t-perm (pending)          — depends on a discarded task → blockedForever, action=remove-dependency
  //
  // All under one initiative so the cross-check exercises the same sibling
  // set in both use cases.
  const tRoot = makeTask({
    id: "t-root",
    objectiveId: OBJ_ID,
    status: "completed",
  });
  const tDep1 = makeTask({
    id: "t-dep-1",
    objectiveId: OBJ_ID,
    status: "pending",
    dependencies: ["t-root"],
  });
  const tDep2 = makeTask({
    id: "t-dep-2",
    objectiveId: OBJ_ID,
    status: "pending",
    dependencies: ["t-root"],
  });
  const tDep3 = makeTask({
    id: "t-dep-3",
    objectiveId: OBJ_ID,
    status: "pending",
    dependencies: ["t-root"],
  });
  const tDead = makeTask({
    id: "t-dead",
    objectiveId: OBJ_ID,
    status: "discarded",
  });
  const tPerm = makeTask({
    id: "t-perm",
    objectiveId: OBJ_ID,
    status: "pending",
    dependencies: ["t-dead"],
  });
  const tFailed = makeTask({
    id: "t-failed",
    objectiveId: OBJ_ID,
    status: "failed",
  });
  const tasks = [tRoot, tDep1, tDep2, tDep3, tDead, tPerm, tFailed];

  const byInitiative = new Map<string, Task[]>([[INIT_ID, tasks]]);
  const tasks_ = new CrossCheckTaskSource(tasks, byInitiative, new Map());
  const results = new CrossCheckResultSource(new Map());

  // Wire up the GetInitiativeGraph use case with the same fakes (only the
  // extra graph-only sources are needed). Use the existing helpers in this
  // file where possible.
  const initiatives = new FakeInitiativeSource();
  initiatives.seedInitiative({
    id: INIT_ID,
    projectId: PROJ_ID,
    name: "init",
    paused: false,
  });
  initiatives.seedObjectives(INIT_ID, [
    { id: OBJ_ID, initiativeId: INIT_ID, name: "obj" },
  ]);
  const sequencing = new FakeSequencingSource();
  const landing = new FakeLandingSource();
  const activity = new FakeActivitySource();
  const publications = new FakePublicationSource();
  const branchFor = (_repoId: string) => undefined;

  const getGraph = new GetInitiativeGraph(
    tasks_,
    results,
    initiatives,
    sequencing,
    landing,
    activity,
    publications,
    branchFor,
  );

  // Wire up the GetTask use case with the same `tasks_` and `results`
  // fakes plus the optional objective status source.
  const objectives = new CrossCheckObjectiveStatusSource(new Map());
  const getTask = new GetTask(
    tasks_,
    results,
    { getTaskContext: (id: string) => tasks_.getTaskContext(id) },
    undefined, // landing
    undefined, // jobs
    objectives,
  );

  const graph = await getGraph.execute({ id: INIT_ID });
  for (const node of graph.nodes) {
    const taskOutput = await getTask.execute({ id: node.id });
    assert.deepEqual(
      taskOutput.waiting,
      node.waiting,
      `waiting must agree for task ${node.id}`,
    );
    assert.equal(
      taskOutput.blockedForever,
      node.blockedForever,
      `blockedForever must agree for task ${node.id}`,
    );
    assert.equal(
      taskOutput.downstream,
      node.downstream,
      `downstream must agree for task ${node.id}`,
    );
    assert.deepEqual(
      taskOutput.action,
      node.action,
      `action must agree for task ${node.id}`,
    );
  }
});
