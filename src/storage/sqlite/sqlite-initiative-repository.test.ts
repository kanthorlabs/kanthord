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
import { newId } from "../../domain/entity.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-init-repo-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

test("SqliteInitiativeRepository save then get round-trips the initiative", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "Test Project" });

  const repo = new SqliteInitiativeRepository(db);
  const initiative: Initiative = {
    id: newId(),
    projectId,
    name: "My Initiative",
  };
  repo.save(initiative);
  const loaded = repo.get(initiative.id);
  assert.deepEqual(loaded, initiative);
});

test("SqliteInitiativeRepository get returns undefined for unknown id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteInitiativeRepository(db);
  assert.equal(repo.get("nonexistent-id"), undefined);
});

test("SqliteInitiativeRepository duplicate save throws", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P1" });

  const repo = new SqliteInitiativeRepository(db);
  const initiative: Initiative = { id: newId(), projectId, name: "Dupe" };
  repo.save(initiative);
  assert.throws(() => repo.save(initiative));
});

test("SqliteInitiativeRepository saveObjective + listObjectives round-trips in id order", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P2" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "I1" });

  // Insert second objective before first alphabetically by id to prove ordering
  const objB: Objective = {
    id: "b-" + newId(),
    initiativeId,
    name: "Objective B",
  };
  const objA: Objective = {
    id: "a-" + newId(),
    initiativeId,
    name: "Objective A",
  };
  repo.saveObjective(objB);
  repo.saveObjective(objA);

  const objectives = repo.listObjectives(initiativeId);
  assert.equal(objectives.length, 2);
  // returned in id order (ascending lexicographic)
  assert.equal(objectives[0]!.id, objA.id);
  assert.equal(objectives[1]!.id, objB.id);
  assert.deepEqual(objectives[0], objA);
  assert.deepEqual(objectives[1], objB);
});

test("SqliteInitiativeRepository listObjectives returns [] for unknown initiativeId", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteInitiativeRepository(db);
  assert.deepEqual(repo.listObjectives("nonexistent-initiative"), []);
});

test("SqliteInitiativeRepository save with unknown projectId throws (FK)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteInitiativeRepository(db);
  const initiative: Initiative = {
    id: newId(),
    projectId: "nonexistent-project",
    name: "Orphan",
  };
  assert.throws(() => repo.save(initiative));
});

test("SqliteInitiativeRepository saveObjective with unknown initiativeId throws (FK)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteInitiativeRepository(db);
  const objective: Objective = {
    id: newId(),
    initiativeId: "nonexistent-initiative",
    name: "Orphan Obj",
  };
  assert.throws(() => repo.saveObjective(objective));
});
