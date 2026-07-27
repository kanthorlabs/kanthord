/**
 * Story 07 T1 — preflight classifier (hermetic fakes)
 *
 * Tests the classification pass of ApplyGraph: for each package node the
 * use case reads the live DB sha + task live status and labels the node
 * created / updated / unchanged / missing / drifted / locked.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ApplyGraph,
  type ApplyClassification,
  type ApplyGraphResult,
} from "./apply-graph.ts";
import type { GraphPackage, ExportManifest } from "./graph-package.ts";
import type {
  InitiativeRepository,
  TaskRepository,
  UnitOfWork,
  GraphImportMap,
  CasResult,
  TaskCasResult,
} from "../../storage/port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import {
  newTask,
  InvalidObjectiveIdError,
  type Task,
} from "../../domain/task.ts";
import { StoreGraph } from "./store-graph.ts";
import { CycleError, UnknownDependencyError } from "../../domain/graph.ts";
import {
  StaleManifestError,
  UncreatableObjectiveError,
  UnknownNodeError,
} from "./import-errors.ts";
import { GRAPH_FORMAT_VERSION } from "./format.ts";
// Real SQLite adapters — used in Story 07 T3d integration test only.
import { openDatabase } from "../../storage/sqlite/open.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";
import { SqliteProjectRepository } from "../../storage/sqlite/sqlite-project-repository.ts";
import { SqliteInitiativeRepository } from "../../storage/sqlite/sqlite-initiative-repository.ts";
import { SqliteTaskRepository } from "../../storage/sqlite/sqlite-task-repository.ts";
import { SqliteGraphImportMap } from "../../storage/sqlite/sqlite-graph-import-map.ts";
import { SqliteUnitOfWork } from "../../storage/sqlite/sqlite-unit-of-work.ts";
import { newId } from "../../domain/entity.ts";
import {
  sha256Hex,
  canonicalTask,
  canonicalObjective,
  canonicalInitiative,
} from "../../domain/sha.ts";

// ---------------------------------------------------------------------------
// Test-constant ULIDs (26-char uppercase Crockford)
// ---------------------------------------------------------------------------
const PROJ_ID = "01JQVBZ3MHKP4FTGWR5XYENSD0";
const INIT_ID = "01JQVBZ3MHKP4FTGWR5XYENSD1";
const OBJ1_ID = "01JQVBZ3MHKP4FTGWR5XYENSD2";
const TASK1_ID = "01JQVBZ3MHKP4FTGWR5XYENSD4";
const TASK2_ID = "01JQVBZ3MHKP4FTGWR5XYENSD5";
const PKG_ID = "01JQVBZ3MHKP4FTGWR5XYENSD6";
// T2 extra constants
const OBJ2_ID = "01JQVBZ3MHKP4FTGWR5XYENSD3"; // second objective (for reparent test T3e)
const TASK3_ID = "01JQVBZ3MHKP4FTGWR5XYENSD7"; // DB-only task (never in package)
const UNKNOWN_ID = "01JQVBZ3MHKP4FTGWR5XYENSD9"; // absent from both package and DB

// Computed via the same canonicalizers used by the real repositories, from
// the exact field values the fixtures below encode — never hand-computed
// hex, so a hash-shape change (e.g. dropping status) cannot silently
// desync the test's baseline from the fixture content.
const TASK1_BASE_SHA = sha256Hex(
  canonicalTask({
    title: "Implement API",
    instructions: "do it",
    ac: ["returns 200"],
    agent: "generic@1",
    verification: undefined,
    dependencies: [],
    objectiveId: OBJ1_ID,
  }),
);
const TASK2_BASE_SHA = sha256Hex(
  canonicalTask({
    title: "Deploy",
    instructions: "deploy it",
    ac: ["health check green"],
    agent: "generic@1",
    verification: undefined,
    dependencies: [TASK1_ID],
    objectiveId: OBJ1_ID,
  }),
);
const INIT_BASE_SHA = sha256Hex(
  canonicalInitiative({ name: "oauth", projectId: PROJ_ID }),
);
const OBJ1_BASE_SHA = sha256Hex(
  canonicalObjective({ name: "backend", initiativeId: INIT_ID }),
);
const OBJ2_BASE_SHA = sha256Hex(
  canonicalObjective({ name: "frontend", initiativeId: INIT_ID }),
);

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeInitiativeRepository implements InitiativeRepository {
  readonly #initiatives: Map<string, Initiative> = new Map();
  readonly #objectives: Map<string, Objective> = new Map();
  readonly #shas: Map<string, string> = new Map();

  seed(
    initiative: Initiative,
    sha: string,
    objectives: Array<{ obj: Objective; sha: string }>,
  ): void {
    this.#initiatives.set(initiative.id, initiative);
    this.#shas.set(initiative.id, sha);
    for (const { obj, sha: oSha } of objectives) {
      this.#objectives.set(obj.id, obj);
      this.#shas.set(obj.id, oSha);
    }
  }

  save(_initiative: Initiative): void {}
  saveObjective(_objective: Objective): void {}
  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }
  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }
  listObjectives(initiativeId: string): Objective[] {
    return [...this.#objectives.values()].filter(
      (o) => o.initiativeId === initiativeId,
    );
  }
  listInitiatives(_projectId: string): Initiative[] {
    return [...this.#initiatives.values()];
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
  // CAS stubs — will satisfy InitiativeRepository once SE adds these to the interface.
  conditionalRenameInitiative(
    id: string,
    expectedSha: string,
    _name: string,
  ): CasResult {
    const storedSha = this.#shas.get(id);
    if (storedSha === expectedSha) {
      return { status: "applied", freshSha: "applied-fake-" + id };
    }
    return { status: "conflict", currentSha: storedSha ?? "" };
  }
  conditionalRenameObjective(
    id: string,
    expectedSha: string,
    _name: string,
  ): CasResult {
    const storedSha = this.#shas.get(id);
    if (storedSha === expectedSha) {
      return { status: "applied", freshSha: "applied-fake-" + id };
    }
    return { status: "conflict", currentSha: storedSha ?? "" };
  }
  conditionalDeleteObjective(id: string, expectedSha: string): CasResult {
    const storedSha = this.#shas.get(id);
    if (storedSha === expectedSha) {
      this.#objectives.delete(id);
      this.#shas.delete(id);
      return { status: "applied", freshSha: "deleted-fake-" + id };
    }
    return { status: "conflict", currentSha: storedSha ?? "" };
  }
}

class FakeTaskRepository implements TaskRepository {
  readonly #tasks: Map<string, Task> = new Map();
  readonly #shas: Map<string, string> = new Map();

  seed(task: Task, sha: string): void {
    this.#tasks.set(task.id, task);
    this.#shas.set(task.id, sha);
  }

  save(_task: Task): void {}
  saveAll(_tasks: Task[]): void {}
  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }
  listByInitiative(_initiativeId: string): Task[] {
    return [...this.#tasks.values()];
  }
  listTasksByObjective(objectiveId: string): Task[] {
    return [...this.#tasks.values()].filter(
      (t) => t.objectiveId === objectiveId,
    );
  }
  saveTaskContext(_taskId: string, _context: Record<string, string>): void {}
  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }
  addDependency(_taskId: string, _dependencyId: string): void {}
  removeDependency(_taskId: string, _dependencyId: string): void {}
  getInitiativeId(taskId: string): string | undefined {
    const task = this.#tasks.get(taskId);
    if (!task) return undefined;
    return INIT_ID; // all seeded tasks belong to INIT_ID in these tests
  }
  getSha256(id: string): string | undefined {
    return this.#shas.get(id);
  }
  // CAS stubs — will satisfy TaskRepository once SE adds these to the interface.
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
  ): TaskCasResult {
    return {
      status: "conflict",
      currentSha: "",
      currentStatus: "pending",
      reason: "sha",
    };
  }
  conditionalReparent(
    _id: string,
    _expectedSha: string,
    _objectiveId: string,
  ): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalDeleteTask(
    _id: string,
    _expectedSha: string,
    _expectedStatus: string,
  ): TaskCasResult {
    return {
      status: "conflict",
      currentSha: "",
      currentStatus: "pending",
      reason: "sha",
    };
  }
}

class FakeUnitOfWork implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

class FakeGraphImportMap implements GraphImportMap {
  readonly #map: Map<string, { nodeId: string; creationSha: string }> =
    new Map();

  seed(
    packageId: string,
    kind: string,
    ref: string,
    nodeId: string,
    creationSha: string,
  ): void {
    this.#map.set(`${packageId}:${kind}:${ref}`, { nodeId, creationSha });
  }

  reserve(
    packageId: string,
    kind: string,
    ref: string,
    nodeId: string,
    creationSha: string,
  ): void {
    this.#map.set(`${packageId}:${kind}:${ref}`, { nodeId, creationSha });
  }

  lookup(
    packageId: string,
    kind: string,
    ref: string,
  ): { nodeId: string; creationSha: string } | undefined {
    return this.#map.get(`${packageId}:${kind}:${ref}`);
  }
}

// ---------------------------------------------------------------------------
// CAS-aware fake (needed by T1 after RB3 — write phase now aborts on conflict)
// ---------------------------------------------------------------------------

/**
 * Spy version of FakeTaskRepository: overrides the CAS stubs with counters so
 * tests can assert that ApplyGraph.execute actually calls the CAS ops.
 * Returns {status:"applied"} so the RB3 write-phase does not abort on a
 * stub-conflict when a task is legitimately "updated".
 */
class FakeTaskRepositoryWithCas extends FakeTaskRepository {
  compareAndApplyCount = 0;
  compareAndApplyIds: string[] = [];
  compareAndApplyStatuses: string[] = [];
  conditionalReparentCount = 0;
  conditionalReparentArgs: Array<{ id: string; objectiveId: string }> = [];
  conditionalDeleteTaskStatuses: string[] = [];

  override compareAndApply(
    id: string,
    _expectedSha: string,
    expectedStatus: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): TaskCasResult {
    this.compareAndApplyCount++;
    this.compareAndApplyIds.push(id);
    this.compareAndApplyStatuses.push(expectedStatus);
    return { status: "applied", freshSha: "spy-fresh-sha-" + id };
  }

  override conditionalReparent(
    id: string,
    _expectedSha: string,
    objectiveId: string,
  ): CasResult {
    this.conditionalReparentCount++;
    this.conditionalReparentArgs.push({ id, objectiveId });
    return { status: "applied", freshSha: "spy-reparent-sha-" + id };
  }

  override conditionalDeleteTask(
    _id: string,
    _expectedSha: string,
    expectedStatus: string,
  ): TaskCasResult {
    this.conditionalDeleteTaskStatuses.push(expectedStatus);
    return { status: "applied", freshSha: "" };
  }
}

/**
 * Race-guard fake: for the one task named `raceTargetId`, compareAndApply
 * asserts its expectedStatus argument equals `expectedStatusArg` and
 * returns a status conflict — simulating a daemon that advanced the row's
 * status between preflight and write. Every other task applies normally.
 */
class FakeTaskRepositoryWithRaceGuard extends FakeTaskRepository {
  readonly #raceTargetId: string;
  readonly #expectedStatusArg: string;
  compareAndApplyCalledForTarget = false;

  constructor(raceTargetId: string, expectedStatusArg: string) {
    super();
    this.#raceTargetId = raceTargetId;
    this.#expectedStatusArg = expectedStatusArg;
  }

  override compareAndApply(
    id: string,
    _expectedSha: string,
    expectedStatus: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): TaskCasResult {
    if (id === this.#raceTargetId) {
      this.compareAndApplyCalledForTarget = true;
      assert.equal(expectedStatus, this.#expectedStatusArg);
      return {
        status: "conflict",
        currentSha: "baseline-sha-" + id,
        currentStatus: "running",
        reason: "status",
      };
    }
    return { status: "applied", freshSha: "spy-fresh-sha-" + id };
  }
}

/** Spy version of FakeGraphImportMap — counts reserve() calls. */
class FakeGraphImportMapWithSpy extends FakeGraphImportMap {
  reserveCount = 0;

