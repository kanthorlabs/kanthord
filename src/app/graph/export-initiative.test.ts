/**
 * Story 04 T1 — ExportInitiative use case (hermetic, fakes only)
 *
 * Assertions:
 * (a) .tasks includes ONLY pending tasks — running task excluded
 * (b) manifest.nodes covers EVERY node (initiative + objectives + all tasks),
 *     sha COPIED from fake repo (deliberately non-computed sentinel values)
 * (c) manifest.files = initiative + objectives + pending tasks only
 * (d) every exported node: id === ref (ULID-as-ref, ruling 2026-07-18)
 * (e) PkgTask.dependencies / objectiveRef / initiativeRef carry parent ULIDs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ExportInitiative } from "./export-initiative.ts";
import type {
  TaskRepository,
  InitiativeRepository,
} from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";

// ─── stable test IDs (valid uppercase Crockford — 26 chars, no I/L/O/U) ──────
const PROJ_ID = "00000000000000000000000000";
const INIT_ID = "00000000000000000000000001";
const OBJ1_ID = "00000000000000000000000002";
const OBJ2_ID = "00000000000000000000000003";
const TASK1_ID = "00000000000000000000000004"; // pending, in OBJ1
const TASK2_ID = "00000000000000000000000005"; // pending, in OBJ1, depends on TASK1
const TASK3_ID = "00000000000000000000000006"; // running, in OBJ2 — NOT in .tasks

// Deliberately non-computed sentinel sha values — if the use case recomputed
// instead of copying, the assertion would produce a different (real) hash.
const INIT_SHA = "a".repeat(64);
const OBJ1_SHA = "b".repeat(64);
const OBJ2_SHA = "c".repeat(64);
const TASK1_SHA = "d".repeat(64);
const TASK2_SHA = "e".repeat(64);
const TASK3_SHA = "f".repeat(64);

// ─── fakes ────────────────────────────────────────────────────────────────────

const TASK1: Task = {
  id: TASK1_ID,
  objectiveId: OBJ1_ID,
  title: "implement api",
  status: "pending",
  dependencies: [],
  agent: "generic@1",
  instructions: "Implement POST /oauth/token",
  ac: ["returns 200 for valid creds"],
};

const TASK2: Task = {
  id: TASK2_ID,
  objectiveId: OBJ1_ID,
  title: "deploy",
  status: "pending",
  dependencies: [TASK1_ID],
  agent: "generic@1",
  instructions: "Deploy the backend",
  ac: ["health check green"],
};

const TASK3: Task = {
  id: TASK3_ID,
  objectiveId: OBJ2_ID,
  title: "frontend init",
  status: "running",
  dependencies: [],
  agent: "generic@1",
  instructions: "Scaffold frontend",
  ac: ["app boots"],
};

const INITIATIVE: Initiative = {
  id: INIT_ID,
  projectId: PROJ_ID,
  name: "oauth",
};

const OBJ1: Objective = {
  id: OBJ1_ID,
  initiativeId: INIT_ID,
  name: "backend",
};

const OBJ2: Objective = {
  id: OBJ2_ID,
  initiativeId: INIT_ID,
  name: "frontend",
};

/**
 * FakeTaskRepository — implements the port interface.
 * getSha256 is a NEW method the port interface needs to declare so the use case
 * can copy the DB sha into the manifest (instead of recomputing it).
 */
class FakeTaskRepository implements TaskRepository {
  private readonly tasks: Task[] = [TASK1, TASK2, TASK3];
  private readonly shas: Record<string, string> = {
    [TASK1_ID]: TASK1_SHA,
    [TASK2_ID]: TASK2_SHA,
    [TASK3_ID]: TASK3_SHA,
  };

  save(_task: Task): void {}
  saveAll(_tasks: Task[]): void {}

  get(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  listByInitiative(_initiativeId: string): Task[] {
    return [...this.tasks];
  }

  listTasksByObjective(objectiveId: string): Task[] {
    return this.tasks.filter((t) => t.objectiveId === objectiveId);
  }

  saveTaskContext(_taskId: string, _ctx: Record<string, string>): void {}

  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }

  addDependency(_taskId: string, _dependencyId: string): void {}
  removeDependency(_taskId: string, _dependencyId: string): void {}

  getInitiativeId(_taskId: string): string | undefined {
    return INIT_ID;
  }

  /** NEW — must be added to the TaskRepository port interface. */
  getSha256(id: string): string | undefined {
    return this.shas[id];
  }
  compareAndApply(
    _id: string,
    _expectedSha: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalReparent(_id: string, _expectedSha: string, _objectiveId: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteTask(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
  }
}

/**
 * FakeInitiativeRepository — implements the port interface.
 * getSha256 is a NEW method the port interface needs to declare.
 */
class FakeInitiativeRepository implements InitiativeRepository {
  private readonly shas: Record<string, string> = {
    [INIT_ID]: INIT_SHA,
    [OBJ1_ID]: OBJ1_SHA,
    [OBJ2_ID]: OBJ2_SHA,
  };

  save(_initiative: Initiative): void {}

  get(id: string): Initiative | undefined {
    return id === INIT_ID ? { ...INITIATIVE } : undefined;
  }

  saveObjective(_objective: Objective): void {}

  getObjective(id: string): Objective | undefined {
    if (id === OBJ1_ID) return { ...OBJ1 };
    if (id === OBJ2_ID) return { ...OBJ2 };
    return undefined;
  }

  listObjectives(initiativeId: string): Objective[] {
    return initiativeId === INIT_ID ? [{ ...OBJ1 }, { ...OBJ2 }] : [];
  }

  listInitiatives(_projectId: string): Initiative[] {
    return [];
  }

  resolveInitiativeByName(_projectId: string, _name: string): string[] {
    return [];
  }

  resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
    return [];
  }

  setPaused(_id: string, _paused: boolean): void {}

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [];
  }

