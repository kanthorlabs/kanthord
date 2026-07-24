import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqliteProjectRepository } from "./sqlite-project-repository.ts";
import { SqliteInitiativeRepository } from "./sqlite-initiative-repository.ts";
import { SqliteTaskRepository } from "./sqlite-task-repository.ts";
import { SqliteGraphImportMap } from "./sqlite-graph-import-map.ts";
import { SqliteUnitOfWork } from "./sqlite-unit-of-work.ts";
import { sha256Hex, canonicalTask } from "./node-sha.ts";
import { newId } from "../../domain/entity.ts";
import type { Task } from "../../domain/task.ts";
import type { CasResult } from "../port.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-task-repo-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

/** Seed a minimal project + initiative + objective, return ids */
function seedHierarchy(db: ReturnType<typeof openDatabase>) {
  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();

  projectRepo.save({ id: projectId, name: "Proj" });
  initRepo.save({ id: initiativeId, projectId, name: "Init" });
  initRepo.saveObjective({ id: objectiveId, initiativeId, name: "Obj" });

  return { projectId, initiativeId, objectiveId };
}

test("SqliteTaskRepository save then get round-trips task with two dependencies in declared order", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  // dep1 and dep2 must exist before they can be referenced
  const dep1: Task = {
    id: newId(),
    objectiveId,
    title: "Dep One",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  const dep2: Task = {
    id: newId(),
    objectiveId,
    title: "Dep Two",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(dep1);
  repo.save(dep2);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Main Task",
    status: "pending",
    dependencies: [dep1.id, dep2.id],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(task);

  const loaded = repo.get(task.id);
  assert.deepEqual(loaded, task);
  // Verify declared order is preserved
  assert.equal(loaded!.dependencies[0], dep1.id);
  assert.equal(loaded!.dependencies[1], dep2.id);
});

test("SqliteTaskRepository get returns undefined for unknown id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteTaskRepository(db);
  assert.equal(repo.get("nonexistent-id"), undefined);
});

test("SqliteTaskRepository save with nonexistent dep throws FK error and leaves the task row persisted", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task with bad dep",
    status: "pending",
    dependencies: ["nonexistent-dep-id"],
  };

  // FK violation is not suppressed by INSERT OR IGNORE in SQLite
  assert.throws(() => repo.save(task), /constraint/i);
  // task row was upserted before the dep INSERT failed (save has no own transaction)
  const loaded = repo.get(task.id);
  assert.ok(loaded, "task row must exist after the partial save");
  // bad dep was not recorded
  assert.deepEqual(loaded!.dependencies, []);
});

test("SqliteTaskRepository saveAll succeeds when second task depends on first regardless of array order", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const taskA: Task = {
    id: newId(),
    objectiveId,
    title: "Task A",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  const taskB: Task = {
    id: newId(),
    objectiveId,
    title: "Task B (depends on A)",
    status: "pending",
    dependencies: [taskA.id],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };

  // Insert B before A in the array — saveAll must insert all task rows first
  repo.saveAll([taskB, taskA]);

  const loadedA = repo.get(taskA.id);
  const loadedB = repo.get(taskB.id);
  assert.deepEqual(loadedA, taskA);
  assert.deepEqual(loadedB, taskB);
});

test("SqliteTaskRepository saveAll with a duplicate id persists nothing", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const taskA: Task = {
    id: newId(),
    objectiveId,
    title: "Task A",
    status: "pending",
    dependencies: [],
  };
  const taskDupe: Task = {
    id: taskA.id,
    objectiveId,
    title: "Task A Duplicate",
    status: "pending",
    dependencies: [],
  };

  assert.throws(() => repo.saveAll([taskA, taskDupe]));
  // Whole batch rolled back
  assert.equal(repo.get(taskA.id), undefined);
});