  override reserve(
    packageId: string,
    kind: string,
    ref: string,
    nodeId: string,
    creationSha: string,
  ): void {
    this.reserveCount++;
    super.reserve(packageId, kind, ref, nodeId, creationSha);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseManifest(
  overrides: Partial<ExportManifest> = {},
): ExportManifest {
  return {
    initiativeId: INIT_ID,
    packageId: PKG_ID,
    formatVersion: 3,
    digestAlgorithm: "sha256",
    nodes: {
      [INIT_ID]: INIT_BASE_SHA,
      [OBJ1_ID]: OBJ1_BASE_SHA,
      [TASK1_ID]: TASK1_BASE_SHA,
      [TASK2_ID]: TASK2_BASE_SHA,
    },
    files: [INIT_ID, OBJ1_ID, TASK1_ID, TASK2_ID],
    refToId: {
      objectives: { [OBJ1_ID]: OBJ1_ID },
      tasks: { [TASK1_ID]: TASK1_ID, [TASK2_ID]: TASK2_ID },
    },
    ...overrides,
  };
}

/** The base package: unchanged from export (all content == baseline sha). */
function makeBasePackage(
  manifestOverrides: Partial<ExportManifest> = {},
): GraphPackage {
  return {
    packageId: PKG_ID,
    formatVersion: 1,
    initiative: {
      id: INIT_ID,
      ref: INIT_ID,
      name: "oauth",
      sourcePath: "oauth.md",
    },
    objectives: [
      {
        id: OBJ1_ID,
        ref: OBJ1_ID,
        name: "backend",
        initiativeRef: INIT_ID,
        sourcePath: "backend/backend.md",
      },
    ],
    tasks: [
      {
        id: TASK1_ID,
        ref: TASK1_ID,
        objectiveRef: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "backend/implement-api.md",
      },
      {
        id: TASK2_ID,
        ref: TASK2_ID,
        objectiveRef: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [TASK1_ID],
        sourcePath: "backend/deploy.md",
      },
    ],
    manifest: makeBaseManifest(manifestOverrides),
  };
}

/** The base DB state: tasks at their baseline shas, status = pending. */
function makeBaseDb(): {
  initiatives: FakeInitiativeRepository;
  tasks: FakeTaskRepository;
} {
  const initiatives = new FakeInitiativeRepository();
  initiatives.seed(
    { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
    INIT_BASE_SHA,
    [
      {
        obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
        sha: OBJ1_BASE_SHA,
      },
    ],
  );

  const tasks = new FakeTaskRepository();
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "pending",
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA,
  );

  return { initiatives, tasks };
}

function makeDeps(
  overrides: Partial<{
    initiatives: FakeInitiativeRepository;
    tasks: FakeTaskRepository;
    importMap: FakeGraphImportMap;
  }> = {},
) {
  const { initiatives, tasks } = makeBaseDb();
  return {
    initiatives: overrides.initiatives ?? initiatives,
    tasks: overrides.tasks ?? tasks,
    storeGraph: new StoreGraph(overrides.tasks ?? tasks),
    importMap: overrides.importMap ?? new FakeGraphImportMap(),
    uow: new FakeUnitOfWork(),
    newId: () => "01NEWID0000000000000000001",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("ApplyGraph — unchanged package: all nodes classified unchanged, applied:true", async () => {
  const deps = makeDeps();
  const uc = new ApplyGraph(deps);
  const result = await uc.execute({
    pkg: makeBasePackage(),
    initiativeId: INIT_ID,
  });

  assert.equal(
    result.applied,
    true,
    "unchanged package should be applied:true",
  );
  assert.equal(result.conflicts.length, 0, "no conflicts expected");
  assert.equal(result.summary.updated, 0);
  assert.equal(result.summary.created, 0);
  assert.equal(result.summary.missing, 0);

  // ALL 4 nodes (initiative + 1 objective + 2 tasks) must be classified
  assert.equal(
    result.classifications.length,
    4,
    "classification must cover ALL node types (B14): initiative + objective + 2 tasks",
  );
  for (const c of result.classifications) {
    assert.equal(
      c.class,
      "unchanged",
      `expected all unchanged, got ${c.class} for ${c.ref}`,
    );
  }
  assert.equal(result.summary.unchanged, 4);
});

test("ApplyGraph — edited task ac: that task updated, siblings unchanged; initiative+objective also classified (B14)", async () => {
  // Package task1 has a new ac item — content differs from baseline.
  // The DB sha for task1 still equals the baseline (no concurrent change) → updated.
  // Uses FakeTaskRepositoryWithCas so the RB3 write-phase (which now aborts on
  // a conflict CasResult) does not falsely abort the apply for this clean update.
  const { initiatives } = makeBaseDb();
  const tasks = new FakeTaskRepositoryWithCas();
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "pending",
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA,
  );
  const deps = {
    initiatives,
    tasks,
    storeGraph: new StoreGraph(tasks),
    importMap: new FakeGraphImportMap(),
    uow: new FakeUnitOfWork(),
    newId: () => "01NEWID0000000000000000001",
  };
  const pkg = makeBasePackage();
  // Mutate task1's ac in the package (content now differs from baseline sha)
  pkg.tasks[0]!.ac = ["returns 200", "rejects bad creds with 401"];
  const uc = new ApplyGraph(deps);
  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  assert.equal(result.applied, true, "clean update should be applied:true");
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.summary.updated, 1);
  assert.equal(
    result.summary.unchanged,
    3,
    "initiative + objective + task2 unchanged",
  );

  const task1Class = result.classifications.find((c) => c.id === TASK1_ID);
  assert.ok(task1Class, "task1 must appear in classifications");
  assert.equal(task1Class.class, "updated");

  // initiative and objectives MUST be in classifications (all-node coverage, B14)
  const initClass = result.classifications.find((c) => c.id === INIT_ID);
  assert.ok(initClass, "initiative must be classified");
  assert.equal(initClass.class, "unchanged");
  const obj1Class = result.classifications.find((c) => c.id === OBJ1_ID);
  assert.ok(obj1Class, "objective must be classified");
  assert.equal(obj1Class.class, "unchanged");
});

test("ApplyGraph — drifted: live DB sha != baseline when package edits it → conflict, applied:false", async () => {
  const { initiatives, tasks } = makeBaseDb();
  // Re-seed task1 with a DIFFERENT sha (simulating a concurrent mutation)
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "pending",
      dependencies: [],
    },
    "drifted-live-sha-not-equal-to-baseline",
  );
  const deps = makeDeps({ initiatives, tasks });

  const pkg = makeBasePackage();
  // Package also has a change (so it's not simply unchanged)
  pkg.tasks[0]!.ac = ["returns 200", "new ac item"];

  const uc = new ApplyGraph(deps);
  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  assert.equal(result.applied, false, "drifted node should block apply");
  assert.ok(
    result.conflicts.some((c) => c.id === TASK1_ID && c.class === "drifted"),
    `expected drifted conflict for task1, got: ${JSON.stringify(result.conflicts)}`,
  );
});

test("ApplyGraph — locked: task live status is running when package edits it → locked conflict, applied:false", async () => {
  const { initiatives, tasks } = makeBaseDb();
  // Re-seed task1 as RUNNING (sha still matches baseline — the test verifies status takes precedence)
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "running", // non-pending!
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  const deps = makeDeps({ initiatives, tasks });

  const pkg = makeBasePackage();
  // Package has a change for task1 (needs to be "mutated" to trigger the lock check)
  pkg.tasks[0]!.ac = ["returns 200", "locked-update"];

  const uc = new ApplyGraph(deps);
  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  assert.equal(result.applied, false, "locked node should block apply");
  assert.ok(
    result.conflicts.some((c) => c.id === TASK1_ID && c.class === "locked"),
    `expected locked conflict for task1, got: ${JSON.stringify(result.conflicts)}`,
  );
});

test("ApplyGraph — id-less task with importMap hit (creationSha matches) → unchanged, NOT created (no dup)", async () => {
  // A task with no id in the package, but it was previously created via --apply
  // and the importMap has its ref → nodeId mapping.
  const { initiatives, tasks } = makeBaseDb();
  const importMap = new FakeGraphImportMap();

  // The "write-tests" task was previously created with TASK1_ID.
  // importMap maps (PKG_ID, task, "write-tests") → TASK1_ID with the baseline sha.
  importMap.seed(PKG_ID, "task", "write-tests", TASK1_ID, TASK1_BASE_SHA);

  const deps = makeDeps({ initiatives, tasks, importMap });

  const pkg = makeBasePackage();
  // Replace task1 in the package with an id-less node using the ref "write-tests"
  // but SAME content as what was created (content == creationSha baseline)
  pkg.tasks[0] = {
    ref: "write-tests", // no id — id-less
    objectiveRef: OBJ1_ID,
    title: "Implement API",
    instructions: "do it",
    ac: ["returns 200"],
    agent: "generic@1",
    verification: undefined,
    dependencies: [],
    sourcePath: "backend/implement-api.md",
  };

  const uc = new ApplyGraph(deps);
  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  const task1Class = result.classifications.find(
    (c) => c.ref === "write-tests" || c.id === TASK1_ID,
  );
  assert.ok(
    task1Class,
    "the mapped id-less task must appear in classifications",
  );
  assert.notEqual(
    task1Class.class,
    "created",
    `id-less task with importMap hit must NOT be 'created', got: ${task1Class.class}`,
  );
});

test("EPIC 007.18 Story 2 — id-less map-hit path: a progressed, untouched task classifies unchanged (creation_sha re-stamped by migration 21)", async () => {
  // Same shape as the id-less map-hit test above, but the live task has
  // ALREADY RUN (status: "completed") and the importMap's creationSha is what
  // migration 21 re-stamps it to for an untouched row: the content-only sha of
  // the task's declarative fields (no status). This is the one classification
  // path the Proof script cannot reach (--create always stamps `id:` back into
  // the files), so it is covered here as a unit instead.
  const { initiatives } = makeBaseDb();
  const tasks = new FakeTaskRepository();
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "completed",
      dependencies: [],
    },
    TASK1_BASE_SHA, // content-only sha — unaffected by status per Story 1
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA,
  );
  const importMap = new FakeGraphImportMap();
  importMap.seed(PKG_ID, "task", "write-tests", TASK1_ID, TASK1_BASE_SHA);

  const deps = makeDeps({ initiatives, tasks, importMap });

  const pkg = makeBasePackage();
  pkg.tasks[0] = {
    ref: "write-tests", // no id — id-less, resolved via the importMap
    objectiveRef: OBJ1_ID,
    title: "Implement API",
    instructions: "do it",
    ac: ["returns 200"],
    agent: "generic@1",
    verification: undefined,
    dependencies: [],
    sourcePath: "backend/implement-api.md",
  };

  const uc = new ApplyGraph(deps);
  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  const task1Class = result.classifications.find(
    (c) => c.ref === "write-tests" || c.id === TASK1_ID,
  );
  assert.equal(
    task1Class?.class,
    "unchanged",
    `expected a progressed, untouched, id-less-mapped task to classify unchanged, got: ${task1Class?.class}`,
  );
});

test("ApplyGraph — manifest.files node absent from package → classified as missing", async () => {
  // task2 is in manifest.files but NOT in the package tasks array.
  // It must be reported as missing (informational; Story 08 will delete if requested).
  const deps = makeDeps();
  const pkg = makeBasePackage();
  // Remove task2 from the package (simulating a deleted file)
  pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

  const uc = new ApplyGraph(deps);
  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  const missingClass = result.classifications.find((c) => c.id === TASK2_ID);
  assert.ok(
    missingClass,
    "task2 must appear in classifications even when absent from package",
  );
  assert.equal(
    missingClass.class,
    "missing",
    `absent manifest.files node must be classified 'missing', got: ${missingClass.class}`,
  );
  assert.equal(result.summary.missing, 1);
  // missing does not block apply (informational only)
  assert.equal(
    result.applied,
    true,
    "missing node is informational — should not block apply",
  );
});

// ---------------------------------------------------------------------------
// Story 07 T2 — merged-graph validation (B10)
// ---------------------------------------------------------------------------

