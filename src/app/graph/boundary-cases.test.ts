/**
 * Story 09 T2 — Boundary-case behaviors (S4/RB7).
 *
 * One test per row of the boundary-case table in the Story 09 spec:
 *   • empty objective (no tasks) → valid
 *   • empty initiative (no objectives) → valid
 *   • task objectiveRef = DB-persisted objective absent from package → allowed
 *   • ref → neither package nor DB → UnknownNodeError  (RED today)
 *   • dep ULID from different initiative → CrossInitiativeError  (RED today)
 *
 * Parse-level cases (duplicate ref, malformed ref) are tested in
 * src/apps/cli/graph-md/parse.test.ts (codec layer — import direction).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { ApplyGraph } from "./apply-graph.ts";
import { CreateGraph } from "./create-graph.ts";
import { StoreGraph } from "./store-graph.ts";
import { UnknownNodeError, CrossInitiativeError } from "./import-errors.ts";
import type { GraphPackage, ExportManifest } from "./graph-package.ts";
import type {
  InitiativeRepository,
  TaskRepository,
  UnitOfWork,
  GraphImportMap,
  ProjectRepository,
  CasResult,
} from "../../storage/port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type { Project } from "../../domain/project.ts";
import type { Resource } from "../../domain/resource.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJ_ID = "01JQVBZ3MHKP4FTGWR5XYFNS01";
const INIT_ID = "01JQVBZ3MHKP4FTGWR5XYFNS02";
const DB_OBJ_ONLY_ID = "01JQVBZ3MHKP4FTGWR5XYFNS04"; // in DB, not in package
const TASK_ID = "01JQVBZ3MHKP4FTGWR5XYFNS05";
const PKG_ID = "01JQVBZ3MHKP4FTGWR5XYFNS06";
const UNKNOWN_OBJ_ULID = "01JQVBZ3MHKP4FTGWR5XYFNS07"; // not in DB at all
const ANOTHER_INIT_ID = "01JQVBZ3MHKP4FTGWR5XYFNS08"; // a different initiative
const FOREIGN_TASK_ID = "01JQVBZ3MHKP4FTGWR5XYFNS09"; // task from ANOTHER_INIT_ID

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Canonical sha for the initiative (used in test 3)
const INIT_SHA = sha256(JSON.stringify({ name: "oauth", projectId: PROJ_ID }));

// Canonical sha for a task that references DB_OBJ_ONLY_ID (test 3)
const TASK_DB_OBJ_SHA = sha256(
  JSON.stringify({
    title: "do work",
    instructions: "do it",
    ac: ["works"],
    agent: "generic@1",
    verification: null,
    dependencies: [],
    objectiveId: DB_OBJ_ONLY_ID,
    status: "pending",
  }),
);

// Counter-based newId for use in CreateGraph tests
let _counter = 0;
function nextId(): string {
  const n = String(++_counter).padStart(8, "0");
  return `01JQVBZ3MHKP4FTGWR${n}`;
}

// ---------------------------------------------------------------------------
// Minimal fakes (implement port interfaces + CAS stubs for ApplyGraph)
// ---------------------------------------------------------------------------

class FakeBCInitiativeRepository implements InitiativeRepository {
  readonly #initiatives = new Map<string, Initiative>();
  readonly #objectives = new Map<string, Objective>();
  readonly #shas = new Map<string, string>();

  seedInitiative(init: Initiative, sha: string): void {
    this.#initiatives.set(init.id, init);
    this.#shas.set(init.id, sha);
  }

  seedObjective(obj: Objective, sha: string): void {
    this.#objectives.set(obj.id, obj);
    this.#shas.set(obj.id, sha);
  }

  save(_i: Initiative): void {}
  saveObjective(_o: Objective): void {}
  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }
  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }
  listObjectives(_initiativeId: string): Objective[] {
    return [];
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
  getSha256(id: string): string | undefined {
    return this.#shas.get(id);
  }

  // CAS stubs — required by ApplyGraph's local InitiativeRepositoryCas type
  conditionalRenameInitiative(
    _id: string,
    _sha: string,
    _name: string,
  ): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalRenameObjective(
    _id: string,
    _sha: string,
    _name: string,
  ): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalDeleteObjective(_id: string, _sha: string): CasResult {
    return { status: "conflict", currentSha: "" };
  }
}

class FakeBCTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, Task>();
  readonly #shas = new Map<string, string>();
  // Maps task ids to their owning initiative (for cross-initiative detection)
  readonly #initiativeOf = new Map<string, string>();

  seedTask(task: Task, sha: string, initiativeId: string = INIT_ID): void {
    this.#tasks.set(task.id, task);
    this.#shas.set(task.id, sha);
    this.#initiativeOf.set(task.id, initiativeId);
  }

  /** Register a task from ANOTHER initiative (not in the task list) */
  seedForeignTask(taskId: string, initiativeId: string): void {
    this.#initiativeOf.set(taskId, initiativeId);
  }

  save(_t: Task): void {}
  saveAll(_t: Task[]): void {}
  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }
  listByInitiative(_initiativeId: string): Task[] {
    return [...this.#tasks.values()];
  }
  listTasksByObjective(_objectiveId: string): Task[] {
    return [];
  }
  saveTaskContext(_taskId: string, _ctx: Record<string, string>): void {}
  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }
  addDependency(_taskId: string, _dep: string): void {}
  removeDependency(_taskId: string, _dep: string): void {}
  getInitiativeId(taskId: string): string | undefined {
    return this.#initiativeOf.get(taskId);
  }
  getSha256(id: string): string | undefined {
    return this.#shas.get(id);
  }

  // CAS stubs — required by ApplyGraph's local TaskRepositoryCas type
  compareAndApply(
    _id: string,
    _sha: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalReparent(_id: string, _sha: string, _objId: string): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalDeleteTask(_id: string, _sha: string): CasResult {
    return { status: "conflict", currentSha: "" };
  }
}