test("SqliteTaskRepository listByInitiative returns tasks across two objectives in id order with dependencies rehydrated", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const repo = new SqliteTaskRepository(db);

  const projectId = newId();
  const initiativeId = newId();
  const obj1Id = "a-" + newId(); // prefix to control order if needed
  const obj2Id = "b-" + newId();

  projectRepo.save({ id: projectId, name: "P" });
  initRepo.save({ id: initiativeId, projectId, name: "I" });
  initRepo.saveObjective({ id: obj1Id, initiativeId, name: "Obj1" });
  initRepo.saveObjective({ id: obj2Id, initiativeId, name: "Obj2" });

  // Task in obj1, no deps
  const taskX: Task = {
    id: "x-" + newId(),
    objectiveId: obj1Id,
    title: "X",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  // Task in obj2, depends on taskX
  const taskY: Task = {
    id: "y-" + newId(),
    objectiveId: obj2Id,
    title: "Y",
    status: "pending",
    dependencies: [taskX.id],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };

  repo.save(taskX);
  repo.save(taskY);

  const tasks = repo.listByInitiative(initiativeId);
  assert.equal(tasks.length, 2);
  // ordered by task id ascending
  const ids = tasks.map((t) => t.id);
  assert.deepEqual(ids, [...ids].sort());
  // find each by id
  const loadedX = tasks.find((t) => t.id === taskX.id)!;
  const loadedY = tasks.find((t) => t.id === taskY.id)!;
  assert.deepEqual(loadedX, taskX);
  assert.deepEqual(loadedY, taskY);
});

test("SqliteTaskRepository listByInitiative excludes tasks from another initiative", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const repo = new SqliteTaskRepository(db);

  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P" });

  // Initiative A
  const initAId = newId();
  const objAId = newId();
  initRepo.save({ id: initAId, projectId, name: "Init A" });
  initRepo.saveObjective({ id: objAId, initiativeId: initAId, name: "ObjA" });

  // Initiative B
  const initBId = newId();
  const objBId = newId();
  initRepo.save({ id: initBId, projectId, name: "Init B" });
  initRepo.saveObjective({ id: objBId, initiativeId: initBId, name: "ObjB" });

  const taskA: Task = {
    id: newId(),
    objectiveId: objAId,
    title: "Task A",
    status: "pending",
    dependencies: [],
  };
  const taskB: Task = {
    id: newId(),
    objectiveId: objBId,
    title: "Task B",
    status: "pending",
    dependencies: [],
  };
  repo.save(taskA);
  repo.save(taskB);

  const tasksForA = repo.listByInitiative(initAId);
  assert.equal(tasksForA.length, 1);
  assert.equal(tasksForA[0]!.id, taskA.id);
});

test("SqliteTaskRepository listByInitiative returns [] for unknown initiativeId", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteTaskRepository(db);
  assert.deepEqual(repo.listByInitiative("nonexistent-initiative"), []);
});

test("migration 3 creates task_context table", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  type TableRow = { name: string };
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='task_context'",
    )
    .get() as TableRow | undefined;
  assert.ok(
    row !== undefined,
    "task_context table should exist after migration 3",
  );
  assert.equal(row.name, "task_context");
});

test("SqliteTaskRepository saveTaskContext + getTaskContext round-trips two context entries", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const dep1: Task = {
    id: newId(),
    objectiveId,
    title: "Dep A",
    status: "pending",
    dependencies: [],
  };
  const dep2: Task = {
    id: newId(),
    objectiveId,
    title: "Dep B",
    status: "pending",
    dependencies: [],
  };
  repo.save(dep1);
  repo.save(dep2);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task with context and deps",
    status: "pending",
    dependencies: [dep1.id, dep2.id],
  };
  repo.save(task);

  const context: Record<string, string> = {
    repository: newId(),
    credential: newId(),
  };
  repo.saveTaskContext(task.id, context);

  // getTask (existing get) still round-trips deps in declared order
  const loaded = repo.get(task.id);
  assert.ok(loaded !== undefined);
  assert.equal(loaded.dependencies[0], dep1.id);
  assert.equal(loaded.dependencies[1], dep2.id);

  // getTaskContext round-trips the context map
  const loadedCtx = repo.getTaskContext(task.id);
  assert.deepEqual(loadedCtx, context);
});

