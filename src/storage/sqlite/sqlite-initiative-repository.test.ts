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

test("SqliteInitiativeRepository duplicate save (same id + same data) is a no-op upsert", () => {
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
  // upsert semantics: re-saving identical data must not throw
  assert.doesNotThrow(() => repo.save(initiative));
  assert.deepEqual(repo.get(initiative.id), initiative);
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

test("SqliteInitiativeRepository getObjective returns the objective for a known id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-get-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "I-get-obj" });

  const objective: Objective = {
    id: newId(),
    initiativeId,
    name: "Obj to get",
  };
  repo.saveObjective(objective);

  const loaded = repo.getObjective(objective.id);
  assert.deepEqual(loaded, objective);
});

test("SqliteInitiativeRepository getObjective returns undefined for unknown id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteInitiativeRepository(db);
  assert.equal(repo.getObjective("nonexistent-objective"), undefined);
});

test("SqliteInitiativeRepository resolveInitiativeByName returns [id] for matching name in project scope", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-resolve-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "target-initiative" });

  const ids = repo.resolveInitiativeByName(projectId, "target-initiative");
  assert.deepEqual(ids, [initiativeId]);
});

test("SqliteInitiativeRepository resolveInitiativeByName returns [] for unknown name", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-resolve-none" });

  const repo = new SqliteInitiativeRepository(db);
  const ids = repo.resolveInitiativeByName(projectId, "no-such-initiative");
  assert.deepEqual(ids, []);
});

test("SqliteInitiativeRepository resolveInitiativeByName scopes by projectId — same name in two projects returns the correct scoped result", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const proj1 = newId();
  const proj2 = newId();
  projectRepo.save({ id: proj1, name: "Project One" });
  projectRepo.save({ id: proj2, name: "Project Two" });

  const repo = new SqliteInitiativeRepository(db);
  const init1 = newId();
  const init2 = newId();
  repo.save({ id: init1, projectId: proj1, name: "shared-name" });
  repo.save({ id: init2, projectId: proj2, name: "shared-name" });

  assert.deepEqual(repo.resolveInitiativeByName(proj1, "shared-name"), [init1]);
  assert.deepEqual(repo.resolveInitiativeByName(proj2, "shared-name"), [init2]);
});

test("SqliteInitiativeRepository resolveObjectiveByName returns [id] for matching name in initiative scope", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-resolve-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "I-resolve-obj" });

  const objectiveId = newId();
  repo.saveObjective({
    id: objectiveId,
    initiativeId,
    name: "target-objective",
  });

  const ids = repo.resolveObjectiveByName(initiativeId, "target-objective");
  assert.deepEqual(ids, [objectiveId]);
});

test("SqliteInitiativeRepository listInitiatives returns all initiatives for a project", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-list-init" });

  const repo = new SqliteInitiativeRepository(db);
  const init1Id = newId();
  const init2Id = newId();
  repo.save({ id: init1Id, projectId, name: "Initiative One" });
  repo.save({ id: init2Id, projectId, name: "Initiative Two" });

  const initiatives = repo.listInitiatives(projectId);
  assert.equal(initiatives.length, 2);
  const ids = initiatives.map((i) => i.id).sort();
  assert.deepEqual(ids, [init1Id, init2Id].sort());
});

test("SqliteInitiativeRepository listInitiatives returns [] for unknown projectId", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteInitiativeRepository(db);
  assert.deepEqual(repo.listInitiatives("nonexistent-project"), []);
});

test("SqliteInitiativeRepository resolveObjectiveByName returns [] for unknown name", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-resolve-obj-none" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "I-resolve-obj-none" });

  const ids = repo.resolveObjectiveByName(initiativeId, "no-such-objective");
  assert.deepEqual(ids, []);
});

// B2 regression: initiative rename must update the existing row, not insert a duplicate
test("SqliteInitiativeRepository save with same id and new name updates the name (rename)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-rename-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiative: Initiative = {
    id: newId(),
    projectId,
    name: "Original Initiative",
  };
  repo.save(initiative);
  repo.save({ id: initiative.id, projectId, name: "Renamed Initiative" });
  const loaded = repo.get(initiative.id);
  assert.equal(loaded?.name, "Renamed Initiative");
});

// B2 regression: objective rename must update the existing row, not insert a duplicate
test("SqliteInitiativeRepository saveObjective with same id and new name updates the name (rename)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-rename-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "I-rename-obj" });

  const objective: Objective = {
    id: newId(),
    initiativeId,
    name: "Original Objective",
  };
  repo.saveObjective(objective);
  repo.saveObjective({
    id: objective.id,
    initiativeId,
    name: "Renamed Objective",
  });
  const loaded = repo.getObjective(objective.id);
  assert.equal(loaded?.name, "Renamed Objective");
});
