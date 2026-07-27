/**
 * Story 05 T1 — CreateGraph use case (hermetic, fakes)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateGraph, CreateModeIdError } from "./create-graph.ts";
import type { CreateGraphInput } from "./create-graph.ts";
import { CycleError } from "../../domain/graph.ts";
import type { GraphPackage } from "./graph-package.ts";
import type {
  InitiativeRepository,
  TaskRepository,
  ProjectRepository,
  UnitOfWork,
  GraphImportMap,
} from "../../storage/port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type { Project } from "../../domain/project.ts";
import type { Resource } from "../../domain/resource.ts";
import { StoreGraph } from "./store-graph.ts";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const PROJECT_ID = "00000000000000000000000099";
const PACKAGE_ID = "00000000000000000000000000";
// T4 resource ids
const T4_REPO_ID = "00000000000000000000000010";
const T4_AIP_ID = "00000000000000000000000011";
const T4_CRED_ID = "00000000000000000000000012";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeInitiativeRepository implements InitiativeRepository {
  readonly saved: Initiative[] = [];
  readonly savedObjectives: Objective[] = [];

  save(initiative: Initiative): void {
    this.saved.push({ ...initiative });
  }

  get(_id: string): Initiative | undefined {
    return undefined;
  }

  saveObjective(objective: Objective): void {
    this.savedObjectives.push({ ...objective });
  }

  getObjective(_id: string): Objective | undefined {
    return undefined;
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

  getSha256(_id: string): string | undefined {
    return undefined;
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

class FakeTaskRepository implements TaskRepository {
  readonly saveAllCalls: Task[][] = [];
  readonly saveTaskContextCalls: Array<{
    taskId: string;
    context: Record<string, string>;
  }> = [];

  save(_task: Task): void {}

  saveAll(tasks: Task[]): void {
    this.saveAllCalls.push([...tasks]);
  }

  get(_id: string): Task | undefined {
    return undefined;
  }

  listByInitiative(_initiativeId: string): Task[] {
    return [];
  }

  listTasksByObjective(_objectiveId: string): Task[] {
    return [];
  }

  saveTaskContext(taskId: string, context: Record<string, string>): void {
    this.saveTaskContextCalls.push({ taskId, context });
  }

  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }

  addDependency(_taskId: string, _dependencyId: string): void {}

  removeDependency(_taskId: string, _dependencyId: string): void {}

  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  compareAndApply(
    _id: string,
    _expectedSha: string,
    _expectedStatus: string,
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
  conditionalDeleteTask(
    _id: string,
    _expectedSha: string,
    _expectedStatus: string,
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
}

class FakeProjectRepository implements ProjectRepository {
  readonly #known: Set<string>;

  constructor(knownIds: string[]) {
    this.#known = new Set(knownIds);
  }

  save(_project: Project): void {}

  get(id: string): Project | undefined {
    if (this.#known.has(id)) return { id, name: "test-project" };
    return undefined;
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

interface ReserveCall {
  packageId: string;
  kind: string;
  ref: string;
  nodeId: string;
  creationSha: string;
}

class FakeGraphImportMap implements GraphImportMap {
  readonly reserveCalls: ReserveCall[] = [];

  reserve(
    packageId: string,
    kind: string,
    ref: string,
    nodeId: string,
    creationSha: string,
  ): void {
    this.reserveCalls.push({ packageId, kind, ref, nodeId, creationSha });
  }

  lookup(
    _packageId: string,
    _kind: string,
    _ref: string,
  ): { nodeId: string; creationSha: string } | undefined {
    return undefined;
  }
}

class FakeUnitOfWork implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a hand-authored (no persisted ids) GraphPackage. */
function makeAuthoredPkg(): GraphPackage {
  return {
    packageId: "",
    formatVersion: 1,
    initiative: { ref: "oauth", name: "oauth", sourcePath: "oauth.md" },
    objectives: [
      {
        ref: "backend",
        initiativeRef: "oauth",
        name: "backend",
        sourcePath: "backend/backend.md",
      },
      {
        ref: "frontend",
        initiativeRef: "oauth",
        name: "frontend",
        sourcePath: "frontend/frontend.md",
      },
    ],
    tasks: [
      {
        ref: "implement-api",
        objectiveRef: "backend",
        title: "implement api",
        instructions: "Implement POST /oauth/token",
        ac: ["returns 200 for valid creds"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "backend/implement-api.md",
      },
      {
        ref: "deploy",
        objectiveRef: "backend",
        title: "deploy",
        instructions: "Deploy the backend",
        ac: ["health check green"],
        agent: "generic@1",
        verification: undefined,
        dependencies: ["implement-api"],
        sourcePath: "backend/deploy.md",
      },
    ],
  };
}

function makeDeps(
  override: Partial<{
    projects: ProjectRepository;
    importMap: FakeGraphImportMap;
    tasks: FakeTaskRepository;
    sequencing: unknown;
  }> = {},
) {
  const tasks = override.tasks ?? new FakeTaskRepository();
  const importMap = override.importMap ?? new FakeGraphImportMap();
  return {
    initiatives: new FakeInitiativeRepository(),
    tasks,
    storeGraph: new StoreGraph(tasks),
    projects: override.projects ?? new FakeProjectRepository([PROJECT_ID]),
    importMap,
    uow: new FakeUnitOfWork(),
    newId: (() => {
      let n = 1;
      return () => String(n++).padStart(26, "0");
    })(),
    sequencing: override.sequencing,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("CreateGraph creates initiative + 2 objectives + 2 tasks; refToId has correct refs; nodes covers all 5 ids", async () => {
  const deps = makeDeps();
  const uc = new CreateGraph(deps);
  const input: CreateGraphInput = {
    pkg: makeAuthoredPkg(),
    projectId: PROJECT_ID,
    packageId: PACKAGE_ID,
    paused: false,
  };

  const result = await uc.execute(input);

  assert.ok(result.initiativeId.length > 0, "initiativeId is non-empty");
  assert.equal(Object.keys(result.refToId.objectives).length, 2);
  assert.ok("backend" in result.refToId.objectives, "objectives has backend");
  assert.ok("frontend" in result.refToId.objectives, "objectives has frontend");
  assert.equal(Object.keys(result.refToId.tasks).length, 2);
  assert.ok("implement-api" in result.refToId.tasks, "tasks has implement-api");
  assert.ok("deploy" in result.refToId.tasks, "tasks has deploy");

  // nodes must cover ALL 5 node IDs (initiative + 2 objectives + 2 tasks)
  const nodeIds = new Set(Object.keys(result.nodes));
  assert.ok(nodeIds.has(result.initiativeId), "nodes has initiative");

  const backendId = result.refToId.objectives["backend"];
  assert.ok(backendId !== undefined, "backend objective id defined");
  assert.ok(nodeIds.has(backendId), "nodes has backend objective");

  const frontendId = result.refToId.objectives["frontend"];
  assert.ok(frontendId !== undefined, "frontend objective id defined");
  assert.ok(nodeIds.has(frontendId), "nodes has frontend objective");

  const apiId = result.refToId.tasks["implement-api"];
  assert.ok(apiId !== undefined, "implement-api task id defined");
  assert.ok(nodeIds.has(apiId), "nodes has implement-api task");

  const deployId = result.refToId.tasks["deploy"];
  assert.ok(deployId !== undefined, "deploy task id defined");
  assert.ok(nodeIds.has(deployId), "nodes has deploy task");

  // each sha is a non-empty string
  for (const sha of Object.values(result.nodes)) {
    assert.ok(
      typeof sha === "string" && sha.length > 0,
      "each node sha must be non-empty",
    );
  }
});

test("CreateGraph throws CreateModeIdError when initiative has a persisted id", async () => {
  const deps = makeDeps();
  const uc = new CreateGraph(deps);
  const pkg = makeAuthoredPkg();
  pkg.initiative = {
    ...pkg.initiative,
    id: "01JQVBZ3MHKP4FTGWR5XYENSD7",
  };

  await assert.rejects(
    () =>
      uc.execute({
        pkg,
        projectId: PROJECT_ID,
        packageId: PACKAGE_ID,
        paused: false,
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof CreateModeIdError,
        `expected CreateModeIdError, got ${String(err)}`,
      );
      return true;
    },
  );
});

test("CreateGraph throws CreateModeIdError when a task has a persisted id", async () => {
  const deps = makeDeps();
  const uc = new CreateGraph(deps);
  const pkg = makeAuthoredPkg();
  const task0 = pkg.tasks[0];
  assert.ok(task0 !== undefined);
  pkg.tasks = [
    { ...task0, id: "01JQVBZ3MHKP4FTGWR5XYENSD7" },
    ...pkg.tasks.slice(1),
  ];

  await assert.rejects(
    () =>
      uc.execute({
        pkg,
        projectId: PROJECT_ID,
        packageId: PACKAGE_ID,
        paused: false,
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof CreateModeIdError,
        `expected CreateModeIdError, got ${String(err)}`,
      );
      return true;
    },
  );
});

test("CreateGraph throws when projectId does not exist", async () => {
  const deps = makeDeps({
    projects: new FakeProjectRepository([]), // no known projects
  });
  const uc = new CreateGraph(deps);

  await assert.rejects(
    () =>
      uc.execute({
        pkg: makeAuthoredPkg(),
        projectId: "NONEXISTENTPROJECTID00000001",
        packageId: PACKAGE_ID,
        paused: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must throw an Error");
      return true;
    },
  );
});

test("CreateGraph calls importMap.reserve once per objective + task with correct packageId, kind, ref, nodeId", async () => {
  const importMap = new FakeGraphImportMap();
  const deps = makeDeps({ importMap });
  const uc = new CreateGraph(deps);

  const result = await uc.execute({
    pkg: makeAuthoredPkg(),
    projectId: PROJECT_ID,
    packageId: PACKAGE_ID,
    paused: false,
  });

  const calls = importMap.reserveCalls;
  // 2 objectives + 2 tasks = 4 reserve calls (initiative NOT reserved)
  assert.equal(calls.length, 4, "4 reserve calls total");

  // All calls carry the correct packageId
  for (const c of calls) {
    assert.equal(c.packageId, PACKAGE_ID, "packageId must match");
    assert.ok(c.creationSha.length > 0, "creationSha must be non-empty");
  }

  const byKey = new Map(calls.map((c) => [`${c.kind}:${c.ref}`, c]));
  const backendCall = byKey.get("objective:backend");
  const frontendCall = byKey.get("objective:frontend");
  const apiCall = byKey.get("task:implement-api");
  const deployCall = byKey.get("task:deploy");

  assert.ok(backendCall !== undefined, "reserve called for objective:backend");
  assert.equal(
    backendCall.nodeId,
    result.refToId.objectives["backend"],
    "backend nodeId matches refToId",
  );

  assert.ok(
    frontendCall !== undefined,
    "reserve called for objective:frontend",
  );
  assert.equal(
    frontendCall.nodeId,
    result.refToId.objectives["frontend"],
    "frontend nodeId matches refToId",
  );

  assert.ok(apiCall !== undefined, "reserve called for task:implement-api");
  assert.equal(
    apiCall.nodeId,
    result.refToId.tasks["implement-api"],
    "implement-api nodeId matches refToId",
  );

  assert.ok(deployCall !== undefined, "reserve called for task:deploy");
  assert.equal(
    deployCall.nodeId,
    result.refToId.tasks["deploy"],
    "deploy nodeId matches refToId",
  );
});

test("CreateGraph throws CycleError for cyclic deps and saveAll is never called", async () => {
  const tasks = new FakeTaskRepository();
  const deps = makeDeps({ tasks });
  const uc = new CreateGraph(deps);

  const pkg = makeAuthoredPkg();
  const task0 = pkg.tasks[0];
  const task1 = pkg.tasks[1];
  assert.ok(task0 !== undefined && task1 !== undefined);
  // implement-api depends on deploy, deploy depends on implement-api → cycle
  pkg.tasks = [
    { ...task0, dependencies: ["deploy"] },
    { ...task1, dependencies: ["implement-api"] },
  ];

  await assert.rejects(
    () =>
      uc.execute({
        pkg,
        projectId: PROJECT_ID,
        packageId: PACKAGE_ID,
        paused: false,
      }),
    CycleError,
  );
  assert.equal(
    tasks.saveAllCalls.length,
    0,
    "saveAll must never be called when a cycle is detected",
  );
});

// ---------------------------------------------------------------------------
// Story 10 T4 — CreateGraph wires bindings → saveTaskContext
// ---------------------------------------------------------------------------

/** Package with initiative bindings + objective context (format-2 shape). */
function makeAuthoredPkgWithBindings(): GraphPackage {
  return {
    packageId: "",
    formatVersion: 2,
    initiative: {
      ref: "todo",
      name: "todo",
      sourcePath: "todo.md",
      bindings: {
        source: "repository",
        model: "ai_provider",
        "model-auth": "credential",
      },
    },
    objectives: [
      {
        ref: "api",
        initiativeRef: "todo",
        name: "api",
        sourcePath: "api/api.md",
        context: {
          source: "source",
          model: "model",
          "model-auth": "model-auth",
        },
      },
    ],
    tasks: [
      {
        ref: "impl",
        objectiveRef: "api",
        title: "implement api",
        instructions: "Build 5 REST endpoints.",
        ac: ["endpoints return correct status codes"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "api/impl.md",
      },
    ],
  };
}

test("T4(g): CreateGraph.execute with bindings calls saveTaskContext for each task", async () => {
  const tasks = new FakeTaskRepository();
  const deps = makeDeps({ tasks });
  const uc = new CreateGraph(deps);

  await uc.execute({
    pkg: makeAuthoredPkgWithBindings(),
    projectId: PROJECT_ID,
    packageId: PACKAGE_ID,
    paused: false,
    bindings: {
      source: T4_REPO_ID,
      model: T4_AIP_ID,
      "model-auth": T4_CRED_ID,
    },
  });

  assert.equal(
    tasks.saveTaskContextCalls.length,
    1,
    `saveTaskContext must be called once (one task); got ${tasks.saveTaskContextCalls.length}`,
  );
  const call = tasks.saveTaskContextCalls[0]!;
  // Context is keyed by resource TYPE (not alias): resolveTaskContext maps alias→type
  assert.equal(
    call.context["repository"],
    T4_REPO_ID,
    "context.repository must be T4_REPO_ID",
  );
  assert.equal(
    call.context["ai_provider"],
    T4_AIP_ID,
    "context.ai_provider must be T4_AIP_ID",
  );
  assert.equal(
    call.context["credential"],
    T4_CRED_ID,
    "context.credential must be T4_CRED_ID",
  );
});

test("T4(h): CreateGraph.execute with no bindings skips saveTaskContext entirely", async () => {
  const tasks = new FakeTaskRepository();
  const deps = makeDeps({ tasks });
  const uc = new CreateGraph(deps);

  await uc.execute({
    pkg: makeAuthoredPkg(), // no initiative.bindings (format-1)
    projectId: PROJECT_ID,
    packageId: PACKAGE_ID,
    paused: false,
    // bindings: undefined (omitted)
  });

  assert.equal(
    tasks.saveTaskContextCalls.length,
    0,
    "saveTaskContext must NOT be called when bindings is absent",
  );
});

// ─── Story 5b — after: on --create path ─────────────────────────────────────

import { describe } from "node:test";
import { sha256Hex } from "../../domain/sha.ts";
import { UnknownNodeError, CrossInitiativeError } from "./import-errors.ts";

interface CreateGraphSequencing {
  setInitiativeAfter(initiativeId: string, after: string[]): void;
  setObjectiveAfter(objectiveId: string, after: string[]): void;
}

class FakeCreateGraphSequencing implements CreateGraphSequencing {
  readonly initiativeAfterCalls: Array<{
    initiativeId: string;
    after: string[];
  }> = [];
  readonly objectiveAfterCalls: Array<{
    objectiveId: string;
    after: string[];
  }> = [];

  setInitiativeAfter(initiativeId: string, after: string[]): void {
    this.initiativeAfterCalls.push({ initiativeId, after });
  }

  setObjectiveAfter(objectiveId: string, after: string[]): void {
    this.objectiveAfterCalls.push({ objectiveId, after });
  }
}

/** Package with obj-2 after [obj-1]. */
function makeAuthoredPkgWithAfter(): GraphPackage {
  return {
    packageId: "",
    formatVersion: 1,
    initiative: { ref: "oauth", name: "oauth", sourcePath: "oauth.md" },
    objectives: [
      {
        ref: "obj-1",
        initiativeRef: "oauth",
        name: "obj1",
        sourcePath: "obj1/obj1.md",
      },
      {
        ref: "obj-2",
        initiativeRef: "oauth",
        name: "obj2",
        sourcePath: "obj2/obj2.md",
        after: ["obj-1"],
      },
    ],
    tasks: [
      {
        ref: "task1",
        objectiveRef: "obj-1",
        title: "task1",
        instructions: "Do thing",
        ac: ["task1 works"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "obj1/task1.md",
      },
      {
        ref: "task2",
        objectiveRef: "obj-2",
        title: "task2",
        instructions: "Do other",
        ac: ["task2 works"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "obj2/task2.md",
      },
    ],
  };
}

describe("Story 5b — after: on --create path", () => {
  test("(1) after: [obj-1] → setObjectiveAfter called for obj-2 with [<obj-1's minted id>], and for obj-1 with []", async () => {
    const sequencing = new FakeCreateGraphSequencing();
    const deps = makeDeps({ sequencing: sequencing as any });
    const uc = new CreateGraph(deps as any);
    const pkg = makeAuthoredPkgWithAfter();

    const result = await uc.execute({
      pkg,
      projectId: PROJECT_ID,
      packageId: PACKAGE_ID,
      paused: false,
    });
    const obj1Id = result.refToId.objectives["obj-1"];
    const obj2Id = result.refToId.objectives["obj-2"];

    assert.equal(
      sequencing.objectiveAfterCalls.length,
      2,
      "setObjectiveAfter must be called for both objectives",
    );
    const obj1Call = sequencing.objectiveAfterCalls.find(
      (c) => c.objectiveId === obj1Id,
    );
    const obj2Call = sequencing.objectiveAfterCalls.find(
      (c) => c.objectiveId === obj2Id,
    );
    assert.ok(obj1Call !== undefined, "setObjectiveAfter called for obj-1");
    assert.ok(obj2Call !== undefined, "setObjectiveAfter called for obj-2");

    assert.deepEqual(obj1Call!.after, [], "obj-1 has empty after set");
    assert.deepEqual(
      obj2Call!.after,
      [obj1Id],
      "obj-2 after resolved to obj-1's minted id",
    );
  });

  test("(2) manifest sha for obj-2 must include after in its canonical form", async () => {
    const sequencing = new FakeCreateGraphSequencing();
    const deps = makeDeps({ sequencing: sequencing as any });
    const uc = new CreateGraph(deps as any);
    const pkg = makeAuthoredPkgWithAfter();

    const result = await uc.execute({
      pkg,
      projectId: PROJECT_ID,
      packageId: PACKAGE_ID,
      paused: false,
    });
    const initiativeId = result.initiativeId;
    const obj1Id = result.refToId.objectives["obj-1"]!;
    const obj2Id = result.refToId.objectives["obj-2"]!;

    // Compute expected sha WITH after using raw JSON — canonicalObjective
    // (pre-update) ignores after, so this assertion will fail in RED phase.
    const expectedObj2Sha = sha256Hex(
      JSON.stringify({
        name: "obj2",
        initiativeId,
        after: [obj1Id],
      }),
    );
    assert.equal(
      result.nodes[obj2Id],
      expectedObj2Sha,
      "obj-2 sha must include after: [obj1Id] in canonical form",
    );
  });

  test("(3) after: [obj-1b, obj-1] yields sorted [obj-1Id, obj-1bId] in setObjectiveAfter", async () => {
    const sequencing = new FakeCreateGraphSequencing();
    const deps = makeDeps({ sequencing: sequencing as any });
    const uc = new CreateGraph(deps as any);

    const pkg = makeAuthoredPkgWithAfter();
    // Add obj-1b and change obj-2's after to [obj-1b, obj-1] (reversed order)
    pkg.objectives = [
      ...pkg.objectives,
      {
        ref: "obj-1b",
        initiativeRef: "oauth",
        name: "obj1b",
        sourcePath: "obj1b/obj1b.md",
      },
    ];
    const obj2 = pkg.objectives.find((o) => o.ref === "obj-2");
    assert.ok(obj2 !== undefined);
    obj2.after = ["obj-1b", "obj-1"];

    const result = await uc.execute({
      pkg,
      projectId: PROJECT_ID,
      packageId: PACKAGE_ID,
      paused: false,
    });
    const obj1Id = result.refToId.objectives["obj-1"];
    const obj1bId = result.refToId.objectives["obj-1b"];

    const obj2Call = sequencing.objectiveAfterCalls.find(
      (c) => c.objectiveId === result.refToId.objectives["obj-2"],
    );
    assert.ok(obj2Call !== undefined, "setObjectiveAfter called for obj-2");
    // After set must be sorted ascending: [obj-1Id, obj-1bId]
    assert.deepEqual(
      obj2Call!.after,
      [obj1Id, obj1bId],
      "after must be sorted ascending by ULID",
    );
  });

  test("(4) initiative after: [existing ULID in same project] → setInitiativeAfter called with that ULID", async () => {
    const EXISTING_INIT = "00000000000000000000000001";
    const sequencing = new FakeCreateGraphSequencing();
    const initiatives = new FakeInitiativeRepository();
    // Seed: get() returns initiative when queried with EXISTING_INIT
    (initiatives as any).knownInitiatives = {
      [EXISTING_INIT]: {
        id: EXISTING_INIT,
        projectId: PROJECT_ID,
        name: "existing-init",
      },
    };
    initiatives.get = (id: string) =>
      (initiatives as any).knownInitiatives[id] ?? undefined;
    const projects = new FakeProjectRepository([PROJECT_ID]);

    // Override initiatives in makeDeps
    const importMap = new FakeGraphImportMap();
    const tasks = new FakeTaskRepository();
    const uow = new FakeUnitOfWork();
    const deps = {
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      projects,
      importMap,
      uow,
      newId: (() => {
        let n = 100;
        return () => String(n++).padStart(26, "0");
      })(),
      sequencing: sequencing as any,
    };
    const uc = new CreateGraph(deps as any);

    const pkg = makeAuthoredPkg();
    pkg.initiative.after = [EXISTING_INIT];

    const result = await uc.execute({
      pkg,
      projectId: PROJECT_ID,
      packageId: PACKAGE_ID,
      paused: false,
    });

    assert.equal(
      sequencing.initiativeAfterCalls.length,
      1,
      "setInitiativeAfter must be called once",
    );
    assert.deepEqual(
      sequencing.initiativeAfterCalls[0]!.after,
      [EXISTING_INIT],
      "after set must contain the existing ULID",
    );
  });

  test("(5) initiative after: [ULID in another project] → CrossInitiativeError", async () => {
    const OTHER_INIT = "00000000000000000000000002";
    const sequencing = new FakeCreateGraphSequencing();
    const initiatives = new FakeInitiativeRepository();
    (initiatives as any).knownInitiatives = {
      [OTHER_INIT]: {
        id: OTHER_INIT,
        projectId: "00000000000000000000000098", // different project from PROJECT_ID
        name: "other-init",
      },
    };
    initiatives.get = (id: string) =>
      (initiatives as any).knownInitiatives[id] ?? undefined;
    const projects = new FakeProjectRepository([PROJECT_ID]);
    const importMap = new FakeGraphImportMap();
    const tasks = new FakeTaskRepository();
    const uow = new FakeUnitOfWork();
    const deps = {
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      projects,
      importMap,
      uow,
      newId: (() => {
        let n = 200;
        return () => String(n++).padStart(26, "0");
      })(),
      sequencing: sequencing as any,
    };
    const uc = new CreateGraph(deps as any);

    const pkg = makeAuthoredPkg();
    pkg.initiative.after = [OTHER_INIT];

    await assert.rejects(
      () =>
        uc.execute({
          pkg,
          projectId: PROJECT_ID,
          packageId: PACKAGE_ID,
          paused: false,
        }),
      CrossInitiativeError,
    );
  });

  test("(6) initiative after: [some-slug] → UnknownNodeError", async () => {
    const sequencing = new FakeCreateGraphSequencing();
    const deps = makeDeps({ sequencing: sequencing as any });
    const uc = new CreateGraph(deps as any);

    const pkg = makeAuthoredPkg();
    pkg.initiative.after = ["some-slug"];

    await assert.rejects(
      () =>
        uc.execute({
          pkg,
          projectId: PROJECT_ID,
          packageId: PACKAGE_ID,
          paused: false,
        }),
      UnknownNodeError,
    );
  });

  test("(7) objective after: [no-such-ref] → UnknownNodeError", async () => {
    const sequencing = new FakeCreateGraphSequencing();
    const deps = makeDeps({ sequencing: sequencing as any });
    const uc = new CreateGraph(deps as any);

    const pkg = makeAuthoredPkgWithAfter();
    const obj2 = pkg.objectives.find((o) => o.ref === "obj-2");
    assert.ok(obj2 !== undefined);
    obj2.after = ["no-such-ref"];

    await assert.rejects(
      () =>
        uc.execute({
          pkg,
          projectId: PROJECT_ID,
          packageId: PACKAGE_ID,
          paused: false,
        }),
      UnknownNodeError,
    );
  });

  test("(8) obj-1 after [obj-2] and obj-2 after [obj-1] → CycleError before any write", async () => {
    const sequencing = new FakeCreateGraphSequencing();
    const tasks = new FakeTaskRepository();
    const deps = makeDeps({ sequencing: sequencing as any, tasks });
    const uc = new CreateGraph(deps as any);

    const pkg = makeAuthoredPkgWithAfter();
    // Mutate obj-1's after to [obj-2], creating a cycle
    const obj1 = pkg.objectives.find((o) => o.ref === "obj-1");
    assert.ok(obj1 !== undefined);
    pkg.objectives = [
      { ...obj1, after: ["obj-2"] },
      ...pkg.objectives.filter((o) => o.ref !== "obj-1"),
    ];

    await assert.rejects(
      () =>
        uc.execute({
          pkg,
          projectId: PROJECT_ID,
          packageId: PACKAGE_ID,
          paused: false,
        }),
      CycleError,
    );
    assert.equal(
      tasks.saveAllCalls.length,
      0,
      "saveAll must never be called when cycle is detected",
    );
  });

  test("(9) no after: anywhere → set*After called with [] and shas backward-compatible", async () => {
    const sequencing = new FakeCreateGraphSequencing();
    const deps = makeDeps({ sequencing: sequencing as any });
    const uc = new CreateGraph(deps as any);
    const pkg = makeAuthoredPkg(); // no after on any node

    const result = await uc.execute({
      pkg,
      projectId: PROJECT_ID,
      packageId: PACKAGE_ID,
      paused: false,
    });

    // setInitiativeAfter called with []
    assert.equal(
      sequencing.initiativeAfterCalls.length,
      1,
      "setInitiativeAfter must be called once",
    );
    assert.deepEqual(
      sequencing.initiativeAfterCalls[0]!.after,
      [],
      "initiative after must be empty",
    );

    // setObjectiveAfter called for each objective with []
    assert.equal(
      sequencing.objectiveAfterCalls.length,
      2,
      "setObjectiveAfter must be called for each objective",
    );
    for (const call of sequencing.objectiveAfterCalls) {
      assert.deepEqual(call.after, [], "objective after must be empty");
    }

    // Shas must still match the old canonical form (backward compatible with empty after)
    const initiativeId = result.initiativeId;
    for (const obj of pkg.objectives) {
      const objId = result.refToId.objectives[obj.ref]!;
      const sha = result.nodes[objId];
      assert.ok(
        typeof sha === "string" && sha.length > 0,
        `sha for ${obj.ref} must be non-empty`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Story 1 (012) — `paused` rides in the CreateGraph initiative literal. The
// use case must not call CreateInitiative (no use-case-calls-use-case); it
// builds the Initiative literal itself inside its own uow.transaction.
// ---------------------------------------------------------------------------

test("CreateGraph execute({ paused: true }) writes paused === true on the saved initiative", async () => {
  const deps = makeDeps();
  const uc = new CreateGraph(deps);
  await uc.execute({
    pkg: makeAuthoredPkg(),
    projectId: PROJECT_ID,
    packageId: PACKAGE_ID,
    paused: true,
  });
  assert.equal(deps.initiatives.saved.length, 1, "one initiative was saved");
  assert.equal(
    deps.initiatives.saved[0]!.paused,
    true,
    "CreateGraph must write paused === true into the initiative literal",
  );
});

test("CreateGraph execute({ paused: false }) writes paused === false on the saved initiative", async () => {
  const deps = makeDeps();
  const uc = new CreateGraph(deps);
  await uc.execute({
    pkg: makeAuthoredPkg(),
    projectId: PROJECT_ID,
    packageId: PACKAGE_ID,
    paused: false,
  });
  assert.equal(deps.initiatives.saved.length, 1, "one initiative was saved");
  assert.equal(
    deps.initiatives.saved[0]!.paused,
    false,
    "CreateGraph must write paused === false into the initiative literal",
  );
});