test("SqliteTaskRepository getTaskContext includes a workspace binding when the task's initiative has a provisioned clone (Story A/B routing)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { initiativeId, objectiveId } = seedHierarchy(db);
  const initRepo = new SqliteInitiativeRepository(db);
  initRepo.setWorkspace(initiativeId, "/tmp/kanthord-init-clone");

  const repo = new SqliteTaskRepository(db);
  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Initiative-clone task",
    status: "pending",
    dependencies: [],
  };
  repo.save(task);
  repo.saveTaskContext(task.id, { repository: newId() });

  const ctx = repo.getTaskContext(task.id);
  assert.equal(
    ctx.workspace,
    "/tmp/kanthord-init-clone",
    "getTaskContext must include a workspace binding sourced from the initiative's recorded clone dir",
  );
  assert.equal(
    ctx.repository !== undefined,
    true,
    "explicit context bindings must still be present alongside the derived workspace binding",
  );
});

test("SqliteTaskRepository getTaskContext returns empty object for task with no context", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "No context task",
    status: "pending",
    dependencies: [],
  };
  repo.save(task);

  const ctx = repo.getTaskContext(task.id);
  assert.deepEqual(ctx, {});
});

test("SqliteTaskRepository addDependency inserts edge and get shows it", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const dep: Task = {
    id: newId(),
    objectiveId,
    title: "Dep",
    status: "pending",
    dependencies: [],
  };
  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task with no initial deps",
    status: "pending",
    dependencies: [],
  };
  repo.save(dep);
  repo.save(task);

  repo.addDependency(task.id, dep.id);

  const loaded = repo.get(task.id);
  assert.ok(loaded !== undefined);
  assert.deepEqual(loaded.dependencies, [dep.id]);
});

test("SqliteTaskRepository removeDependency removes the edge", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const dep: Task = {
    id: newId(),
    objectiveId,
    title: "Dep",
    status: "pending",
    dependencies: [],
  };
  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task with one dep",
    status: "pending",
    dependencies: [dep.id],
  };
  repo.save(dep);
  repo.save(task);

  repo.removeDependency(task.id, dep.id);

  const loaded = repo.get(task.id);
  assert.ok(loaded !== undefined);
  assert.deepEqual(loaded.dependencies, []);
});

test("SqliteTaskRepository listTasksByObjective returns tasks for the objective with dependencies", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const dep: Task = {
    id: newId(),
    objectiveId,
    title: "Dep Task",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  const main: Task = {
    id: newId(),
    objectiveId,
    title: "Main Task",
    status: "pending",
    dependencies: [dep.id],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(dep);
  repo.save(main);

  const tasks = repo.listTasksByObjective(objectiveId);
  assert.equal(tasks.length, 2);
  const depLoaded = tasks.find((t) => t.id === dep.id);
  const mainLoaded = tasks.find((t) => t.id === main.id);
  assert.ok(depLoaded !== undefined, "dep task found");
  assert.deepEqual(depLoaded, dep);
  assert.ok(mainLoaded !== undefined, "main task found");
  assert.deepEqual(mainLoaded.dependencies, [dep.id]);
});

test("SqliteTaskRepository listTasksByObjective returns [] for unknown objectiveId", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteTaskRepository(db);
  assert.deepEqual(repo.listTasksByObjective("nonexistent-objective"), []);
});

test("SqliteTaskRepository removeDependency for a missing edge is a no-op", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task with no deps",
    status: "pending",
    dependencies: [],
  };
  const phantomId = newId();
  repo.save(task);

  // Should not throw
  assert.doesNotThrow(() => repo.removeDependency(task.id, phantomId));
  const loaded = repo.get(task.id);
  assert.ok(loaded !== undefined);
  assert.deepEqual(loaded.dependencies, []);
});

// ---------------------------------------------------------------------------
// S02-T4: getInitiativeId
// ---------------------------------------------------------------------------

test("SqliteTaskRepository getInitiativeId returns the owning initiative", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { initiativeId, objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task",
    status: "pending",
    dependencies: [],
  };
  repo.save(task);

  const result = repo.getInitiativeId(task.id);
  assert.equal(result, initiativeId);
});

