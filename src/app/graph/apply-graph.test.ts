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
} from "../../storage/port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import { newTask, type Task } from "../../domain/task.ts";
import { StoreGraph } from "./store-graph.ts";
import { CycleError, UnknownDependencyError } from "../../domain/graph.ts";
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

// Pre-computed sha256Hex(canonicalTask/Objective/Initiative) values.
// Computed via the same canonicalizer used by SqliteTaskRepository so the
// test wires exact real-world values, not arbitrary sentinels.
const TASK1_BASE_SHA =
  "f5243bca8b5c1723ca06d27e0faba375e327f101fffbd9a1a82eba8bc596f1c4";
const TASK2_BASE_SHA =
  "02936a45c644b0df6ef5898e9f62aa6eeb0dff9e8f6e3cc096504339325c3bcf";
const INIT_BASE_SHA =
  "941ad3bbcb3cce09e70653a64140afa6abb968a5e8eaa50720ef77d476d2b81f";
const OBJ1_BASE_SHA =
  "17f2caf8ad732ac8ad6942fe36ff32f41a2adaaff519536cd1135335a992825d";
// sha256Hex(JSON.stringify({ name: "frontend", initiativeId: INIT_ID }))
const OBJ2_BASE_SHA =
  "001e8e27a4d916464fd6a502d882f3014b881c5c7ff308c1c9bdac803432962f";

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
    _id: string,
    _expectedSha: string,
    _name: string,
  ): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalRenameObjective(
    _id: string,
    _expectedSha: string,
    _name: string,
  ): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalDeleteObjective(_id: string, _expectedSha: string): CasResult {
    return { status: "conflict", currentSha: "" };
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
  conditionalReparent(
    _id: string,
    _expectedSha: string,
    _objectiveId: string,
  ): CasResult {
    return { status: "conflict", currentSha: "" };
  }
  conditionalDeleteTask(_id: string, _expectedSha: string): CasResult {
    return { status: "conflict", currentSha: "" };
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
  conditionalReparentCount = 0;
  conditionalReparentArgs: Array<{ id: string; objectiveId: string }> = [];

  override compareAndApply(
    id: string,
    _expectedSha: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): CasResult {
    this.compareAndApplyCount++;
    this.compareAndApplyIds.push(id);
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

  override conditionalDeleteTask(_id: string, _expectedSha: string): CasResult {
    return { status: "applied", freshSha: "" };
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
    formatVersion: 1,
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
    { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
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
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
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
        formatVersion: 1,
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
    initRepo.save({ id: initiativeId, projectId, name: "oauth" });
    initRepo.saveObjective({ id: objectiveId, initiativeId, name: "backend" });

    const initSha = initRepo.getSha256(initiativeId)!;
    const objSha = initRepo.getSha256(objectiveId)!;

    const pkgId = newId();
    const manifest: ExportManifest = {
      initiativeId,
      packageId: pkgId,
      formatVersion: 1,
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
   * Test (e): reparent via changed objectiveRef → routes through conditionalReparent,
   * NOT compareAndApply (spec unchanged; only the parent reference changed).
   *
   * Fails today: the apply half is absent — conditionalReparent is never called.
   */
  test("reparent via changed objectiveRef calls conditionalReparent not compareAndApply", async () => {
    // Seed initiative with both OBJ1 and OBJ2
    const initiatives = new FakeInitiativeRepository();
    initiatives.seed(
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
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
      formatVersion: 1,
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
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
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
      formatVersion: 1,
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

  override conditionalDeleteTask(id: string, _expectedSha: string): CasResult {
    this.deleteTaskCount++;
    this.deleteTaskIds.push(id);
    return { status: "applied", freshSha: "" };
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
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
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
      { id: INIT_ID, projectId: PROJ_ID, name: "oauth" },
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
    initRepo.save({ id: initiativeId, projectId, name: "oauth" });
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
        formatVersion: 1,
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
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): CasResult {
    return { status: "conflict", currentSha: "post-preflight-drift-sha" };
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