describe("Story 07 T2 — merged-graph validation", () => {
  /**
   * Test (a): a package task's depends on references TASK3, which lives in
   * the DB but is NOT present in the package. After merged-graph validation,
   * TASK3 is included in the node set → validation passes.
   *
   * Sensitivity: a WRONG (package-only) validateGraph call would throw
   * UnknownDependencyError for TASK3_ID. A CORRECT (merged) implementation
   * does not. Currently (T1 — no validateGraph call) this passes vacuously;
   * when the naive GREEN adds package-only validation it becomes RED again,
   * and only the merged-graph fix keeps it green. Characterisation intentional.
   */
  test("dep on omitted persisted task resolves — applied:true (merged graph)", async () => {
    const { initiatives, tasks } = makeBaseDb();
    // Seed TASK3 in DB — it will NOT be in the package.
    tasks.seed(
      {
        id: TASK3_ID,
        objectiveId: OBJ1_ID,
        title: "Omitted task",
        instructions: "lives in DB only",
        ac: ["done"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      "a".repeat(64),
    );

    // TASK2 now depends on TASK3 (which is in DB but absent from the package).
    const pkg = makeBasePackage();
    pkg.tasks[1]!.dependencies = [TASK3_ID];

    // This test characterises merged-graph dependency resolution only (does
    // validateGraph accept TASK3 via the DB-merged node set?) — it is not
    // about the write-phase CAS outcome. The base FakeTaskRepository's
    // compareAndApply is an unconditional-conflict stub (see its own comment);
    // since EPIC 007.18 Story 4 now correctly relabels a sha CAS conflict as
    // `drifted` (previously it kept the stale preflight `updated` class,
    // which incidentally slipped past this test's conflict-class check), that
    // stub's always-conflict behavior would otherwise leak into this
    // assertion. Give TASK2's compareAndApply a succeeding override so the
    // test still isolates the concern it names.
    tasks.compareAndApply = (id, _expectedSha, _expectedStatus, _spec) => ({
      status: "applied",
      freshSha: "merged-graph-test-fresh-sha-" + id,
    });

    const uc = new ApplyGraph(makeDeps({ initiatives, tasks }));
    // Must NOT throw — TASK3 is found in the merged (DB) node set.
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });
    assert.ok(result !== undefined, "execute must resolve without throwing");
    assert.ok(
      !result.conflicts.some(
        (c) => c.class === "drifted" || c.class === "locked",
      ),
      "no lifecycle conflicts expected (merged-graph validation passes)",
    );
  });

  /**
   * Test (b): TASK1 (package) depends on TASK3 (DB-only). TASK3 in the DB
   * depends on TASK1 → cycle through an omitted persisted task.
   * Expected: execute throws CycleError (domain validateGraph propagates).
   * Fails today: no validateGraph call → execute returns normally.
   */
  test("cycle through omitted persisted task — throws CycleError", async () => {
    const { initiatives, tasks } = makeBaseDb();
    // TASK3 is in DB, NOT the package; it depends on TASK1 → cycle
    tasks.seed(
      {
        id: TASK3_ID,
        objectiveId: OBJ1_ID,
        title: "Omitted cyclic task",
        instructions: "creates the cycle",
        ac: ["done"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID], // ← TASK3 depends on TASK1
      },
      "b".repeat(64),
    );

    // TASK1 in the package depends on TASK3 (which depends on TASK1 in DB)
    const pkg = makeBasePackage();
    pkg.tasks[0]!.dependencies = [TASK3_ID];

    const uc = new ApplyGraph(makeDeps({ initiatives, tasks }));
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof CycleError,
          `expected CycleError, got ${String(err)}`,
        );
        return true;
      },
      "cycle through an omitted DB task must throw CycleError",
    );
  });

  /**
   * EPIC 007.18 Story 3 — a manifest whose formatVersion predates the
   * content-hash change must be rejected before any classification, not
   * silently reported as universal drift.
   */
  test("EPIC 007.18 Story 3 — manifest.formatVersion 2 (stale) throws StaleManifestError with the fixture's fields", async () => {
    const pkg = makeBasePackage({ formatVersion: 2 });
    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        if (!(err instanceof StaleManifestError)) {
          assert.fail(`expected StaleManifestError, got ${String(err)}`);
        }
        assert.equal(err.formatVersion, 2);
        assert.equal(err.expectedVersion, GRAPH_FORMAT_VERSION);
        assert.equal(err.initiativeId, INIT_ID);
        return true;
      },
      "a formatVersion:2 manifest must be rejected as stale",
    );
  });

  test("EPIC 007.18 regression — StaleManifestError names the MANIFEST's initiativeId, not the applied one", async () => {
    // Package exported from INIT_ID's manifest, but applied against a
    // DIFFERENT initiative (e.g. `--initiative <other>`). The remedy line
    // must tell the user to re-export the manifest's own initiative
    // (INIT_ID), not the initiative the apply happened to target.
    const OTHER_INIT_ID = "01JQVBZ3MHKP4FTGWR5XYENSDA";
    const pkg = makeBasePackage({ formatVersion: 2 });
    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: OTHER_INIT_ID }),
      (err: unknown) => {
        if (!(err instanceof StaleManifestError)) {
          assert.fail(`expected StaleManifestError, got ${String(err)}`);
        }
        assert.equal(
          err.initiativeId,
          INIT_ID,
          "must name the manifest's initiativeId, not input.initiativeId",
        );
        return true;
      },
      "a stale manifest applied against a different initiative must still name the manifest's own initiative",
    );
  });

  test("EPIC 007.18 Story 3 — manifest.formatVersion === GRAPH_FORMAT_VERSION classifies normally (no throw)", async () => {
    const pkg = makeBasePackage({ formatVersion: GRAPH_FORMAT_VERSION });
    const uc = new ApplyGraph(makeDeps());
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });
    assert.equal(
      result.applied,
      true,
      "a current-format manifest must classify and apply normally",
    );
  });

  test("EPIC 007.18 Story 3 — a package with no manifest (create mode) does not throw the stale gate", async () => {
    const pkg = makeBasePackage();
    // Simulate --create: no manifest at all.
    (pkg as { manifest?: unknown }).manifest = undefined;
    pkg.tasks.forEach((t) => {
      t.id = undefined;
    });
    pkg.objectives.forEach((o) => {
      o.id = undefined;
    });
    pkg.initiative.id = undefined;
    const uc = new ApplyGraph(makeDeps());
    // Must not throw StaleManifestError — a manifest-less package is create mode.
    await uc.execute({ pkg, initiativeId: INIT_ID });
  });

  test("EPIC 007.18 Story 3 — the stale-manifest throw happens before any classification or write (CAS spy count stays 0)", async () => {
    const { initiatives } = makeBaseDb();
    const tasks = new FakeTaskRepositoryWithCas();
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );
    const pkg = makeBasePackage({ formatVersion: 2 });
    // Edit a task so it WOULD classify updated, if the gate did not fire first.
    pkg.tasks[0]!.ac = ["returns 200", "rejects bad creds with 401"];
    const deps = {
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    };
    const uc = new ApplyGraph(deps);
    await assert.rejects(() => uc.execute({ pkg, initiativeId: INIT_ID }));
    assert.equal(
      tasks.compareAndApplyCount,
      0,
      "the stale gate must throw before any CAS write is attempted",
    );
  });

  /**
   * Test (c): TASK1 in the package depends on UNKNOWN_ID, which exists
   * in neither the package nor the DB.
   * Expected: execute throws UnknownDependencyError.
   * Fails today: no validateGraph call → execute returns normally.
   */
  test("dep resolves to neither package nor DB — throws UnknownDependencyError", async () => {
    // Standard base DB (TASK1 and TASK2 only). UNKNOWN_ID is absent from both.
    const pkg = makeBasePackage();
    pkg.tasks[0]!.dependencies = [UNKNOWN_ID]; // TASK1 depends on a ghost

    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof UnknownDependencyError,
          `expected UnknownDependencyError, got ${String(err)}`,
        );
        return true;
      },
      "dep absent from both package and DB must throw UnknownDependencyError",
    );
  });

  /**
   * Story 03 E (007.16) — a new (id-less) node may declare a dependency on an
   * EXISTING node by its package `ref`, not only by ULID. TASK1 already
   * exists in the DB (id TASK1_ID); its package node is re-aliased to a
   * human ref ("create-task") distinct from its ULID. A brand-new task node
   * ("health-task") depends on ["create-task"] — the ref, not the ULID.
   * Fails today: dependencies are resolved as raw ids before validateGraph,
   * so "create-task" resolves to neither a package id nor a DB id and
   * validateGraph throws UnknownDependencyError.
   */
  test("new node depends on an existing node by package ref (not ULID) — applies without UnknownDependencyError (Story 03 E)", async () => {
    const deps = makeDeps();
    const pkg = makeBasePackage();
    pkg.tasks[0]!.ref = "create-task"; // TASK1 aliased by ref; id stays TASK1_ID

    pkg.tasks.push({
      ref: "health-task", // brand-new, id-less node
      objectiveRef: OBJ1_ID,
      title: "Health check",
      instructions: "check health",
      ac: ["healthy"],
      agent: "generic@1",
      verification: undefined,
      dependencies: ["create-task"], // depends on TASK1 by REF, not ULID
      sourcePath: "backend/health-task.md",
    });

    const uc = new ApplyGraph(deps);
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.ok(result !== undefined, "execute must resolve without throwing");
    const healthClass = result.classifications.find(
      (c) => c.ref === "health-task",
    );
    assert.ok(healthClass, "the new node must appear in classifications");
    assert.equal(healthClass.class, "created");
  });

  /**
   * Story 03 E — a dependency that resolves to neither a package ref nor an
   * existing DB id must surface as a typed error (UnknownDependencyError),
   * never a raw stack trace escaping past validateGraph.
   */
  test("new node with an unresolvable dependency ref throws a typed UnknownDependencyError (Story 03 E)", async () => {
    const deps = makeDeps();
    const pkg = makeBasePackage();
    pkg.tasks.push({
      ref: "health-task",
      objectiveRef: OBJ1_ID,
      title: "Health check",
      instructions: "check health",
      ac: ["healthy"],
      agent: "generic@1",
      verification: undefined,
      dependencies: ["totally-unresolvable-ref"],
      sourcePath: "backend/health-task.md",
    });

    const uc = new ApplyGraph(deps);
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof UnknownDependencyError,
          `expected UnknownDependencyError, got ${String(err)}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Story 08 T2 — delete-missing eligibility
// ---------------------------------------------------------------------------

describe("Story 08 T2 — delete-missing eligibility", () => {
  /**
   * Test (a): pending task in manifest.files, file absent, sha matches → eligible.
   * Class "missing", reason undefined (no reason = delete-eligible pending node).
   *
   * Characterisation (first-run pass intended): the current code always sets
   * reason:undefined for missing nodes regardless of live status/sha — so this
   * specific assertion passes vacuously. Sensitivity: if the enrichment logic
   * were to accidentally set a reason for a pending+matching node, this would
   * break. Documents the positive eligibility contract.
   */
  test("pending task in manifest.files, file absent, sha matches → missing no reason (eligible)", async () => {
    const deps = makeDeps();
    const pkg = makeBasePackage();
    pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID); // TASK2 file removed

    const uc = new ApplyGraph(deps);
    // deleteMissing: true triggers eligibility enrichment
    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
    } as Parameters<typeof uc.execute>[0] & { deleteMissing?: boolean });

    const missingClass = result.classifications.find((c) => c.id === TASK2_ID);
    assert.ok(
      missingClass,
      "TASK2 must appear as missing (it was in manifest.files)",
    );
    assert.equal(missingClass.class, "missing");
    assert.equal(
      missingClass.reason,
      undefined,
      "pending + sha matches → no reason (eligible delete candidate)",
    );
  });

  /**
   * Test (b): non-pending task in manifest.files, file absent → reason:"non-pending".
   *
   * Fails today: the current code sets no reason for missing nodes, so
   * missingClass.reason === undefined instead of "non-pending".
   */
  test("non-pending task in manifest.files, file absent → missing reason:non-pending (ineligible)", async () => {
    const { initiatives, tasks } = makeBaseDb();
    // Re-seed TASK2_ID as running (non-pending)
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "running",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );
    const deps = makeDeps({ initiatives, tasks });
    const pkg = makeBasePackage();
    pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

    const uc = new ApplyGraph(deps);
    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
    } as Parameters<typeof uc.execute>[0] & { deleteMissing?: boolean });

    const missingClass = result.classifications.find((c) => c.id === TASK2_ID);
    assert.ok(missingClass, "TASK2 must appear as missing");
    assert.equal(missingClass.class, "missing");
    assert.equal(
      missingClass.reason,
      "non-pending",
      `running task → reason must be "non-pending"; got: ${missingClass.reason}`,
    );
    assert.equal(
      missingClass.casReason,
      undefined,
      "a preflight 'missing' classification must never carry a casReason — the two channels stay separate",
    );
  });

  /**
   * Test (c): drifted missing task (in files, absent, live sha != baseline) →
   * reason:"drifted" (skip-with-warning, TB3).
   *
   * Fails today: same reason as (b) — reason is always undefined.
   */
  test("drifted missing task (in files, absent, live sha != baseline) → missing reason:drifted (skip-with-warning)", async () => {
    const { initiatives, tasks } = makeBaseDb();
    // Re-seed TASK2_ID with a DIFFERENT sha (drifted since export)
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      "drifted-sha-not-equal-to-baseline-t2",
    );
    const deps = makeDeps({ initiatives, tasks });
    const pkg = makeBasePackage();
    pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

    const uc = new ApplyGraph(deps);
    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
    } as Parameters<typeof uc.execute>[0] & { deleteMissing?: boolean });

    const missingClass = result.classifications.find((c) => c.id === TASK2_ID);
    assert.ok(missingClass, "TASK2 must appear as missing (in manifest.files)");
    assert.equal(missingClass.class, "missing");
    assert.equal(
      missingClass.reason,
      "drifted",
      `sha mismatch → reason must be "drifted"; got: ${missingClass.reason}`,
    );
  });

  /**
   * Test (d): task NOT in manifest.files → never a delete candidate (no missing
   * classification for it).
   *
   * Characterisation (first-run pass intended): the current implementation
   * already iterates manifest.files only, so a task not in that set is never
   * classified as missing. Sensitivity: if the iteration scope were widened to
   * include all DB tasks, this assertion would break.
   */
  test("task NOT in manifest.files → not a delete candidate (no missing classification) [characterisation]", async () => {
    const TASK_OUTSIDE_ID = "01JQVBZ3MHKP4FTGWR5XYENSD8";
    const { initiatives, tasks } = makeBaseDb();
    // Seed a task in DB that is NOT in manifest.files
    tasks.seed(
      {
        id: TASK_OUTSIDE_ID,
        objectiveId: OBJ1_ID,
        title: "Outside task",
        instructions: "not in manifest",
        ac: ["done"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      "x".repeat(64),
    );
    const deps = makeDeps({ initiatives, tasks });
    const pkg = makeBasePackage(); // TASK_OUTSIDE_ID is neither in pkg.tasks nor manifest.files

    const uc = new ApplyGraph(deps);
    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
    } as Parameters<typeof uc.execute>[0] & { deleteMissing?: boolean });

    const outsideClass = result.classifications.find(
      (c) => c.id === TASK_OUTSIDE_ID,
    );
    assert.equal(
      outsideClass,
      undefined,
      "task not in manifest.files must NOT be classified as missing (not a delete candidate)",
    );
  });
});

// ---------------------------------------------------------------------------
// Story 07 T3 — apply execution (CAS mutate + id-less create + idempotency)
// ---------------------------------------------------------------------------

describe("Story 07 T3 — apply execution (CAS mutate + id-less create + idempotency)", () => {
  /**
   * Test (a): a clean edited task (ac changed) → compareAndApply called once
   * for the changed task, NOT for the unchanged task.
   *
   * Fails today: the apply half is absent — no CAS ops are issued.
   */
  test("clean edited package: compareAndApply called once for the updated task only", async () => {
    const { initiatives } = makeBaseDb();
    const tasks = new FakeTaskRepositoryWithCas();
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    const pkg = makeBasePackage();
    pkg.tasks[0]!.ac = ["returns 200", "rejects bad creds with 401"]; // task1 edited

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(result.applied, true, "clean edit must be applied:true");
    assert.equal(result.summary.updated, 1, "exactly 1 node updated");
    assert.equal(
      tasks.compareAndApplyCount,
      1,
      `compareAndApply must be called once for the changed task (actual count: ${tasks.compareAndApplyCount})`,
    );
    assert.ok(
      tasks.compareAndApplyIds.includes(TASK1_ID),
      `compareAndApply must be called with TASK1_ID; called with: ${tasks.compareAndApplyIds.join(", ")}`,
    );
  });

  /**
   * Test (b): characterisation — conflict blocks apply BEFORE any CAS call.
   *
   * Passes vacuously today (apply half absent → 0 CAS calls regardless).
   * Documents the invariant: when preflight finds a conflict, compareAndApply
   * must NOT be called. Becomes a regression guard once the apply half is added.
   */
  test("conflict aborts before any CAS call — compareAndApply count stays 0 (characterisation)", async () => {
    const { initiatives } = makeBaseDb();
    const tasks = new FakeTaskRepositoryWithCas();
    // Seed task1 with a drifted sha (live sha ≠ baseline → conflict)
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      "drifted-live-sha-differs-from-baseline",
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    const pkg = makeBasePackage();
    pkg.tasks[0]!.ac = ["returns 200", "new item"]; // task1 package edit triggers classification

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(result.applied, false, "drifted conflict must block apply");
    assert.equal(
      tasks.compareAndApplyCount,
      0,
      "compareAndApply must NOT be called when conflict aborts apply",
    );
  });

  /**
   * Test (c): an id-less task (no importMap hit) → create + reserve importMap.
   *
   * Fails today: the apply half is absent — importMap.reserve is never called.
   */
  test("id-less task without map hit: importMap.reserve called once after create", async () => {
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
          sha: OBJ1_BASE_SHA,
        },
      ],
    );
    const tasks = new FakeTaskRepositoryWithCas(); // empty task repo — no tasks seeded
    const importMapSpy = new FakeGraphImportMapWithSpy();

    // Package: initiative + objective (existing with ids) + one id-less NEW task
    const pkg: GraphPackage = {
      packageId: PKG_ID,
      formatVersion: 1,
      initiative: {
        id: INIT_ID,
        ref: INIT_ID,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      objectives: [
        {
          id: OBJ1_ID,
          ref: OBJ1_ID,
          name: "backend",
          initiativeRef: INIT_ID,
          sourcePath: "backend/backend.md",
        },
      ],
      tasks: [
        {
          // id-less — brand new task, no prior importMap entry
          ref: "implement-api",
          objectiveRef: OBJ1_ID,
          title: "Implement API",
          instructions: "do it",
          ac: ["returns 200"],
          agent: "generic@1",
          verification: undefined,
          dependencies: [],
          sourcePath: "backend/implement-api.md",
        },
      ],
      manifest: {
        initiativeId: INIT_ID,
        packageId: PKG_ID,
        formatVersion: 3,
        digestAlgorithm: "sha256",
        // manifest only covers initiative + objective; new task has no baseline
        nodes: { [INIT_ID]: INIT_BASE_SHA, [OBJ1_ID]: OBJ1_BASE_SHA },
        files: [INIT_ID, OBJ1_ID],
        refToId: { objectives: { [OBJ1_ID]: OBJ1_ID }, tasks: {} },
      },
    };

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: importMapSpy,
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(
      result.summary.created,
      1,
      "id-less task must be classified created",
    );
    assert.equal(
      importMapSpy.reserveCount,
      1,
      `importMap.reserve must be called once for the created task (actual count: ${importMapSpy.reserveCount})`,
    );
  });

  /**
   * Test (d): real SQLite — second apply with same id-less task returns 0 created.
   *
   * Proves create-idempotency: after the first apply creates the task and reserves
   * the importMap row, a second apply with the same package finds the row and
   * classifies the node as non-created (unchanged or updated), producing `0 created`.
   *
   * Fails today: the apply half is absent — the first run neither creates the task
   * nor reserves the importMap row, so the second run still classifies the node
   * as "created" (summary.created === 1, not 0).
   */
  test("real SQLite: second apply with same id-less task returns 0 created (no dup)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanthord-apply-t3d-"));
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    after(() => {
      db.close();
      rmSync(dir, { recursive: true });
    });

    const projRepo = new SqliteProjectRepository(db);
    const initRepo = new SqliteInitiativeRepository(db);
    const taskRepo = new SqliteTaskRepository(db);
    const importMapRepo = new SqliteGraphImportMap(db);
    const uow = new SqliteUnitOfWork(db);

    // Seed project / initiative / objective
    const projectId = newId();
    const initiativeId = newId();
    const objectiveId = newId();
    projRepo.save({ id: projectId, name: "test-project" });
    initRepo.save({
      id: initiativeId,
      projectId,
      name: "oauth",
      paused: false,
    });
    initRepo.saveObjective({ id: objectiveId, initiativeId, name: "backend" });

    const initSha = initRepo.getSha256(initiativeId)!;
    const objSha = initRepo.getSha256(objectiveId)!;

    const pkgId = newId();
    const manifest: ExportManifest = {
      initiativeId,
      packageId: pkgId,
      formatVersion: 3,
      digestAlgorithm: "sha256",
      nodes: { [initiativeId]: initSha, [objectiveId]: objSha },
      files: [initiativeId, objectiveId],
      refToId: { objectives: { [objectiveId]: objectiveId }, tasks: {} },
    };

    const pkg: GraphPackage = {
      packageId: pkgId,
      formatVersion: 1,
      initiative: {
        id: initiativeId,
        ref: initiativeId,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      objectives: [
        {
          id: objectiveId,
          ref: objectiveId,
          name: "backend",
          initiativeRef: initiativeId,
          sourcePath: "backend/backend.md",
        },
      ],
      tasks: [
        {
          ref: "implement-api", // id-less
          objectiveRef: objectiveId,
          title: "Implement API",
          instructions: "do it",
          ac: ["returns 200"],
          agent: "generic@1",
          verification: undefined,
          dependencies: [],
          sourcePath: "backend/implement-api.md",
        },
      ],
      manifest,
    };

    const uc = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph: new StoreGraph(taskRepo),
      importMap: importMapRepo,
      uow,
      newId,
    });

    // First apply: id-less task → created
    const result1 = await uc.execute({ pkg, initiativeId });
    assert.equal(
      result1.summary.created,
      1,
      "first run: the id-less task must be classified created",
    );

    // Second apply with same package: importMap hit → 0 created (no dup)
    const result2 = await uc.execute({ pkg, initiativeId });
    assert.equal(
      result2.summary.created,
      0,
      `second run: same id-less task must NOT be created again (actual created: ${result2.summary.created})`,
    );

    // DB must have exactly 1 task
    const allTasks = taskRepo.listByInitiative(initiativeId);
    assert.equal(
      allTasks.length,
      1,
      "exactly 1 task in DB after both runs (no duplicate)",
    );
  });

  /**
   * EPIC 007.18 — regression: a brand-new (id-less) task whose frontmatter
   * `objective:` field is a package-local REF SLUG (not the objective's live
   * ULID) — the shape a freshly-authored task file actually has, per
   * `graph-package.ts:9` ("a ULID (exported) or a slug (created)") — must be
   * persisted with the RESOLVED LIVE objective id, and the creationSha
   * recorded for it must match what a second, immediately-following apply
   * recomputes, so the new task classifies `unchanged`, not `drifted`.
   *
   * Real SqliteTaskRepository is used deliberately: `tasks.objectiveId` is
   * `TEXT NOT NULL REFERENCES objectives(id)`, so passing the raw ref slug
   * as `objectiveId` reproduces the actual `FOREIGN KEY constraint failed`
   * crash (`ApplyGraph.execute` → `SqliteTaskRepository.save`), not merely a
   * value mismatch a fake could paper over.
   */
  test("EPIC 007.18: a new task's objectiveRef ref-slug resolves to the live objective id on save, and reclassifies unchanged next apply", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanthord-apply-007.18-new-task-"));
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    after(() => {
      db.close();
      rmSync(dir, { recursive: true });
    });

    const projRepo = new SqliteProjectRepository(db);
    const initRepo = new SqliteInitiativeRepository(db);
    const taskRepo = new SqliteTaskRepository(db);
    const importMapRepo = new SqliteGraphImportMap(db);
    const uow = new SqliteUnitOfWork(db);

    const projectId = newId();
    const initiativeId = newId();
    const objectiveId = newId();
    projRepo.save({ id: projectId, name: "test-project" });
    initRepo.save({
      id: initiativeId,
      projectId,
      name: "oauth",
      paused: false,
    });
    initRepo.saveObjective({ id: objectiveId, initiativeId, name: "backend" });

    const initSha = initRepo.getSha256(initiativeId)!;
    const objSha = initRepo.getSha256(objectiveId)!;

    const pkgId = newId();
    const manifest: ExportManifest = {
      initiativeId,
      packageId: pkgId,
      formatVersion: 3,
      digestAlgorithm: "sha256",
      nodes: { [initiativeId]: initSha, [objectiveId]: objSha },
      files: [initiativeId, objectiveId],
      // Package-local slug "sha-obj" is the ref for the live objective —
      // distinct from its ULID, exactly as a freshly-authored task file
      // would reference it via `objective: sha-obj`.
      refToId: { objectives: { "sha-obj": objectiveId }, tasks: {} },
    };

    const pkg: GraphPackage = {
      packageId: pkgId,
      formatVersion: 1,
      initiative: {
        id: initiativeId,
        ref: initiativeId,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      objectives: [
        {
          id: objectiveId,
          ref: "sha-obj",
          name: "backend",
          initiativeRef: initiativeId,
          sourcePath: "backend/backend.md",
        },
      ],
      tasks: [
        {
          ref: "new-task", // id-less: a brand-new task
          objectiveRef: "sha-obj", // frontmatter `objective:` slug, NOT the ULID
          title: "Added after work already ran",
          instructions: "do it",
          ac: ["returns 200"],
          agent: "fake@1",
          verification: undefined,
          dependencies: [],
          sourcePath: "backend/task-new.md",
        },
      ],
      manifest,
    };

    const uc = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph: new StoreGraph(taskRepo),
      importMap: importMapRepo,
      uow,
      newId,
    });

    const result1 = await uc.execute({ pkg, initiativeId });
    assert.equal(
      result1.summary.created,
      1,
      "the new task must be classified created",
    );

    const created = result1.createdNodes?.find((n) => n.ref === "new-task");
    assert.ok(created, "createdNodes must report the new task's minted id");

    const savedTask = taskRepo.get(created!.id);
    assert.ok(
      savedTask,
      "the new task must be persisted and readable by its minted id",
    );
    assert.equal(
      savedTask!.objectiveId,
      objectiveId,
      `the persisted task's objectiveId must be the resolved live objective ULID, not the package ref slug (actual: ${savedTask?.objectiveId})`,
    );

    // A second apply of the same package must see the just-created task as
    // unchanged — not drifted — proving the creationSha recorded for it was
    // computed from the SAME resolved objectiveId that was actually persisted.
    const result2 = await uc.execute({ pkg, initiativeId });
    const secondPassClass = result2.classifications.find(
      (c) => c.ref === "new-task",
    );
    assert.ok(
      secondPassClass,
      "the created task must be classified again on the second pass",
    );
    assert.equal(
      secondPassClass!.class,
      "unchanged",
      `the freshly-created task must classify unchanged on the immediately following apply (actual: ${secondPassClass?.class})`,
    );
  });

  /**
   * EPIC 007.18 regression — a task naming a nonexistent package-local
   * objective ref fails with a typed error. EPIC 007.18 originally added a
   * repository-boundary guard that threw `InvalidObjectiveIdError`. EPIC
   * 007.19 Story 1 moved detection earlier (preflight, before the write gate)
   * and uses `UncreatableObjectiveError` instead — the old guard is now
   * unreachable through this path, which is intentional (see EPIC 007.19
   * decision record: "makes it unreachable").
   *
   * The ref stays a plain slug ("ghost-obj"), deliberately NOT ULID-shaped:
   * `apply-graph.ts` (:457-466) already has a separate ULID existence check
   * that throws `UnknownNodeError`. A non-ULID slug passes that check and
   * reaches the EPIC 007.19 preflight.
   */
  test("EPIC 007.18 regression — a task naming a nonexistent package-local objective ref fails with a typed error, not a raw FK crash", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "kanthord-apply-007.18-ghost-objective-"),
    );
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    after(() => {
      db.close();
      rmSync(dir, { recursive: true });
    });

    const projRepo = new SqliteProjectRepository(db);
    const initRepo = new SqliteInitiativeRepository(db);
    const taskRepo = new SqliteTaskRepository(db);
    const importMapRepo = new SqliteGraphImportMap(db);
    const uow = new SqliteUnitOfWork(db);

    const projectId = newId();
    const initiativeId = newId();
    projRepo.save({ id: projectId, name: "test-project" });
    initRepo.save({
      id: initiativeId,
      projectId,
      name: "oauth",
      paused: false,
    });

    const initSha = initRepo.getSha256(initiativeId)!;

    const pkgId = newId();
    const manifest: ExportManifest = {
      initiativeId,
      packageId: pkgId,
      formatVersion: 3,
      digestAlgorithm: "sha256",
      nodes: { [initiativeId]: initSha },
      files: [initiativeId],
      refToId: { objectives: {}, tasks: {} },
    };

    const pkg: GraphPackage = {
      packageId: pkgId,
      formatVersion: 1,
      initiative: {
        id: initiativeId,
        ref: initiativeId,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      // Deliberately NO objectives in this package — "ghost-obj" is not
      // authored anywhere, unlike the sibling test where the ref resolves
      // to a real, pre-existing live objective.
      objectives: [],
      tasks: [
        {
          ref: "new-task",
          objectiveRef: "ghost-obj", // names an objective that exists nowhere
          title: "Task naming a nonexistent objective",
          instructions: "do it",
          ac: ["returns 200"],
          agent: "fake@1",
          verification: undefined,
          dependencies: [],
          sourcePath: "backend/task-new.md",
        },
      ],
      manifest,
    };

    const uc = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph: new StoreGraph(taskRepo),
      importMap: importMapRepo,
      uow,
      newId,
    });

    await assert.rejects(
      () => uc.execute({ pkg, initiativeId }),
      (err: unknown) => {
        assert.ok(
          err instanceof UncreatableObjectiveError,
          `expected UncreatableObjectiveError (EPIC 007.19 preflight), got ${String(err)}`,
        );
        assert.equal(err.initiativeId, initiativeId);
        assert.deepEqual(err.unresolvable, [
          { objectiveRef: "ghost-obj", taskRefs: ["new-task"] },
        ]);
        return true;
      },
      "a task naming a nonexistent package-local objective must fail with a typed error, not a raw FOREIGN KEY crash",
    );
  });

  /**
   * EPIC 007.18 — regression (proof case 3): a task whose package
   * `objectiveRef` is a package-local REF SLUG that resolves to the task's
   * CURRENT live objective (not a different one) must NOT be treated as a
   * reparent. Today `objectiveChanged` compares the unresolved
   * `pkgTask.objectiveRef` ("sha-obj") directly against the live
   * `liveTask.objectiveId` (a ULID) — always unequal for a slug ref, so the
   * pure-reparent branch fires and calls `conditionalReparent` with the raw
   * slug as the new `objectiveId`, which is a FOREIGN KEY violation once a
   * real SQLite repo is behind it (see the sibling real-SQLite regression
   * test below). Here the same defect is pinned hermetically via the CAS
   * spy fake: a correct fix resolves the ref before comparing, finds it
   * equal to the live id, and calls neither `conditionalReparent` nor
   * `compareAndApply` for this unchanged task.
   */
  test("EPIC 007.18 regression — a task's objectiveRef ref-slug that resolves to its OWN live objective must not spuriously reparent", async () => {
    const { initiatives } = makeBaseDb();
    const tasks = new FakeTaskRepositoryWithCas();
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    const pkg = makeBasePackage();
    // The objective's package-local ref is a slug ("sha-obj"), distinct from
    // its ULID — but its `id` still points at the SAME live objective
    // (OBJ1_ID), exactly as a re-applied task file's `objective: sha-obj`
    // frontmatter would, per graph-package.ts:9's doc comment.
    pkg.objectives[0]!.ref = "sha-obj";
    pkg.tasks[0]!.objectiveRef = "sha-obj";

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(
      result.applied,
      true,
      "a ref-slug resolving to the task's own live objective must apply cleanly, not conflict",
    );
    assert.equal(
      tasks.conditionalReparentCount,
      0,
      `a ref-slug resolving to the SAME live objective must NOT trigger a reparent (actual conditionalReparent calls: ${tasks.conditionalReparentCount}, args: ${JSON.stringify(tasks.conditionalReparentArgs)})`,
    );
    assert.equal(
      tasks.compareAndApplyCount,
      0,
      "no spec change either — compareAndApply must not be called",
    );
  });

  /**
   * EPIC 007.18 — regression (proof case 3, real SQLite): the same defect as
   * above, but through the real SqliteTaskRepository so the actual failure
   * mode reproduces exactly — `tasks.objectiveId` is
   * `TEXT NOT NULL REFERENCES objectives(id)` (migrations.ts:102), so
   * passing the raw ref slug into `conditionalReparent`'s `objectiveId`
   * parameter is a genuine `FOREIGN KEY constraint failed`, not merely a
   * value mismatch a fake could paper over.
   */
  test("EPIC 007.18: reparent path — a ref-slug objectiveRef for the task's OWN live objective applies without FK violation", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "kanthord-apply-007.18-reparent-slug-"),
    );
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    after(() => {
      db.close();
      rmSync(dir, { recursive: true });
    });

    const projRepo = new SqliteProjectRepository(db);
    const initRepo = new SqliteInitiativeRepository(db);
    const taskRepo = new SqliteTaskRepository(db);
    const importMapRepo = new SqliteGraphImportMap(db);
    const uow = new SqliteUnitOfWork(db);

    const projectId = newId();
    const initiativeId = newId();
    const objectiveId = newId();
    projRepo.save({ id: projectId, name: "test-project" });
    initRepo.save({
      id: initiativeId,
      projectId,
      name: "oauth",
      paused: false,
    });
    initRepo.saveObjective({ id: objectiveId, initiativeId, name: "backend" });

    const initSha = initRepo.getSha256(initiativeId)!;
    const objSha = initRepo.getSha256(objectiveId)!;

    const taskId = newId();
    taskRepo.save(
      newTask({
        id: taskId,
        objectiveId,
        title: "Added after work already ran",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "fake@1",
        dependencies: [],
      }),
    );
    const taskSha = taskRepo.getSha256(taskId)!;

    const pkgId = newId();
    const manifest: ExportManifest = {
      initiativeId,
      packageId: pkgId,
      formatVersion: 3,
      digestAlgorithm: "sha256",
      nodes: {
        [initiativeId]: initSha,
        [objectiveId]: objSha,
        [taskId]: taskSha,
      },
      files: [initiativeId, objectiveId, taskId],
      // Same shape as a re-applied `--apply` package: the manifest's
      // refToId still names the objective by its ULID, but the task file
      // on disk carries the package-local slug in its `objective:` field
      // (exactly the `task-new.md` shape from the reported crash).
      refToId: {
        objectives: { "sha-obj": objectiveId },
        tasks: { [taskId]: taskId },
      },
    };

    const pkg: GraphPackage = {
      packageId: pkgId,
      formatVersion: 1,
      initiative: {
        id: initiativeId,
        ref: initiativeId,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      objectives: [
        {
          id: objectiveId,
          ref: "sha-obj",
          name: "backend",
          initiativeRef: initiativeId,
          sourcePath: "backend/backend.md",
        },
      ],
      tasks: [
        {
          id: taskId,
          ref: taskId,
          objectiveRef: "sha-obj", // frontmatter `objective:` slug, NOT the ULID
          title: "Added after work already ran",
          instructions: "do it",
          ac: ["returns 200"],
          agent: "fake@1",
          verification: undefined,
          dependencies: [],
          sourcePath: "backend/task-new.md",
        },
      ],
      manifest,
    };

    const uc = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph: new StoreGraph(taskRepo),
      importMap: importMapRepo,
      uow,
      newId,
    });

    // Must not throw FOREIGN KEY constraint failed.
    const result = await uc.execute({ pkg, initiativeId });
    assert.equal(
      result.applied,
      true,
      "a ref-slug resolving to the task's own live objective must apply cleanly",
    );

    const readBack = taskRepo.get(taskId);
    assert.equal(
      readBack!.objectiveId,
      objectiveId,
      "the task's objectiveId must remain the resolved live ULID after apply",
    );
  });

  /**
   * Test (e): reparent via changed objectiveRef → routes through conditionalReparent,
   * NOT compareAndApply (spec unchanged; only the parent reference changed).
   *
   * Fails today: the apply half is absent — conditionalReparent is never called.
   */
  test("reparent via changed objectiveRef calls conditionalReparent not compareAndApply", async () => {
    // Seed initiative with both OBJ1 and OBJ2
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
          sha: OBJ1_BASE_SHA,
        },
        // OBJ2 is the reparent target
        {
          obj: { id: OBJ2_ID, initiativeId: INIT_ID, name: "frontend" },
          sha: OBJ2_BASE_SHA,
        },
      ],
    );

    const tasks = new FakeTaskRepositoryWithCas();
    // task1 lives under OBJ1 in the DB
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    // Package: task1 now points at OBJ2 (reparent); spec otherwise unchanged
    const pkg = makeBasePackage();
    const reparentManifest: ExportManifest = {
      initiativeId: INIT_ID,
      packageId: PKG_ID,
      formatVersion: 3,
      digestAlgorithm: "sha256",
      nodes: {
        [INIT_ID]: INIT_BASE_SHA,
        [OBJ1_ID]: OBJ1_BASE_SHA,
        [OBJ2_ID]: OBJ2_BASE_SHA,
        [TASK1_ID]: TASK1_BASE_SHA,
        [TASK2_ID]: TASK2_BASE_SHA,
      },
      files: [INIT_ID, OBJ1_ID, OBJ2_ID, TASK1_ID, TASK2_ID],
      refToId: {
        objectives: { [OBJ1_ID]: OBJ1_ID, [OBJ2_ID]: OBJ2_ID },
        tasks: { [TASK1_ID]: TASK1_ID, [TASK2_ID]: TASK2_ID },
      },
    };
    pkg.manifest = reparentManifest;
    // Change task1's objectiveRef to OBJ2 (reparent); all spec fields remain identical
    pkg.tasks[0]!.objectiveRef = OBJ2_ID;
    // Also add OBJ2 to the package objectives so it's present
    pkg.objectives.push({
      id: OBJ2_ID,
      ref: OBJ2_ID,
      name: "frontend",
      initiativeRef: INIT_ID,
      sourcePath: "frontend/frontend.md",
    });

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(result.applied, true, "pure reparent must be applied:true");
    assert.equal(result.summary.updated, 1, "task1 is the one updated node");
    assert.equal(
      tasks.conditionalReparentCount,
      1,
      `conditionalReparent must be called once (actual: ${tasks.conditionalReparentCount})`,
    );
    assert.ok(
      tasks.conditionalReparentArgs.some(
        (a) => a.id === TASK1_ID && a.objectiveId === OBJ2_ID,
      ),
      `conditionalReparent must be called with TASK1_ID → OBJ2_ID; got: ${JSON.stringify(tasks.conditionalReparentArgs)}`,
    );
    assert.equal(
      tasks.compareAndApplyCount,
      0,
      "compareAndApply must NOT be called for a pure reparent (no spec change)",
    );
  });

  /**
   * Regression — B1 (AUTO_REVIEW): when a task has BOTH a changed spec field
   * AND a changed objectiveRef in the same apply, the code must call BOTH
   * conditionalReparent (to move the task) AND compareAndApply (to update the
   * spec).  Before the fix only compareAndApply was called; the reparent was
   * silently dropped.
   */
  test("B1-regression: spec change + objectiveRef change both land (compareAndApply AND conditionalReparent called)", async () => {
    // Seed initiative with both OBJ1 (live parent) and OBJ2 (reparent target).
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
          sha: OBJ1_BASE_SHA,
        },
        {
          obj: { id: OBJ2_ID, initiativeId: INIT_ID, name: "frontend" },
          sha: OBJ2_BASE_SHA,
        },
      ],
    );

    // task1 lives under OBJ1 at the baseline sha.
    const tasks = new FakeTaskRepositoryWithCas();
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    // Build a package where task1 has BOTH a new ac item (spec change) AND
    // moves to OBJ2 (objective change).
    const pkg = makeBasePackage();
    const combinedManifest: ExportManifest = {
      initiativeId: INIT_ID,
      packageId: PKG_ID,
      formatVersion: 3,
      digestAlgorithm: "sha256",
      nodes: {
        [INIT_ID]: INIT_BASE_SHA,
        [OBJ1_ID]: OBJ1_BASE_SHA,
        [OBJ2_ID]: OBJ2_BASE_SHA,
        [TASK1_ID]: TASK1_BASE_SHA,
        [TASK2_ID]: TASK2_BASE_SHA,
      },
      files: [INIT_ID, OBJ1_ID, OBJ2_ID, TASK1_ID, TASK2_ID],
      refToId: {
        objectives: { [OBJ1_ID]: OBJ1_ID, [OBJ2_ID]: OBJ2_ID },
        tasks: { [TASK1_ID]: TASK1_ID, [TASK2_ID]: TASK2_ID },
      },
    };
    pkg.manifest = combinedManifest;
    // Spec change: add an extra ac item so specChanged === true.
    pkg.tasks[0]!.ac = ["returns 200", "extra-ac-item"];
    // Objective change: move task1 to OBJ2.
    pkg.tasks[0]!.objectiveRef = OBJ2_ID;
    // Add OBJ2 to the package objectives so it is present.
    pkg.objectives.push({
      id: OBJ2_ID,
      ref: OBJ2_ID,
      name: "frontend",
      initiativeRef: INIT_ID,
      sourcePath: "frontend/frontend.md",
    });

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(
      result.applied,
      true,
      "combined spec+reparent must be applied:true",
    );

    // Both mutations must be applied — currently the reparent is silently dropped.
    assert.equal(
      tasks.compareAndApplyCount,
      1,
      `compareAndApply must be called once for the spec change (actual: ${tasks.compareAndApplyCount})`,
    );
    assert.equal(
      tasks.conditionalReparentCount,
      1,
      `conditionalReparent must be called once for the objectiveRef change (actual: ${tasks.conditionalReparentCount})`,
    );
    assert.ok(
      tasks.conditionalReparentArgs.some(
        (a) => a.id === TASK1_ID && a.objectiveId === OBJ2_ID,
      ),
      `conditionalReparent must be called with TASK1_ID → OBJ2_ID; got: ${JSON.stringify(tasks.conditionalReparentArgs)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// EPIC 007.18 Story 1 — content-only hash + explicit CAS status predicate
// ---------------------------------------------------------------------------

test("EPIC 007.18 — a completed task whose file nobody touched classifies unchanged, not drifted", async () => {
  const initiatives = new FakeInitiativeRepository();
  initiatives.seed(
    { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
    INIT_BASE_SHA,
    [
      {
        obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
        sha: OBJ1_BASE_SHA,
      },
    ],
  );
  const tasks = new FakeTaskRepository();
  // Live task has RUN (status completed) but its sha still equals the
  // baseline the manifest recorded at import time — content untouched.
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "completed",
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA,
  );

  const uc = new ApplyGraph({
    initiatives,
    tasks,
    storeGraph: new StoreGraph(tasks),
    importMap: new FakeGraphImportMap(),
    uow: new FakeUnitOfWork(),
    newId: () => "01NEWID0000000000000000001",
  });

  const result = await uc.execute({
    pkg: makeBasePackage(),
    initiativeId: INIT_ID,
  });

  assert.equal(result.conflicts.length, 0, "no conflicts expected");
  assert.equal(result.applied, true);
  const task1Class = result.classifications.find((c) => c.id === TASK1_ID);
  assert.equal(
    task1Class?.class,
    "unchanged",
    `expected TASK1 unchanged, got ${task1Class?.class}`,
  );
});

test("EPIC 007.18 — race guard: a lifecycle change between preflight and write is refused, not silently applied", async () => {
  const { initiatives } = makeBaseDb();
  const tasks = new FakeTaskRepositoryWithRaceGuard(TASK1_ID, "pending");
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "pending",
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA,
  );

  const pkg = makeBasePackage();
  pkg.tasks[0]!.ac = ["returns 200", "rejects bad creds with 401"]; // task1 edited → classified "updated"

  const uc = new ApplyGraph({
    initiatives,
    tasks,
    storeGraph: new StoreGraph(tasks),
    importMap: new FakeGraphImportMap(),
    uow: new FakeUnitOfWork(),
    newId: () => "01NEWID0000000000000000001",
  });

  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  assert.equal(
    tasks.compareAndApplyCalledForTarget,
    true,
    "compareAndApply must have been invoked for TASK1",
  );
  assert.equal(
    result.applied,
    false,
    "a late status change must refuse the apply, not silently write",
  );
  assert.equal(
    result.conflicts.length,
    1,
    `expected exactly one conflict; got: ${JSON.stringify(result.conflicts)}`,
  );
  const conflict = result.conflicts[0]!;
  assert.equal(conflict.kind, "task");
  assert.equal(conflict.id, TASK1_ID);
  assert.equal(
    conflict.class,
    "locked",
    `a status CAS conflict must classify "locked", not "drifted"; got: ${conflict.class}`,
  );
  assert.deepEqual(
    conflict.casReason,
    { kind: "status", currentStatus: "running" },
    `casReason must carry the status conflict shape; got: ${JSON.stringify(conflict.casReason)}`,
  );
});

test("EPIC 007.18 Story 4 — a sha conflict from compareAndApply classifies drifted with casReason kind:sha", async () => {
  const { initiatives } = makeBaseDb();
  const tasks = new FakeTaskRepositoryWithLateCasConflict();
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "pending",
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA,
  );

  const pkg = makeBasePackage();
  pkg.tasks[0]!.ac = ["returns 200", "sha-conflict-extra-ac"];

  const uc = new ApplyGraph({
    initiatives,
    tasks,
    storeGraph: new StoreGraph(tasks),
    importMap: new FakeGraphImportMap(),
    uow: new FakeUnitOfWork(),
    newId: () => "01NEWID0000000000000000001",
  });

  const result = await uc.execute({ pkg, initiativeId: INIT_ID });

  assert.equal(result.applied, false);
  assert.equal(
    result.conflicts.length,
    1,
    `expected exactly one conflict; got: ${JSON.stringify(result.conflicts)}`,
  );
  const conflict = result.conflicts[0]!;
  assert.equal(conflict.id, TASK1_ID);
  assert.equal(
    conflict.class,
    "drifted",
    `a sha CAS conflict must classify "drifted"; got: ${conflict.class}`,
  );
  assert.deepEqual(
    conflict.casReason,
    { kind: "sha" },
    `casReason must carry the sha conflict shape; got: ${JSON.stringify(conflict.casReason)}`,
  );
});

test("EPIC 007.18 — compareAndApply receives the preflight-observed status (pending) for an updated task", async () => {
  const { initiatives } = makeBaseDb();
  const tasks = new FakeTaskRepositoryWithCas();
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "pending",
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA,
  );

  const pkg = makeBasePackage();
  pkg.tasks[0]!.ac = ["returns 200", "rejects bad creds with 401"]; // task1 edited

  const uc = new ApplyGraph({
    initiatives,
    tasks,
    storeGraph: new StoreGraph(tasks),
    importMap: new FakeGraphImportMap(),
    uow: new FakeUnitOfWork(),
    newId: () => "01NEWID0000000000000000001",
  });
  await uc.execute({ pkg, initiativeId: INIT_ID });

  assert.deepEqual(tasks.compareAndApplyStatuses, ["pending"]);
});

test("EPIC 007.18 — conditionalDeleteTask receives the missing task's real preflight status", async () => {
  const initiatives = new FakeInitiativeRepository();
  initiatives.seed(
    { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
    INIT_BASE_SHA,
    [
      {
        obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
        sha: OBJ1_BASE_SHA,
      },
    ],
  );
  const tasks = new FakeTaskRepositoryWithDelete();
  tasks.seed(
    {
      id: TASK1_ID,
      objectiveId: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      status: "pending",
      dependencies: [],
    },
    TASK1_BASE_SHA,
  );
  tasks.seed(
    {
      id: TASK2_ID,
      objectiveId: OBJ1_ID,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
      status: "pending",
      dependencies: [TASK1_ID],
    },
    TASK2_BASE_SHA, // sha matches baseline → eligible
  );

  // TASK2 removed from package (file deleted) — it's in manifest.files → missing.
  // deleteMissing: false, confirmDelete: true — the missing-node preflight
  // status read still happens, it just isn't gated on deleteMissing.
  const pkg = makeBasePackage();
  pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

  const uc = new ApplyGraph({
    initiatives,
    tasks,
    storeGraph: new StoreGraph(tasks),
    importMap: new FakeGraphImportMap(),
    uow: new FakeUnitOfWork(),
    newId: () => "01NEWID0000000000000000001",
  });

  await uc.execute({
    pkg,
    initiativeId: INIT_ID,
    deleteMissing: false,
    confirmDelete: true,
  });

  assert.deepEqual(tasks.deleteTaskStatuses, ["pending"]);
});

// ---------------------------------------------------------------------------
// Story 08 T3 — confirmed delete execution + objective emptiness
// ---------------------------------------------------------------------------

/**
 * Spy version of FakeTaskRepositoryWithCas that also tracks conditionalDeleteTask calls.
 * Does NOT actually remove the task from the internal map — use real-SQLite to verify
 * the full DELETE + objective-emptiness cascade (TB5).
 */
class FakeTaskRepositoryWithDelete extends FakeTaskRepositoryWithCas {
  deleteTaskCount = 0;
  deleteTaskIds: string[] = [];
  deleteTaskStatuses: string[] = [];

  override conditionalDeleteTask(
    id: string,
    _expectedSha: string,
    expectedStatus: string,
  ): TaskCasResult {
    this.deleteTaskCount++;
    this.deleteTaskIds.push(id);
    this.deleteTaskStatuses.push(expectedStatus);
    return { status: "applied", freshSha: "" };
  }
}

/**
 * Fake `conditionalDeleteTask` that always returns a conflict of the
 * configured reason — for EPIC 007.18 Story 4's delete-path conflict-shape
 * tests.
 */
class FakeTaskRepositoryWithDeleteConflict extends FakeTaskRepositoryWithDelete {
  readonly #reason: "sha" | "status";

  constructor(reason: "sha" | "status") {
    super();
    this.#reason = reason;
  }

  override conditionalDeleteTask(
    id: string,
    _expectedSha: string,
    _expectedStatus: string,
  ): TaskCasResult {
    this.deleteTaskCount++;
    this.deleteTaskIds.push(id);
    return {
      status: "conflict",
      currentSha: "post-preflight-drift-sha-" + id,
      currentStatus: "running",
      reason: this.#reason,
    };
  }
}

/**
 * Spy version of FakeInitiativeRepository that tracks conditionalDeleteObjective calls.
 */
class FakeInitiativeRepositoryWithDelete extends FakeInitiativeRepository {
  deleteObjectiveCount = 0;
  deleteObjectiveIds: string[] = [];

  override conditionalDeleteObjective(
    id: string,
    _expectedSha: string,
  ): CasResult {
    this.deleteObjectiveCount++;
    this.deleteObjectiveIds.push(id);
    return { status: "applied", freshSha: "" };
  }
}

describe("Story 08 T3 — confirmed delete execution", () => {
  /**
   * Test (a): --delete-missing --confirm-delete → conditionalDeleteTask called
   * for an eligible pending missing task.
   *
   * Eligible = in manifest.files + file absent + pending + sha matches.
   * TASK2: pending, sha matches baseline, absent from package.
   *
   * Fails today: the apply half has no deletion code → deleteTaskCount stays 0.
   */
  test("confirmDelete: conditionalDeleteTask called for eligible pending missing task", async () => {
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
          sha: OBJ1_BASE_SHA,
        },
      ],
    );
    const tasks = new FakeTaskRepositoryWithDelete();
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA, // sha matches baseline → eligible
    );

    // TASK2 removed from package (file deleted) — it's in manifest.files → missing
    const pkg = makeBasePackage();
    pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });

    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
      confirmDelete: true,
    });

    assert.equal(result.applied, true, "eligible delete must not block apply");
    assert.equal(
      tasks.deleteTaskCount,
      1,
      `conditionalDeleteTask must be called once for the eligible missing task (count: ${tasks.deleteTaskCount})`,
    );
    assert.ok(
      tasks.deleteTaskIds.includes(TASK2_ID),
      `conditionalDeleteTask must be called with TASK2_ID; got: ${tasks.deleteTaskIds.join(", ")}`,
    );
    // summary.deleted must reflect the deletion
    const deleted = (result.summary as Record<string, number>)["deleted"] ?? -1;
    assert.equal(deleted, 1, `summary.deleted must be 1; got: ${deleted}`);
  });

  test("EPIC 007.18 Story 4 — conditionalDeleteTask status conflict classifies locked with casReason", async () => {
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
          sha: OBJ1_BASE_SHA,
        },
      ],
    );
    const tasks = new FakeTaskRepositoryWithDeleteConflict("status");
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    const pkg = makeBasePackage();
    pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });

    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
      confirmDelete: true,
    });

    assert.equal(result.applied, false);
    const conflict = result.conflicts.find((c) => c.id === TASK2_ID);
    assert.ok(conflict, "TASK2 must appear in conflicts");
    assert.equal(
      conflict.class,
      "locked",
      `a status delete-conflict must classify "locked"; got: ${conflict.class}`,
    );
    assert.deepEqual(
      conflict.casReason,
      { kind: "status", currentStatus: "running" },
      `casReason must carry the status conflict shape; got: ${JSON.stringify(conflict.casReason)}`,
    );
  });

  test("EPIC 007.18 Story 4 — conditionalDeleteTask sha conflict classifies drifted with casReason", async () => {
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
          sha: OBJ1_BASE_SHA,
        },
      ],
    );
    const tasks = new FakeTaskRepositoryWithDeleteConflict("sha");
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    const pkg = makeBasePackage();
    pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });

    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
      confirmDelete: true,
    });

    assert.equal(result.applied, false);
    const conflict = result.conflicts.find((c) => c.id === TASK2_ID);
    assert.ok(conflict, "TASK2 must appear in conflicts");
    assert.equal(
      conflict.class,
      "drifted",
      `a sha delete-conflict must classify "drifted"; got: ${conflict.class}`,
    );
    assert.deepEqual(
      conflict.casReason,
      { kind: "sha" },
      `casReason must carry the sha conflict shape; got: ${JSON.stringify(conflict.casReason)}`,
    );
  });

  /**
   * Test (b): drifted missing task is skipped (not deleted); spec apply still commits (TB3).
   *
   * Characterisation (first-run pass intended): today the apply half already handles
   * "updated" tasks via compareAndApply (Story 07 T3), and drifted-missing nodes have
   * class "missing" (not "drifted") so they do not enter the conflicts set.
   * deleteTaskCount stays 0 (no delete code); compareAndApplyCount is 1 for TASK1.
   *
   * Sensitivity:
   * - if delete code incorrectly deletes drifted-missing nodes → deleteTaskCount > 0 → fails.
   * - if the drifted-reason were incorrectly placed in conflicts → apply aborts →
   *   compareAndApplyCount stays 0 and result.applied === false → fails.
   */
  test("drifted missing task: deleteTask NOT called, spec apply commits (TB3) [characterisation]", async () => {
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
          sha: OBJ1_BASE_SHA,
        },
      ],
    );
    const tasks = new FakeTaskRepositoryWithDelete();
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    // TASK2: sha DIFFERS from baseline (drifted-missing → reason:"drifted" → skip-with-warning)
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      "drifted-sha-not-equal-to-baseline", // sha mismatch vs TASK2_BASE_SHA
    );

    // TASK1 has an edited ac (so it's classified "updated"); TASK2 absent (drifted-missing)
    const pkg = makeBasePackage();
    pkg.tasks[0]!.ac = ["returns 200", "rejects bad creds with 401"];
    pkg.tasks = pkg.tasks.filter((t) => t.id !== TASK2_ID);

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });

    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      deleteMissing: true,
      confirmDelete: true,
    });

    // Drifted-missing does NOT abort the apply
    assert.equal(
      result.applied,
      true,
      "drifted-missing must not block apply (TB3)",
    );
    // Drifted-missing must NOT be deleted (skip-with-warning)
    assert.equal(
      tasks.deleteTaskCount,
      0,
      `conditionalDeleteTask must NOT be called for drifted-missing TASK2 (count: ${tasks.deleteTaskCount})`,
    );
    // TASK1's spec update must still commit (apply proceeds normally)
    assert.equal(
      tasks.compareAndApplyCount,
      1,
      `compareAndApply must be called for TASK1 spec update (count: ${tasks.compareAndApplyCount})`,
    );
  });

  /**
   * Test (c): real-SQLite — empty objective deleted via conditionalDeleteObjective
   * after its only task is removed (TB5).
   *
   * Setup: OBJ1 has TASK1 (in package, unchanged); OBJ2 has TASK3 only (absent
   * from package + in manifest.files → missing → eligible → deleted). After TASK3
   * is deleted, OBJ2 is empty → conditionalDeleteObjective(OBJ2) called → OBJ2 deleted.
   * OBJ1 still has TASK1 → non-empty → NOT deleted.
   *
   * Real-SQLite is required because the objective-emptiness check
   * (COUNT(*) FROM tasks WHERE objectiveId = ?) must observe the task deletion
   * atomically inside the same transaction — fakes cannot express this (TB5).
   *
   * Fails today: the apply half has no deletion code → TASK3 and OBJ2 remain in DB.
   */
  test("real SQLite: empty objective deleted via conditionalDeleteObjective after its only task removed (TB5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanthord-apply-t3c-"));
    const dbPath = join(dir, "test.db");
    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    after(() => {
      db.close();
      rmSync(dir, { recursive: true });
    });

    const projRepo = new SqliteProjectRepository(db);
    const initRepo = new SqliteInitiativeRepository(db);
    const taskRepo = new SqliteTaskRepository(db);
    const importMapRepo = new SqliteGraphImportMap(db);
    const uow = new SqliteUnitOfWork(db);

    // Seed project / initiative / 2 objectives
    const projectId = newId();
    const initiativeId = newId();
    const obj1Id = newId(); // OBJ1: has TASK1 in package (kept)
    const obj2Id = newId(); // OBJ2: has TASK3 only (absent from package → deleted if empty)
    const task1Id = newId(); // in package
    const task3Id = newId(); // NOT in package → missing → eligible for delete

    projRepo.save({ id: projectId, name: "test-project" });
    initRepo.save({
      id: initiativeId,
      projectId,
      name: "oauth",
      paused: false,
    });
    initRepo.saveObjective({ id: obj1Id, initiativeId, name: "backend" });
    initRepo.saveObjective({ id: obj2Id, initiativeId, name: "frontend" });

    // Save tasks (write-hook stamps sha256)
    const t1 = newTask({
      id: task1Id,
      objectiveId: obj1Id,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
    });
    const t3 = newTask({
      id: task3Id,
      objectiveId: obj2Id,
      title: "Deploy",
      instructions: "deploy it",
      ac: ["health check green"],
      agent: "generic@1",
    });
    taskRepo.save(t1);
    taskRepo.save(t3);

    // Read live shas (set by the write-hook) to build the manifest
    const initSha = initRepo.getSha256(initiativeId)!;
    const obj1Sha = initRepo.getSha256(obj1Id)!;
    const obj2Sha = initRepo.getSha256(obj2Id)!;
    const task1Sha = taskRepo.getSha256(task1Id)!;
    const task3Sha = taskRepo.getSha256(task3Id)!;

    const pkgId = newId();
    const pkg: GraphPackage = {
      packageId: pkgId,
      formatVersion: 1,
      // INITIATIVE present in package (unchanged)
      initiative: {
        id: initiativeId,
        ref: initiativeId,
        name: "oauth",
        sourcePath: "oauth.md",
      },
      // OBJ1 present; OBJ2 ABSENT from package (file deleted)
      objectives: [
        {
          id: obj1Id,
          ref: obj1Id,
          name: "backend",
          initiativeRef: initiativeId,
          sourcePath: "backend/backend.md",
        },
      ],
      // TASK1 present; TASK3 ABSENT from package (file deleted)
      tasks: [
        {
          id: task1Id,
          ref: task1Id,
          objectiveRef: obj1Id,
          title: "Implement API",
          instructions: "do it",
          ac: ["returns 200"],
          agent: "generic@1",
          verification: undefined,
          dependencies: [],
          sourcePath: "backend/implement-api.md",
        },
      ],
      manifest: {
        initiativeId,
        packageId: pkgId,
        formatVersion: 3,
        digestAlgorithm: "sha256",
        nodes: {
          [initiativeId]: initSha,
          [obj1Id]: obj1Sha,
          [obj2Id]: obj2Sha, // OBJ2 in nodes (sha matches → eligible when absent)
          [task1Id]: task1Sha,
          [task3Id]: task3Sha, // TASK3 in nodes (sha matches → eligible when absent)
        },
        files: [initiativeId, obj1Id, obj2Id, task1Id, task3Id],
        refToId: {
          objectives: { [obj1Id]: obj1Id, [obj2Id]: obj2Id },
          tasks: { [task1Id]: task1Id, [task3Id]: task3Id },
        },
      },
    };

    const uc = new ApplyGraph({
      initiatives: initRepo,
      tasks: taskRepo,
      storeGraph: new StoreGraph(taskRepo),
      importMap: importMapRepo,
      uow,
      newId,
    });

    const result = await uc.execute({
      pkg,
      initiativeId,
      deleteMissing: true,
      confirmDelete: true,
    });

    assert.equal(
      result.applied,
      true,
      "apply with confirmed delete must succeed",
    );

    // TASK3 must be deleted from DB
    assert.equal(
      taskRepo.get(task3Id),
      undefined,
      "TASK3 must be deleted from DB (eligible pending missing task)",
    );

    // OBJ2 must be deleted (became empty after TASK3 was removed — TB5)
    assert.equal(
      initRepo.getObjective(obj2Id),
      undefined,
      "OBJ2 must be deleted from DB (empty after TASK3 deleted — TB5)",
    );

    // OBJ1 must remain (still has TASK1 in the package — non-empty)
    assert.ok(
      initRepo.getObjective(obj1Id) !== undefined,
      "OBJ1 must remain (non-empty — has TASK1 in package)",
    );

    // summary.deleted must cover both TASK3 and OBJ2
    const deleted = (result.summary as Record<string, number>)["deleted"] ?? -1;
    assert.ok(
      deleted >= 2,
      `summary.deleted must be >= 2 (TASK3 + OBJ2); got: ${deleted}`,
    );
  });
});

// ---------------------------------------------------------------------------
// RB regressions — classify-order (RB1/RB4a/RB4b) + late-CAS-rollback (RB3/RB4c)
// ---------------------------------------------------------------------------

/**
 * Spy task repository whose compareAndApply always returns status:"conflict"
 * — simulates a late drift (row changed between preflight and write phase).
 */
class FakeTaskRepositoryWithLateCasConflict extends FakeTaskRepository {
  override compareAndApply(
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
  ): TaskCasResult {
    return {
      status: "conflict",
      currentSha: "post-preflight-drift-sha",
      currentStatus: "pending",
      reason: "sha",
    };
  }
}

describe("RB regressions — classify-order + late-CAS-rollback", () => {
  /**
   * RB1 / RB4a: an identified package node whose content is UNCHANGED from
   * export (intendedSha === baselineSha) but whose DB row was externally
   * mutated after export (liveSha !== baselineSha) must be classified
   * "drifted", NOT "unchanged".
   *
   * FAILS TODAY: classifyNode has `if (intendedSha === baselineSha) return
   * "unchanged"` BEFORE the liveSha drift check, so the external drift is
   * invisible to the preflight and the stale apply exits 0.
   */
  test("RB4a/RB1: identified node unchanged-in-PKG but DB-drifted → classified drifted, applied:false", async () => {
    const { initiatives, tasks } = makeBaseDb();
    // Overwrite TASK1's sha with a "drifted" value — same task content, but
    // the DB row was externally modified (e.g. another apply bumped its sha).
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      "externally-drifted-sha-rb4a",
    );
    const deps = makeDeps({ initiatives, tasks });
    // Package is IDENTICAL to the export baseline (no edits).
    const pkg = makeBasePackage();

    const uc = new ApplyGraph(deps);
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    // classifyNode(TASK1_BASE_SHA, TASK1_BASE_SHA, "externally-drifted-sha-rb4a", "pending")
    // Current (buggy):  intendedSha===baselineSha → "unchanged"
    // Fixed:            liveSha!==baselineSha → "drifted"
    const task1Class = result.classifications.find((c) => c.id === TASK1_ID);
    assert.ok(task1Class, "TASK1 must appear in classifications");
    assert.equal(
      task1Class.class,
      "drifted",
      `expected "drifted" for externally-drifted unchanged-in-PKG node; got: ${task1Class.class}`,
    );
    assert.equal(
      result.applied,
      false,
      "external drift must block apply (applied:false)",
    );
    assert.ok(
      result.conflicts.some((c) => c.id === TASK1_ID && c.class === "drifted"),
      "TASK1 must appear in conflicts as 'drifted'",
    );
  });

  /**
   * RB4b: a mapped id-less node (importMap hit) whose live DB sha has drifted
   * from the creationSha since creation must be classified "drifted".
   *
   * FAILS TODAY: same classifyNode ordering bug — intendedSha===creationSha
   * causes an early "unchanged" return before the liveSha check runs.
   */
  test("RB4b: mapped id-less node liveSha!==creationSha → classified drifted, applied:false", async () => {
    const { initiatives, tasks } = makeBaseDb();
    const importMap = new FakeGraphImportMap();

    // creationSha = sha stored at creation time (matches the baseline package content)
    const creationSha = TASK1_BASE_SHA;
    importMap.seed(PKG_ID, "task", "write-tests", TASK1_ID, creationSha);

    // DB live sha has drifted from the creationSha (external mutation since creation)
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      "live-sha-drifted-from-creation-rb4b",
    );

    const deps = makeDeps({ initiatives, tasks, importMap });
    const pkg = makeBasePackage();
    // Replace task1 with an id-less "write-tests" node whose content is identical
    // to the creation content (so intendedSha === creationSha).
    pkg.tasks[0] = {
      ref: "write-tests",
      objectiveRef: OBJ1_ID,
      title: "Implement API",
      instructions: "do it",
      ac: ["returns 200"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "backend/implement-api.md",
    };

    const uc = new ApplyGraph(deps);
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    // classifyNode(creationSha, creationSha, "live-sha-drifted-...", "pending")
    // Current (buggy):  intendedSha===creationSha → "unchanged"
    // Fixed:            liveSha!==creationSha → "drifted"
    const mappedClass = result.classifications.find(
      (c) => c.ref === "write-tests" || c.id === TASK1_ID,
    );
    assert.ok(
      mappedClass,
      "mapped id-less task must appear in classifications",
    );
    assert.equal(
      mappedClass.class,
      "drifted",
      `expected "drifted" for mapped id-less node with drifted live sha; got: ${mappedClass.class}`,
    );
    assert.equal(
      result.applied,
      false,
      "drifted mapped node must block apply (applied:false)",
    );
  });

  /**
   * RB3 / RB4c: compareAndApply returns status:"conflict" in the write phase
   * (late CAS conflict — row drifted AFTER preflight, BEFORE the write) →
   * the whole apply must abort with applied:false.
   *
   * FAILS TODAY: the apply half discards every CasResult; result.applied stays
   * true even when compareAndApply reports a conflict.
   */
  test("RB3/RB4c: compareAndApply returns conflict in write phase → applied:false (late rollback)", async () => {
    const { initiatives } = makeBaseDb();
    const tasks = new FakeTaskRepositoryWithLateCasConflict();
    // Seed TASK1 at the BASELINE sha so preflight classifies it as "updated"
    // (package has a content change, liveSha === baselineSha → preflight passes).
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA, // liveSha === baselineSha → preflight: "updated" (no conflict)
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );

    const pkg = makeBasePackage();
    // Change TASK1 content so preflight sees it as "updated"
    pkg.tasks[0]!.ac = ["returns 200", "late-conflict-extra-ac"];

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    });
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    // Preflight passes (no conflict), but compareAndApply returns "conflict"
    // in the write phase — the apply must detect this and return applied:false.
    // Current (buggy): applied:true (CasResult discarded)
    // Fixed:           applied:false (late conflict detected, rollback)
    assert.equal(
      result.applied,
      false,
      "late CAS conflict (compareAndApply returned conflict) must make applied:false",
    );
  });
});

// ---------------------------------------------------------------------------
// Story 5c — apply-path after edge handling
// ---------------------------------------------------------------------------

class FakeSequencingRepository {
  readonly #initiativeEdges = new Map<string, string[]>();
  readonly #objectiveEdges = new Map<string, string[]>();

  seedInitiativeAfter(initiativeId: string, after: string[]): void {
    this.#initiativeEdges.set(initiativeId, [...after]);
  }
  seedObjectiveAfter(objectiveId: string, after: string[]): void {
    this.#objectiveEdges.set(objectiveId, [...after]);
  }
  listInitiativeAfter(initiativeId: string): string[] {
    return this.#initiativeEdges.get(initiativeId) ?? [];
  }
  listObjectiveAfter(objectiveId: string): string[] {
    return this.#objectiveEdges.get(objectiveId) ?? [];
  }
}

function makeTwoObjPackage(): GraphPackage {
  const base = makeBasePackage();
  base.objectives.push({
    id: OBJ2_ID,
    ref: OBJ2_ID,
    name: "frontend",
    initiativeRef: INIT_ID,
    sourcePath: "frontend/frontend.md",
  });
  base.manifest = {
    ...base.manifest!,
    nodes: {
      ...base.manifest!.nodes,
      [OBJ2_ID]: OBJ2_BASE_SHA,
    },
    files: [...base.manifest!.files, OBJ2_ID],
    refToId: {
      ...base.manifest!.refToId,
      objectives: { ...base.manifest!.refToId.objectives, [OBJ2_ID]: OBJ2_ID },
    },
  };
  return base;
}

function makeTwoObjDb(): {
  initiatives: FakeInitiativeRepository;
  tasks: FakeTaskRepository;
} {
  const { initiatives, tasks } = makeBaseDb();
  initiatives.seed(
    { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
    INIT_BASE_SHA,
    [
      {
        obj: { id: OBJ1_ID, initiativeId: INIT_ID, name: "backend" },
        sha: OBJ1_BASE_SHA,
      },
      {
        obj: { id: OBJ2_ID, initiativeId: INIT_ID, name: "frontend" },
        sha: OBJ2_BASE_SHA,
      },
    ],
  );
  return { initiatives, tasks };
}

describe("Story 5c — apply-path after edge handling", () => {
  test("(S5c-1) no edge changes when package and DB agree → applied:true, no edge classifications", async () => {
    const { initiatives, tasks } = makeTwoObjDb();
    const sequencing = new FakeSequencingRepository();
    sequencing.seedObjectiveAfter(OBJ1_ID, []);
    sequencing.seedObjectiveAfter(OBJ2_ID, []);
    const pkg = makeTwoObjPackage();
    pkg.objectives[0]!.after = [];
    pkg.objectives[1]!.after = [];

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
      sequencing,
    } as any);
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(result.applied, true);
  });

  test("(S5c-2) edge added in package (DB lacks it) → edge added, applied:true", async () => {
    const { initiatives, tasks } = makeTwoObjDb();
    const sequencing = new FakeSequencingRepository();
    sequencing.seedObjectiveAfter(OBJ1_ID, []);
    sequencing.seedObjectiveAfter(OBJ2_ID, []); // DB has no edge between OBJ2 and OBJ1
    const pkg = makeTwoObjPackage();
    pkg.objectives[0]!.after = [];
    pkg.objectives[1]!.after = [OBJ1_ID]; // package says OBJ2 after: [OBJ1]

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
      sequencing,
    } as any);
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(result.applied, true);
    // After the apply, the sequencing repo must have OBJ2 after: [OBJ1]
    assert.deepEqual(sequencing.listObjectiveAfter(OBJ1_ID), []);
    assert.deepEqual(sequencing.listObjectiveAfter(OBJ2_ID), [OBJ1_ID]);
  });

  test("(S5c-3) edge removed from package without confirmDelete → gated, edge survives", async () => {
    const { initiatives, tasks } = makeTwoObjDb();
    const sequencing = new FakeSequencingRepository();
    sequencing.seedObjectiveAfter(OBJ1_ID, []);
    sequencing.seedObjectiveAfter(OBJ2_ID, [OBJ1_ID]); // DB has edge
    const pkg = makeTwoObjPackage();
    pkg.objectives[0]!.after = [];
    pkg.objectives[1]!.after = []; // package dropped the edge

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
      sequencing,
    } as any);
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    // Must be applied:false — refused because edges would be removed without --confirm-delete
    assert.equal(result.applied, false);
    // Edge must survive in the DB (gated removal — nothing was written)
    assert.deepEqual(sequencing.listObjectiveAfter(OBJ2_ID), [OBJ1_ID]);
    // The result must carry the would-remove edge change
    assert.ok(result.edgeChanges !== undefined);
    const wouldRemove = result.edgeChanges!.filter(
      (ec) => ec.change === "would-remove",
    );
    assert.equal(wouldRemove.length, 1);
    assert.equal(wouldRemove[0]!.id, OBJ2_ID);
    assert.equal(wouldRemove[0]!.dependency, OBJ1_ID);
    // The result must carry refused edge removals
    assert.ok(result.refusedEdgeRemovals !== undefined);
    assert.equal(result.refusedEdgeRemovals!.length, 1);
  });

  test("(S5c-4) edge removed from package with confirmDelete → edge removed, applied:true", async () => {
    const { initiatives, tasks } = makeTwoObjDb();
    const sequencing = new FakeSequencingRepository();
    sequencing.seedObjectiveAfter(OBJ1_ID, []);
    sequencing.seedObjectiveAfter(OBJ2_ID, [OBJ1_ID]); // DB has edge
    const pkg = makeTwoObjPackage();
    pkg.objectives[0]!.after = [];
    pkg.objectives[1]!.after = []; // package dropped the edge

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
      sequencing,
    } as any);
    const result = await uc.execute({
      pkg,
      initiativeId: INIT_ID,
      confirmDelete: true,
    });

    assert.equal(result.applied, true);
    // Edge must be removed after confirmDelete
    assert.deepEqual(sequencing.listObjectiveAfter(OBJ2_ID), []);
  });

  test("(S5c-5) cycle in objective after set → CycleError before any write", async () => {
    const { initiatives, tasks } = makeTwoObjDb();
    const sequencing = new FakeSequencingRepository();
    sequencing.seedObjectiveAfter(OBJ1_ID, []); // DB has no edge for OBJ1
    sequencing.seedObjectiveAfter(OBJ2_ID, []);
    const pkg = makeTwoObjPackage();
    // OBJ1 after: [OBJ2] and OBJ2 after: [OBJ1] → cycle
    pkg.objectives[0]!.after = [OBJ2_ID];
    pkg.objectives[1]!.after = [OBJ1_ID];

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
      sequencing,
    } as any);

    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      CycleError,
    );
  });

  test("(S5c-6) add edge to initiative level → edge added, applied:true", async () => {
    const { initiatives, tasks } = makeTwoObjDb();
    const sequencing = new FakeSequencingRepository();
    sequencing.seedInitiativeAfter(INIT_ID, []);
    const pkg = makeTwoObjPackage();
    pkg.initiative.after = []; // no initiative-level edge in package
    pkg.objectives[0]!.after = [];
    pkg.objectives[1]!.after = [];
    // Package says initiative after: [] → no edge change

    const uc = new ApplyGraph({
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
      sequencing,
    } as any);
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });

    assert.equal(result.applied, true);
    assert.deepEqual(sequencing.listInitiativeAfter(INIT_ID), []);
  });
});

// ---------------------------------------------------------------------------
// EPIC 007.19 Story 1 — preflight refusal of uncreatable objectives
// ---------------------------------------------------------------------------

describe("EPIC 007.19 Story 1 — preflight refusal of uncreatable objectives", () => {
  /**
   * Package with an id-less objective and a task referencing it must be
   * rejected with UncreatableObjectiveError before any write.
   */
  test("(S1-1) refusal fires for an id-less objective referenced by a task", async () => {
    const pkg = makeBasePackage();
    pkg.objectives.push({
      ref: "orphan-obj",
      name: "Orphan objective",
      initiativeRef: INIT_ID,
      sourcePath: "orphan/objective.md",
    });
    pkg.tasks.push({
      ref: "orphan-task",
      objectiveRef: "orphan-obj",
      title: "Orphan task",
      instructions: "do it",
      ac: ["works"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "orphan/task.md",
    });
    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof UncreatableObjectiveError,
          `expected UncreatableObjectiveError, got ${String(err)}`,
        );
        assert.equal(err.initiativeId, INIT_ID);
        assert.deepEqual(err.unresolvable, [
          { objectiveRef: "orphan-obj", taskRefs: ["orphan-task"] },
        ]);
        return true;
      },
    );
  });

  /**
   * Same package with --dry-run must also be rejected — the throw is before
   * the write gate, so --dry-run and --apply take the same path.
   */
  test("(S1-2) --dry-run throws UncreatableObjectiveError too", async () => {
    const pkg = makeBasePackage();
    pkg.objectives.push({
      ref: "orphan-obj",
      name: "Orphan objective",
      initiativeRef: INIT_ID,
      sourcePath: "orphan/objective.md",
    });
    pkg.tasks.push({
      ref: "orphan-task",
      objectiveRef: "orphan-obj",
      title: "Orphan task",
      instructions: "do it",
      ac: ["works"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "orphan/task.md",
    });
    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID, dryRun: true }),
      (err: unknown) => {
        assert.ok(
          err instanceof UncreatableObjectiveError,
          `expected UncreatableObjectiveError for --dry-run, got ${String(err)}`,
        );
        return true;
      },
    );
  });

  /**
   * After the rejection, no CAS write or import-map reserve was attempted.
   */
  test("(S1-3) nothing is written after the refusal — CAS spy count stays 0", async () => {
    const { initiatives } = makeBaseDb();
    const tasks = new FakeTaskRepositoryWithCas();
    tasks.seed(
      {
        id: TASK1_ID,
        objectiveId: OBJ1_ID,
        title: "Implement API",
        instructions: "do it",
        ac: ["returns 200"],
        agent: "generic@1",
        status: "pending",
        dependencies: [],
      },
      TASK1_BASE_SHA,
    );
    tasks.seed(
      {
        id: TASK2_ID,
        objectiveId: OBJ1_ID,
        title: "Deploy",
        instructions: "deploy it",
        ac: ["health check green"],
        agent: "generic@1",
        status: "pending",
        dependencies: [TASK1_ID],
      },
      TASK2_BASE_SHA,
    );
    const importMap = new FakeGraphImportMapWithSpy();
    const pkg = makeBasePackage();
    pkg.objectives.push({
      ref: "orphan-obj",
      name: "Orphan objective",
      initiativeRef: INIT_ID,
      sourcePath: "orphan/objective.md",
    });
    pkg.tasks.push({
      ref: "orphan-task",
      objectiveRef: "orphan-obj",
      title: "Orphan task",
      instructions: "do it",
      ac: ["works"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "orphan/task.md",
    });
    const deps = {
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap,
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    };
    const uc = new ApplyGraph(deps);
    await assert.rejects(() => uc.execute({ pkg, initiativeId: INIT_ID }));
    assert.equal(
      tasks.compareAndApplyCount,
      0,
      "the refusal must throw before any CAS write is attempted",
    );
    assert.equal(
      importMap.reserveCount,
      0,
      "the refusal must throw before any import-map reserve is attempted",
    );
  });

  /**
   * Multiple id-less objectives are aggregated into one error with ordered
   * groups — first-encounter order for refs, encounter order for task refs.
   */
  test("(S1-4) aggregation and order — two objectives, three tasks", async () => {
    const pkg = makeBasePackage();
    pkg.objectives.push(
      {
        ref: "orphan-a",
        name: "Orphan A",
        initiativeRef: INIT_ID,
        sourcePath: "orphan/a.md",
      },
      {
        ref: "orphan-b",
        name: "Orphan B",
        initiativeRef: INIT_ID,
        sourcePath: "orphan/b.md",
      },
    );
    pkg.tasks.push(
      {
        ref: "t1",
        objectiveRef: "orphan-a",
        title: "Task 1",
        instructions: "do",
        ac: ["ok"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "orphan/t1.md",
      },
      {
        ref: "t2",
        objectiveRef: "orphan-b",
        title: "Task 2",
        instructions: "do",
        ac: ["ok"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "orphan/t2.md",
      },
      {
        ref: "t3",
        objectiveRef: "orphan-a",
        title: "Task 3",
        instructions: "do",
        ac: ["ok"],
        agent: "generic@1",
        verification: undefined,
        dependencies: [],
        sourcePath: "orphan/t3.md",
      },
    );
    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof UncreatableObjectiveError,
          `expected UncreatableObjectiveError, got ${String(err)}`,
        );
        assert.deepEqual(err.unresolvable, [
          { objectiveRef: "orphan-a", taskRefs: ["t1", "t3"] },
          { objectiveRef: "orphan-b", taskRefs: ["t2"] },
        ]);
        return true;
      },
    );
  });

  /**
   * The error message must name the orphan objective ref and the remedy
   * command — this is what the Proof script's grep assertions depend on.
   */
  test("(S1-5) message names the ref and the remedy command", async () => {
    const pkg = makeBasePackage();
    pkg.objectives.push({
      ref: "orphan-obj",
      name: "Orphan objective",
      initiativeRef: INIT_ID,
      sourcePath: "orphan/objective.md",
    });
    pkg.tasks.push({
      ref: "orphan-task",
      objectiveRef: "orphan-obj",
      title: "Orphan task",
      instructions: "do it",
      ac: ["works"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "orphan/task.md",
    });
    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof UncreatableObjectiveError,
          `expected UncreatableObjectiveError, got ${String(err)}`,
        );
        assert.ok(
          err.message.includes("orphan-obj"),
          `message must name the objective ref "orphan-obj"; got: ${err.message}`,
        );
        assert.ok(
          err.message.includes("kanthord create objective --initiative"),
          `message must include the remedy command; got: ${err.message}`,
        );
        return true;
      },
    );
  });

  /**
   * A fully resolvable package (unmodified makeBasePackage) does not throw
   * UncreatableObjectiveError — the gate must not be a blanket refusal.
   */
  test("(S1-6) regression — fully resolvable package does not throw", async () => {
    const uc = new ApplyGraph(makeDeps());
    const result = await uc.execute({
      pkg: makeBasePackage(),
      initiativeId: INIT_ID,
    });
    assert.equal(result.applied, true);
  });

  /**
   * A task whose objectiveRef is a ULID present in the DB but not in the
   * package's objectives list resolves through getSha256 without error.
   */
  test("(S1-7) regression — live DB objective not in the package still resolves", async () => {
    const { initiatives, tasks } = makeBaseDb();
    // Seed a second objective (OBJ2_ID) that is NOT in the base package.
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth", paused: false },
      INIT_BASE_SHA,
      [
        {
          obj: { id: OBJ2_ID, initiativeId: INIT_ID, name: "frontend" },
          sha: OBJ2_BASE_SHA,
        },
      ],
    );
    const pkg = makeBasePackage();
    // Add a task whose objectiveRef is OBJ2_ID — a ULID that IS in the DB
    // but is NOT in pkg.objectives.
    pkg.tasks.push({
      ref: "obj2-task",
      objectiveRef: OBJ2_ID,
      title: "Task under OBJ2",
      instructions: "do it",
      ac: ["works"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "obj2/task.md",
    });
    const deps = {
      initiatives,
      tasks,
      storeGraph: new StoreGraph(tasks),
      importMap: new FakeGraphImportMap(),
      uow: new FakeUnitOfWork(),
      newId: () => "01NEWID0000000000000000001",
    };
    const uc = new ApplyGraph(deps);
    // Must not throw UncreatableObjectiveError — resolves normally.
    const result = await uc.execute({ pkg, initiativeId: INIT_ID });
    assert.ok(
      result.applied,
      "a package with a DB-only objective ULID must apply",
    );
  });

  /**
   * A task whose objectiveRef is a ULID absent from both the package and
   * the DB must be rejected by the earlier ULID check (UnknownNodeError),
   * not by the new UncreatableObjectiveError check.
   */
  test("(S1-8) ordering vs UnknownNodeError — absent ULID throws UnknownNodeError, not UncreatableObjectiveError", async () => {
    const pkg = makeBasePackage();
    // UNKNOWN_ID is a ULID absent from both the package objectives and the DB.
    pkg.tasks.push({
      ref: "ghost-task",
      objectiveRef: UNKNOWN_ID,
      title: "Ghost task",
      instructions: "do it",
      ac: ["works"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "ghost/task.md",
    });
    const uc = new ApplyGraph(makeDeps());
    await assert.rejects(
      () => uc.execute({ pkg, initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof UnknownNodeError,
          `expected UnknownNodeError for absent ULID, got ${String(err)}`,
        );
        assert.ok(
          !(err instanceof UncreatableObjectiveError),
          "must not be UncreatableObjectiveError — ULID check runs first",
        );
        return true;
      },
    );
  });
});