test("SqliteTaskRepository getInitiativeId returns undefined for unknown task id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteTaskRepository(db);
  const result = repo.getInitiativeId("nonexistent-id");
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// S2 regression: saveTaskContext must join the caller's ambient UnitOfWork
// ---------------------------------------------------------------------------

test("SqliteTaskRepository saveTaskContext inside UnitOfWork.transaction does not start a nested transaction", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);
  const uow = new SqliteUnitOfWork(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "ctx task",
    status: "pending",
    dependencies: [],
  };
  repo.save(task);

  // saveTaskContext must NOT issue its own BEGIN; it must participate in the
  // ambient transaction already opened by UnitOfWork.transaction.
  // If saveTaskContext issues its own BEGIN it will throw at the SQLite level
  // because a transaction is already active.
  assert.doesNotThrow(() => {
    uow.transaction(() => {
      repo.saveTaskContext(task.id, { repository: "r1" });
    });
  }, "saveTaskContext must not throw when called inside an ambient UnitOfWork.transaction");
});

// ---------------------------------------------------------------------------
// S02-T2: migration 5 — agent/instructions/ac/verification round-trip,
//         discarded status, saveTaskResult / getTaskResult
// ---------------------------------------------------------------------------

/** Flat task-result row shape written/read by SaveTaskResult / getTaskResult */
interface TaskResultRow {
  workspace: string | null;
  branch: string | null;
  baseCommit: string | null;
  proposalCommit: string | null;
  commitSha: string | null;
  summary: string | null;
  reason: string | null;
  rejectionResolution: string | null;
  rejectionReason: string | null;
  evidence: Array<{ command: string; exitCode: number; output: string }> | null;
}

test("SqliteTaskRepository save/get round-trips agent with non-default value, instructions, ac, and verification", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Agent task",
    status: "pending",
    dependencies: [],
    agent: "custom@2",
    instructions: "do the thing",
    ac: ["criterion one", "criterion two"],
    verification: ["npm test", "npm run lint"],
  };
  repo.save(task);

  const loaded = repo.get(task.id);
  assert.deepEqual(loaded, task);
});

test("SqliteTaskRepository save/get without verification leaves verification absent", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "No-verify task",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "do something",
    ac: ["builds"],
  };
  repo.save(task);

  const loaded = repo.get(task.id);
  assert.deepEqual(loaded, task);
  assert.equal(
    Object.prototype.hasOwnProperty.call(loaded, "verification"),
    false,
  );
});

test("SqliteTaskRepository save/get with status discarded round-trips", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Discarded task",
    status: "discarded",
    dependencies: [],
    agent: "generic@1",
    instructions: "was discarded",
    ac: ["n/a"],
  };
  repo.save(task);

  const loaded = repo.get(task.id);
  assert.ok(loaded !== undefined, "discarded task must be retrievable");
  assert.equal(loaded.status, "discarded");
});

test("SqliteTaskRepository saveTaskResult and getTaskResult round-trip all eleven columns", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Result task",
    status: "completed",
    dependencies: [],
    agent: "generic@1",
    instructions: "do work",
    ac: ["builds"],
  };
  repo.save(task);

  const row: TaskResultRow = {
    workspace: "/tmp/ws/123",
    branch: "kanthord/task-123",
    baseCommit: "abc123",
    proposalCommit: null,
    commitSha: "def456",
    summary: "did the work",
    reason: null,
    rejectionResolution: null,
    rejectionReason: null,
    evidence: [{ command: "npm test", exitCode: 0, output: "ok" }],
  };

  const r = repo as unknown as {
    saveTaskResult(taskId: string, row: TaskResultRow): void;
    getTaskResult(taskId: string): TaskResultRow | undefined;
  };

  r.saveTaskResult(task.id, row);
  const loaded = r.getTaskResult(task.id);
  assert.deepEqual(loaded, row);
});