class FakeBCProjectRepository implements ProjectRepository {
  readonly #projects = new Map<string, Project>();
  seedProject(p: Project): void {
    this.#projects.set(p.id, p);
  }
  save(_p: Project): void {}
  get(id: string): Project | undefined {
    return this.#projects.get(id);
  }
  addResource(_projectId: string, _resource: Resource): void {}
  getResource(_id: string): Resource | undefined {
    return undefined;
  }
  listResources(_projectId: string): Resource[] {
    return [];
  }
  listProjects(): Project[] {
    return [];
  }
  resolveProjectByName(_name: string): string[] {
    return [];
  }
  resolveResourceByName(_projectId: string, _name: string): string[] {
    return [];
  }
}

class FakeBCGraphImportMap implements GraphImportMap {
  readonly #map = new Map<string, { nodeId: string; creationSha: string }>();
  reserve(
    pkg: string,
    kind: string,
    ref: string,
    nodeId: string,
    sha: string,
  ): void {
    this.#map.set(`${pkg}:${kind}:${ref}`, { nodeId, creationSha: sha });
  }
  lookup(
    pkg: string,
    kind: string,
    ref: string,
  ): { nodeId: string; creationSha: string } | undefined {
    return this.#map.get(`${pkg}:${kind}:${ref}`);
  }
}

class FakeBCUnitOfWork implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

// ---------------------------------------------------------------------------
// Boundary case: empty objective (no tasks) — CreateGraph
// ---------------------------------------------------------------------------

describe("Story 09 T2 — empty objective (no tasks)", () => {
  test("empty objective (no tasks) — CreateGraph succeeds without error", async () => {
    const initRepo = new FakeBCInitiativeRepository();
    const taskRepo = new FakeBCTaskRepository();
    const projRepo = new FakeBCProjectRepository();
    projRepo.seedProject({ id: PROJ_ID, name: "test-project" });
    const importMap = new FakeBCGraphImportMap();
    const uow = new FakeBCUnitOfWork();
    const storeGraph = new StoreGraph(taskRepo);

    const pkg: GraphPackage = {
      packageId: "",
      formatVersion: 1,
      initiative: { ref: "my-init", name: "My Init", sourcePath: "init.md" },
      objectives: [
        {
          ref: "my-obj",
          name: "My Obj",
          initiativeRef: "my-init",
          sourcePath: "obj.md",
        },
      ],
      tasks: [], // no tasks — objective is empty
      manifest: undefined,
    };

    const createGraph = new CreateGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph,
      projects: projRepo,
      importMap,
      uow,
      newId: nextId,
    });

    const result = await createGraph.execute({
      pkg,
      projectId: PROJ_ID,
      packageId: PKG_ID,
    });
    assert.ok(result.initiativeId.length > 0, "initiativeId must be assigned");
    assert.equal(
      Object.keys(result.refToId.objectives).length,
      1,
      "one objective created",
    );
    assert.equal(Object.keys(result.refToId.tasks).length, 0, "no tasks");
  });
});

// ---------------------------------------------------------------------------
// Boundary case: empty initiative (no objectives, no tasks) — CreateGraph
// ---------------------------------------------------------------------------

