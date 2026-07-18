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
import { newId } from "../../domain/entity.ts";
import { newTask } from "../../domain/task.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-gimport-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

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

test("SqliteGraphImportMap reserve + lookup round-trips {nodeId, creationSha} for a task", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const taskRepo = new SqliteTaskRepository(db);
  const importMap = new SqliteGraphImportMap(db);

  const task = newTask({
    id: newId(),
    objectiveId,
    title: "do something",
    instructions: "details",
    ac: ["it works"],
  });
  taskRepo.save(task);

  const packageId = newId();
  const creationSha = "a".repeat(64);
  importMap.reserve(packageId, "task", "my-task", task.id, creationSha);

  const result = importMap.lookup(packageId, "task", "my-task");
  assert.deepEqual(result, { nodeId: task.id, creationSha });
});

test("SqliteGraphImportMap reserve + lookup round-trips {nodeId, creationSha} for an objective", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const importMap = new SqliteGraphImportMap(db);

  const packageId = newId();
  const creationSha = "b".repeat(64);
  importMap.reserve(packageId, "objective", "my-obj", objectiveId, creationSha);

  const result = importMap.lookup(packageId, "objective", "my-obj");
  assert.deepEqual(result, { nodeId: objectiveId, creationSha });
});

test("SqliteGraphImportMap lookup returns undefined for unknown (packageId, kind, ref)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const importMap = new SqliteGraphImportMap(db);
  const result = importMap.lookup("no-such-package", "task", "no-such-ref");
  assert.equal(result, undefined);
});

test("SqliteGraphImportMap second reserve with the same (packageId, kind, ref) throws (UNIQUE violation)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId, initiativeId } = seedHierarchy(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const importMap = new SqliteGraphImportMap(db);

  const packageId = newId();
  const obj2Id = newId();
  initRepo.saveObjective({ id: obj2Id, initiativeId, name: "Obj2" });

  importMap.reserve(
    packageId,
    "objective",
    "same-ref",
    objectiveId,
    "x".repeat(64),
  );
  assert.throws(
    () =>
      importMap.reserve(
        packageId,
        "objective",
        "same-ref",
        obj2Id,
        "y".repeat(64),
      ),
    /UNIQUE constraint failed|unique/i,
  );
});

test("SqliteGraphImportMap deleting the mapped task node cascades its graph_import_map row", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId } = seedHierarchy(db);
  const taskRepo = new SqliteTaskRepository(db);
  const importMap = new SqliteGraphImportMap(db);

  const task = newTask({
    id: newId(),
    objectiveId,
    title: "cascaded task",
    instructions: "cascade test",
    ac: ["row gone"],
  });
  taskRepo.save(task);

  const packageId = newId();
  importMap.reserve(packageId, "task", "cascade-ref", task.id, "c".repeat(64));

  // Confirm the row exists before deletion
  assert.ok(importMap.lookup(packageId, "task", "cascade-ref") !== undefined);

  // Delete the task — FK CASCADE should remove the import map row
  db.exec(`DELETE FROM tasks WHERE id = '${task.id}'`);

  const afterDelete = importMap.lookup(packageId, "task", "cascade-ref");
  assert.equal(afterDelete, undefined);
});

test("SqliteGraphImportMap same ref under a different packageId is independent", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { objectiveId, initiativeId } = seedHierarchy(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const importMap = new SqliteGraphImportMap(db);

  const obj2Id = newId();
  initRepo.saveObjective({ id: obj2Id, initiativeId, name: "Obj2" });

  const packageA = newId();
  const packageB = newId();

  importMap.reserve(
    packageA,
    "objective",
    "shared-ref",
    objectiveId,
    "sha-a".padEnd(64, "0"),
  );
  importMap.reserve(
    packageB,
    "objective",
    "shared-ref",
    obj2Id,
    "sha-b".padEnd(64, "0"),
  );

  const resultA = importMap.lookup(packageA, "objective", "shared-ref");
  const resultB = importMap.lookup(packageB, "objective", "shared-ref");

  assert.equal(resultA?.nodeId, objectiveId);
  assert.equal(resultB?.nodeId, obj2Id);
});