test("SqliteTaskRepository saveTaskResult upsert overwrites previous result", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Upsert task",
    status: "completed",
    dependencies: [],
    agent: "generic@1",
    instructions: "run it",
    ac: ["done"],
  };
  repo.save(task);

  const r = repo as unknown as {
    saveTaskResult(taskId: string, row: TaskResultRow): void;
    getTaskResult(taskId: string): TaskResultRow | undefined;
  };

  const first: TaskResultRow = {
    workspace: "/tmp/ws/first",
    branch: "kanthord/t",
    baseCommit: "aaa",
    proposalCommit: null,
    commitSha: "bbb",
    summary: "first run",
    reason: null,
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };
  r.saveTaskResult(task.id, first);

  const second: TaskResultRow = {
    workspace: "/tmp/ws/second",
    branch: "kanthord/t",
    baseCommit: "aaa",
    proposalCommit: "ccc",
    commitSha: null,
    summary: "second run",
    reason: "need human review",
    rejectionResolution: "retry",
    rejectionReason: "not quite",
    evidence: null,
  };
  r.saveTaskResult(task.id, second);

  const loaded = r.getTaskResult(task.id);
  assert.deepEqual(loaded, second);
});

test("SqliteTaskRepository getTaskResult returns undefined for unknown task", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteTaskRepository(db);
  const r = repo as unknown as {
    getTaskResult(taskId: string): TaskResultRow | undefined;
  };

  const result = r.getTaskResult("nonexistent-task-id");
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// S02-T3: write-hook stamps sha256 on every task mutation path
// ---------------------------------------------------------------------------

type ShaRow = { sha256: string };

function readSha(db: ReturnType<typeof openDatabase>, taskId: string): string {
  const row = db
    .prepare("SELECT sha256 FROM tasks WHERE id = ?")
    .get(taskId) as ShaRow | undefined;
  if (row === undefined) throw new Error(`task ${taskId} not found`);
  return row.sha256;
}

test("save stamps sha256 equal to sha256Hex(canonicalTask(...))", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Hook task",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "do it",
    ac: ["criterion one"],
  };
  repo.save(task);

  const expected = sha256Hex(
    canonicalTask({
      title: task.title,
      instructions: task.instructions ?? "",
      ac: task.ac ?? [],
      agent: task.agent ?? "generic@1",
      verification: task.verification,
      dependencies: task.dependencies,
      objectiveId: task.objectiveId,
      status: task.status,
    }),
  );
  assert.equal(readSha(db, task.id), expected);
});

test("saveAll stamps sha256 on each row", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const taskA: Task = {
    id: newId(),
    objectiveId,
    title: "Batch A",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "step A",
    ac: ["done A"],
  };
  const taskB: Task = {
    id: newId(),
    objectiveId,
    title: "Batch B",
    status: "pending",
    dependencies: [taskA.id],
    agent: "generic@1",
    instructions: "step B",
    ac: ["done B"],
  };

  repo.saveAll([taskA, taskB]);

  const expectedA = sha256Hex(
    canonicalTask({
      title: taskA.title,
      instructions: taskA.instructions ?? "",
      ac: taskA.ac ?? [],
      agent: taskA.agent ?? "generic@1",
      verification: taskA.verification,
      dependencies: taskA.dependencies,
      objectiveId: taskA.objectiveId,
      status: taskA.status,
    }),
  );
  const expectedB = sha256Hex(
    canonicalTask({
      title: taskB.title,
      instructions: taskB.instructions ?? "",
      ac: taskB.ac ?? [],
      agent: taskB.agent ?? "generic@1",
      verification: taskB.verification,
      dependencies: taskB.dependencies,
      objectiveId: taskB.objectiveId,
      status: taskB.status,
    }),
  );
  assert.equal(readSha(db, taskA.id), expectedA);
  assert.equal(readSha(db, taskB.id), expectedB);
});

test("addDependency bumps sha256 to a different value matching the recomputed aggregate", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const dep: Task = {
    id: newId(),
    objectiveId,
    title: "Dep",
    status: "pending",
    dependencies: [],
  };
  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "run",
    ac: ["ok"],
  };
  repo.save(dep);
  repo.save(task);

  const shaBeforeAdd = readSha(db, task.id);
  repo.addDependency(task.id, dep.id);
  const shaAfterAdd = readSha(db, task.id);

  // must be different from before
  assert.notEqual(shaAfterAdd, shaBeforeAdd);

  // must equal sha of aggregate with new dep
  const expectedAfterAdd = sha256Hex(
    canonicalTask({
      title: task.title,
      instructions: task.instructions ?? "",
      ac: task.ac ?? [],
      agent: task.agent ?? "generic@1",
      verification: task.verification,
      dependencies: [dep.id],
      objectiveId: task.objectiveId,
      status: task.status,
    }),
  );
  assert.equal(shaAfterAdd, expectedAfterAdd);
});