describe("Story 09 T2 — empty initiative (no objectives, no tasks)", () => {
  test("empty initiative (no objectives) — CreateGraph succeeds without error", async () => {
    const initRepo = new FakeBCInitiativeRepository();
    const taskRepo = new FakeBCTaskRepository();
    const projRepo = new FakeBCProjectRepository();
    projRepo.seedProject({ id: PROJ_ID, name: "test-project" });
    const importMap = new FakeBCGraphImportMap();
    const uow = new FakeBCUnitOfWork();
    const storeGraph = new StoreGraph(taskRepo);

    const pkg: GraphPackage = {
      packageId: "",
      formatVersion: 1,
      initiative: {
        ref: "bare-init",
        name: "Bare Init",
        sourcePath: "init.md",
      },
      objectives: [],
      tasks: [],
      manifest: undefined,
    };

    const createGraph = new CreateGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph,
      projects: projRepo,
      importMap,
      uow,
      newId: nextId,
    });

    const result = await createGraph.execute({
      pkg,
      projectId: PROJ_ID,
      packageId: PKG_ID,
    });
    assert.ok(result.initiativeId.length > 0, "initiativeId must be assigned");
    assert.equal(
      Object.keys(result.refToId.objectives).length,
      0,
      "no objectives",
    );
    assert.equal(Object.keys(result.refToId.tasks).length, 0, "no tasks");
  });
});

// ---------------------------------------------------------------------------
// Boundary case: task objectiveRef = DB-only objective — ApplyGraph (characterisation)
// ---------------------------------------------------------------------------

describe("Story 09 T2 — task with DB-persisted objective absent from package", () => {
  test("task objectiveRef is DB-persisted but not in package — classified unchanged, not an error", async () => {
    const initRepo = new FakeBCInitiativeRepository();
    const taskRepo = new FakeBCTaskRepository();
    const importMap = new FakeBCGraphImportMap();
    const uow = new FakeBCUnitOfWork();
    const storeGraph = new StoreGraph(taskRepo);

    // Seed initiative
    initRepo.seedInitiative(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
      INIT_SHA,
    );
    // DB_OBJ_ONLY_ID exists as an objective sha (present in DB, not in package)
    initRepo.seedObjective(
      { id: DB_OBJ_ONLY_ID, initiativeId: INIT_ID, name: "backend" },
      sha256(JSON.stringify({ name: "backend", initiativeId: INIT_ID })),
    );

    // Seed the live task that lives under DB_OBJ_ONLY_ID
    const liveTask: Task = {
      id: TASK_ID,
      objectiveId: DB_OBJ_ONLY_ID,
      title: "do work",
      instructions: "do it",
      ac: ["works"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      status: "pending",
    };
    taskRepo.seedTask(liveTask, TASK_DB_OBJ_SHA);

    const manifest: ExportManifest = {
      initiativeId: INIT_ID,
      packageId: PKG_ID,
      formatVersion: 1,
      digestAlgorithm: "sha256",
      nodes: {
        [INIT_ID]: INIT_SHA,
        [TASK_ID]: TASK_DB_OBJ_SHA,
      },
      files: [INIT_ID, TASK_ID],
      refToId: {
        objectives: {},
        tasks: { [TASK_ID]: TASK_ID },
      },
    };

    // Package: initiative + one task pointing to DB_OBJ_ONLY_ID; no objectives exported
    const pkg: GraphPackage = {
      packageId: PKG_ID,
      formatVersion: 1,
      initiative: {
        id: INIT_ID,
        ref: INIT_ID,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      objectives: [], // the objective is in DB only
      tasks: [
        {
          id: TASK_ID,
          ref: TASK_ID,
          objectiveRef: DB_OBJ_ONLY_ID, // points to DB-only objective — must be allowed
          title: "do work",
          instructions: "do it",
          ac: ["works"],
          agent: "generic@1",
          verification: undefined,
          dependsOn: [],
          sourcePath: "backend/task.md",
        },
      ],
      manifest,
    };

    const applyGraph = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph,
      importMap,
      uow,
      newId: nextId,
    });

    // Must NOT throw — DB-only objective is a valid parent (boundary table row 3)
    const result = await applyGraph.execute({ pkg, initiativeId: INIT_ID });
    assert.ok(
      result.applied,
      "apply must succeed — DB-only objective parent is allowed",
    );
    const taskClass = result.classifications.find((c) => c.id === TASK_ID);
    assert.equal(
      taskClass?.class,
      "unchanged",
      "task content unchanged → classified unchanged",
    );
  });
});

