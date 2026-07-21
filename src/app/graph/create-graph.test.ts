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
    () => uc.execute({ pkg, projectId: PROJECT_ID, packageId: PACKAGE_ID }),
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
    () => uc.execute({ pkg, projectId: PROJECT_ID, packageId: PACKAGE_ID }),
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
    () => uc.execute({ pkg, projectId: PROJECT_ID, packageId: PACKAGE_ID }),
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
    // bindings: undefined (omitted)
  });

  assert.equal(
    tasks.saveTaskContextCalls.length,
    0,
    "saveTaskContext must NOT be called when bindings is absent",
  );
});