test("removeDependency bumps sha256 back after removing the dependency", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const dep: Task = {
    id: newId(),
    objectiveId,
    title: "Dep",
    status: "pending",
    dependencies: [],
  };
  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Task with dep",
    status: "pending",
    dependencies: [dep.id],
    agent: "generic@1",
    instructions: "run",
    ac: ["ok"],
  };
  repo.save(dep);
  repo.save(task);

  const shaWithDep = readSha(db, task.id);
  repo.removeDependency(task.id, dep.id);
  const shaWithoutDep = readSha(db, task.id);

  // must be different after removal
  assert.notEqual(shaWithoutDep, shaWithDep);

  // must equal sha of aggregate without dep
  const expectedWithoutDep = sha256Hex(
    canonicalTask({
      title: task.title,
      instructions: task.instructions ?? "",
      ac: task.ac ?? [],
      agent: task.agent ?? "generic@1",
      verification: task.verification,
      dependencies: [],
      objectiveId: task.objectiveId,
      status: task.status,
    }),
  );
  assert.equal(shaWithoutDep, expectedWithoutDep);
});

test("save after status transition produces a different sha256 than the pending token", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Status task",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "transition me",
    ac: ["lands"],
  };
  repo.save(task);
  const shaPending = readSha(db, task.id);

  const runningTask: Task = { ...task, status: "running" };
  repo.save(runningTask);
  const shaRunning = readSha(db, task.id);

  assert.notEqual(shaRunning, shaPending);

  const expectedRunning = sha256Hex(
    canonicalTask({
      title: runningTask.title,
      instructions: runningTask.instructions ?? "",
      ac: runningTask.ac ?? [],
      agent: runningTask.agent ?? "generic@1",
      verification: runningTask.verification,
      dependencies: runningTask.dependencies,
      objectiveId: runningTask.objectiveId,
      status: runningTask.status,
    }),
  );
  assert.equal(shaRunning, expectedRunning);
});

// ---------------------------------------------------------------------------
// Story 06 T1 — task CAS ops (compareAndApply / conditionalReparent / conditionalDeleteTask)
// ---------------------------------------------------------------------------

test("compareAndApply with matching sha applies new spec+deps and returns applied with fresh sha", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Original title",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "original instructions",
    ac: ["original ac"],
  };
  repo.save(task);
  const originalSha = readSha(db, task.id);

  const result: CasResult = repo.compareAndApply(task.id, originalSha, {
    title: "Updated title",
    instructions: "updated instructions",
    ac: ["updated ac"],
    agent: "generic@1",
    verification: null,
    dependencies: [],
  });

  assert.equal(result.status, "applied");
  assert.ok("freshSha" in result);
  assert.notEqual(
    (result as { status: "applied"; freshSha: string }).freshSha,
    originalSha,
  );

  const updated = repo.get(task.id);
  assert.equal(updated?.title, "Updated title");
  assert.equal(updated?.instructions, "updated instructions");
  assert.deepEqual(updated?.ac, ["updated ac"]);
});

test("compareAndApply with stale sha returns conflict+currentSha and row is unchanged", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Unchanged title",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "unchanged",
    ac: ["ac item"],
  };
  repo.save(task);
  const realSha = readSha(db, task.id);

  const result: CasResult = repo.compareAndApply(
    task.id,
    "staleSha00000000000000000000000000000000000000000000000000000000",
    {
      title: "Should not apply",
      instructions: "should not apply",
      ac: [],
      agent: "generic@1",
      verification: null,
      dependencies: [],
    },
  );

  assert.equal(result.status, "conflict");
  assert.ok("currentSha" in result);
  assert.equal(
    (result as { status: "conflict"; currentSha: string }).currentSha,
    realSha,
  );

  const unchanged = repo.get(task.id);
  assert.equal(unchanged?.title, "Unchanged title");
});

