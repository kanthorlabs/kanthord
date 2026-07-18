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
import { SqliteUnitOfWork } from "./sqlite-unit-of-work.ts";
import { newId } from "../../domain/entity.ts";
import type { Task } from "../../domain/task.ts";

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