// ---------------------------------------------------------------------------
// Boundary case: unknown objectiveRef (neither package nor DB) — RED
// ---------------------------------------------------------------------------

describe("Story 09 T2 — unknown objectiveRef (neither package nor DB)", () => {
  test("task objectiveRef ULID resolves to neither package nor DB — throws UnknownNodeError", async () => {
    const initRepo = new FakeBCInitiativeRepository();
    const taskRepo = new FakeBCTaskRepository();
    const importMap = new FakeBCGraphImportMap();
    const uow = new FakeBCUnitOfWork();
    const storeGraph = new StoreGraph(taskRepo);

    initRepo.seedInitiative(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
      INIT_SHA,
    );
    // NOTE: UNKNOWN_OBJ_ULID is NOT seeded in initRepo — it's in neither package nor DB.

    const manifest: ExportManifest = {
      initiativeId: INIT_ID,
      packageId: PKG_ID,
      formatVersion: 1,
      digestAlgorithm: "sha256",
      nodes: { [INIT_ID]: INIT_SHA },
      files: [INIT_ID],
      refToId: { objectives: {}, tasks: {} },
    };

    // id-less task (will be "created") with an objectiveRef that is unknown
    const pkg: GraphPackage = {
      packageId: PKG_ID,
      formatVersion: 1,
      initiative: {
        id: INIT_ID,
        ref: INIT_ID,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      objectives: [],
      tasks: [
        {
          ref: "new-task",
          objectiveRef: UNKNOWN_OBJ_ULID, // ULID not in package, not in DB
          title: "new work",
          instructions: "do new stuff",
          ac: ["succeeds"],
          agent: "generic@1",
          verification: undefined,
          dependsOn: [],
          sourcePath: "backend/new-task.md",
        },
      ],
      manifest,
    };

    const applyGraph = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph,
      importMap,
      uow,
      newId: nextId,
    });

    // RED: today no validation is performed — UnknownNodeError is not thrown
    await assert.rejects(
      () => applyGraph.execute({ pkg, initiativeId: INIT_ID }),
      UnknownNodeError,
      "a task objectiveRef ULID absent from both package and DB must throw UnknownNodeError",
    );
  });
});

// ---------------------------------------------------------------------------
// Boundary case: dep ULID from different initiative — CrossInitiativeError — RED
// ---------------------------------------------------------------------------

describe("Story 09 T2 — dep ULID from a different initiative", () => {
  test("dep ULID belongs to a different initiative — throws CrossInitiativeError", async () => {
    const initRepo = new FakeBCInitiativeRepository();
    const taskRepo = new FakeBCTaskRepository();
    const importMap = new FakeBCGraphImportMap();
    const uow = new FakeBCUnitOfWork();
    const storeGraph = new StoreGraph(taskRepo);

    initRepo.seedInitiative(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
      INIT_SHA,
    );
    // FOREIGN_TASK_ID belongs to ANOTHER_INIT_ID, not INIT_ID
    taskRepo.seedForeignTask(FOREIGN_TASK_ID, ANOTHER_INIT_ID);

    const manifest: ExportManifest = {
      initiativeId: INIT_ID,
      packageId: PKG_ID,
      formatVersion: 1,
      digestAlgorithm: "sha256",
      nodes: { [INIT_ID]: INIT_SHA },
      files: [INIT_ID],
      refToId: { objectives: {}, tasks: {} },
    };

    // id-less task whose depends-on references a task from another initiative
    const pkg: GraphPackage = {
      packageId: PKG_ID,
      formatVersion: 1,
      initiative: {
        id: INIT_ID,
        ref: INIT_ID,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      objectives: [],
      tasks: [
        {
          ref: "my-task",
          objectiveRef: "some-obj-ref", // not validated in this test
          title: "my task",
          instructions: "do stuff",
          ac: ["done"],
          agent: "generic@1",
          verification: undefined,
          dependsOn: [FOREIGN_TASK_ID], // dep belongs to ANOTHER_INIT_ID
          sourcePath: "my-task.md",
        },
      ],
      manifest,
    };

    const applyGraph = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph,
      importMap,
      uow,
      newId: nextId,
    });

    // RED: today validateGraph throws UnknownDependencyError (dep not in merged set)
    // instead of CrossInitiativeError; the distinction is not yet implemented.
    await assert.rejects(
      () => applyGraph.execute({ pkg, initiativeId: INIT_ID }),
      CrossInitiativeError,
      "a dep ULID from another initiative must throw CrossInitiativeError (not UnknownDependencyError)",
    );
  });
});