test("compareAndApply replacing deps makes fresh sha equal recomputed aggregate (SET semantics)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const dep1: Task = {
    id: newId(),
    objectiveId,
    title: "D1",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  const dep2: Task = {
    id: newId(),
    objectiveId,
    title: "D2",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(dep1);
  repo.save(dep2);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Dep task",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "with deps",
    ac: ["ac"],
  };
  repo.save(task);
  const sha0 = readSha(db, task.id);

  // Apply with deps in REVERSED order — CAS result sha must equal SET-sorted recompute
  const result: CasResult = repo.compareAndApply(task.id, sha0, {
    title: "Dep task",
    instructions: "with deps",
    ac: ["ac"],
    agent: "generic@1",
    verification: null,
    dependencies: [dep2.id, dep1.id], // intentionally reversed
  });

  assert.equal(result.status, "applied");
  const freshSha = (result as { status: "applied"; freshSha: string }).freshSha;

  const sortedDeps = [dep2.id, dep1.id].sort();
  const expected = sha256Hex(
    canonicalTask({
      title: "Dep task",
      instructions: "with deps",
      ac: ["ac"],
      agent: "generic@1",
      verification: undefined,
      dependencies: sortedDeps,
      objectiveId,
      status: "pending",
    }),
  );
  assert.equal(freshSha, expected);
});

test("conditionalReparent moves objectiveId on a match", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { initiativeId, objectiveId } = seedHierarchy(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const obj2Id = newId();
  initRepo.saveObjective({ id: obj2Id, initiativeId, name: "ObjB" });

  const repo = new SqliteTaskRepository(db);
  const task: Task = {
    id: newId(),
    objectiveId,
    title: "T",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(task);
  const sha = readSha(db, task.id);

  const result: CasResult = repo.conditionalReparent(task.id, sha, obj2Id);

  assert.equal(result.status, "applied");
  const moved = repo.get(task.id);
  assert.equal(moved?.objectiveId, obj2Id);
});

test("conditionalReparent conflicts on a stale sha and leaves objectiveId unchanged", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { initiativeId, objectiveId } = seedHierarchy(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const obj2Id = newId();
  initRepo.saveObjective({ id: obj2Id, initiativeId, name: "ObjB" });

  const repo = new SqliteTaskRepository(db);
  const task: Task = {
    id: newId(),
    objectiveId,
    title: "T2",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(task);
  const realSha = readSha(db, task.id);

  const result: CasResult = repo.conditionalReparent(
    task.id,
    "stalesha0000000000000000000000000000000000000000000000000000000",
    obj2Id,
  );

  assert.equal(result.status, "conflict");
  assert.equal(
    (result as { status: "conflict"; currentSha: string }).currentSha,
    realSha,
  );
  const unchanged = repo.get(task.id);
  assert.equal(unchanged?.objectiveId, objectiveId);
});

test("conditionalDeleteTask deletes on match and graph_import_map cascades", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);
  const importMap = new SqliteGraphImportMap(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Delete me",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(task);
  const sha = readSha(db, task.id);

  // seed an import-map row for this task
  importMap.reserve("pkg1", "task", "my-ref", task.id, sha);

  const result: CasResult = repo.conditionalDeleteTask(task.id, sha);

  assert.equal(result.status, "applied");
  assert.equal(repo.get(task.id), undefined);

  // cascade: the graph_import_map row should be gone
  const mapRow = importMap.lookup("pkg1", "task", "my-ref");
  assert.equal(mapRow, undefined);
});

test("conditionalDeleteTask conflicts on stale sha and row is kept", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const repo = new SqliteTaskRepository(db);

  const task: Task = {
    id: newId(),
    objectiveId,
    title: "Keep me",
    status: "pending",
    dependencies: [],
    agent: "generic@1",
    instructions: "",
    ac: [],
  };
  repo.save(task);
  const realSha = readSha(db, task.id);

  const result: CasResult = repo.conditionalDeleteTask(
    task.id,
    "stale_sha_000000000000000000000000000000000000000000000000000000000",
  );

  assert.equal(result.status, "conflict");
  assert.equal(
    (result as { status: "conflict"; currentSha: string }).currentSha,
    realSha,
  );
  assert.notEqual(repo.get(task.id), undefined);
});