  /** NEW — must be added to the InitiativeRepository port interface. */
  getSha256(id: string): string | undefined {
    return this.shas[id];
  }
  conditionalRenameInitiative(
    _id: string,
    _expectedSha: string,
    _name: string,
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalRenameObjective(_id: string, _expectedSha: string, _name: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteObjective(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

test("ExportInitiative returns only pending tasks in .tasks; running task excluded", async () => {
  const uc = new ExportInitiative({
    tasks: new FakeTaskRepository(),
    initiatives: new FakeInitiativeRepository(),
  });
  const pkg = await uc.execute(INIT_ID);

  assert.equal(pkg.tasks.length, 2, "only 2 pending tasks");
  const ids = pkg.tasks.map((t) => t.id);
  assert.ok(ids.includes(TASK1_ID), "pending task1 present");
  assert.ok(ids.includes(TASK2_ID), "pending task2 present");
  assert.ok(!ids.includes(TASK3_ID), "running task3 absent from .tasks");
});

test("ExportInitiative manifest.nodes covers EVERY node; sha COPIED from repo (not recomputed)", async () => {
  const uc = new ExportInitiative({
    tasks: new FakeTaskRepository(),
    initiatives: new FakeInitiativeRepository(),
  });
  const pkg = await uc.execute(INIT_ID);

  const nodes = pkg.manifest?.nodes ?? {};
  const allIds = [INIT_ID, OBJ1_ID, OBJ2_ID, TASK1_ID, TASK2_ID, TASK3_ID];
  for (const id of allIds) {
    assert.ok(id in nodes, `manifest.nodes must include ${id}`);
  }
  // Sentinel values prove the use case COPIED the repo sha, not recomputed it
  assert.equal(nodes[INIT_ID], INIT_SHA, "initiative sha copied");
  assert.equal(nodes[OBJ1_ID], OBJ1_SHA, "objective1 sha copied");
  assert.equal(nodes[OBJ2_ID], OBJ2_SHA, "objective2 sha copied");
  assert.equal(nodes[TASK1_ID], TASK1_SHA, "task1 sha copied");
  assert.equal(nodes[TASK2_ID], TASK2_SHA, "task2 sha copied");
  assert.equal(nodes[TASK3_ID], TASK3_SHA, "running task3 sha copied");
});

test("ExportInitiative manifest.files includes initiative+objectives+pending tasks; excludes running", async () => {
  const uc = new ExportInitiative({
    tasks: new FakeTaskRepository(),
    initiatives: new FakeInitiativeRepository(),
  });
  const pkg = await uc.execute(INIT_ID);

  const files = pkg.manifest?.files ?? [];
  assert.ok(files.includes(INIT_ID), "initiative in files");
  assert.ok(files.includes(OBJ1_ID), "obj1 in files");
  assert.ok(files.includes(OBJ2_ID), "obj2 in files");
  assert.ok(files.includes(TASK1_ID), "pending task1 in files");
  assert.ok(files.includes(TASK2_ID), "pending task2 in files");
  assert.ok(!files.includes(TASK3_ID), "running task3 NOT in files");
});

test("ExportInitiative manifest.objectiveIds is the ordered list of objective ids (initiative-branch workflow needs objective order)", async () => {
  const uc = new ExportInitiative({
    tasks: new FakeTaskRepository(),
    initiatives: new FakeInitiativeRepository(),
  });
  const pkg = await uc.execute(INIT_ID);

  assert.deepEqual(
    pkg.manifest?.objectiveIds,
    [OBJ1_ID, OBJ2_ID],
    "manifest.objectiveIds is [OBJ1_ID, OBJ2_ID] in listObjectives order",
  );
});

test("ExportInitiative every exported node has id === ref (ULID-as-ref; no lowercase ref)", async () => {
  const uc = new ExportInitiative({
    tasks: new FakeTaskRepository(),
    initiatives: new FakeInitiativeRepository(),
  });
  const pkg = await uc.execute(INIT_ID);

  // initiative
  assert.equal(pkg.initiative.id, INIT_ID);
  assert.equal(pkg.initiative.ref, INIT_ID, "initiative ref equals its ULID");

  // objectives
  for (const obj of pkg.objectives) {
    assert.ok(obj.id, "objective has id");
    assert.equal(obj.ref, obj.id, "objective ref equals its ULID");
    // ref must NOT be lowercase (lowercase would mean it's a slug, not a ULID)
    assert.ok(
      obj.ref === obj.ref.toUpperCase(),
      "ref is uppercase (ULID shape)",
    );
  }

  // tasks
  for (const t of pkg.tasks) {
    assert.ok(t.id, "task has id");
    assert.equal(t.ref, t.id, "task ref equals its ULID");
    assert.ok(
      t.ref === t.ref.toUpperCase(),
      "task ref is uppercase (ULID shape)",
    );
  }
});

test("ExportInitiative PkgTask.dependencies / objectiveRef / initiativeRef carry parent ULIDs", async () => {
  const uc = new ExportInitiative({
    tasks: new FakeTaskRepository(),
    initiatives: new FakeInitiativeRepository(),
  });
  const pkg = await uc.execute(INIT_ID);

  const task2 = pkg.tasks.find((t) => t.id === TASK2_ID);
  assert.ok(task2, "task2 present");
  assert.deepEqual(
    task2.dependencies,
    [TASK1_ID],
    "task2 depends on task1 ULID",
  );
  assert.equal(task2.objectiveRef, OBJ1_ID, "task2 objectiveRef is OBJ1 ULID");

  const task1 = pkg.tasks.find((t) => t.id === TASK1_ID);
  assert.ok(task1, "task1 present");
  assert.equal(task1.objectiveRef, OBJ1_ID, "task1 objectiveRef is OBJ1 ULID");

  for (const obj of pkg.objectives) {
    assert.equal(
      obj.initiativeRef,
      INIT_ID,
      "each objective initiativeRef is the initiative ULID",
    );
  }
});
