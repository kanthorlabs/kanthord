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
import {
  sha256Hex,
  canonicalInitiative,
  canonicalObjective,
} from "./node-sha.ts";
import { newId } from "../../domain/entity.ts";
import { newTask } from "../../domain/task.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { CasResult } from "../port.ts";

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
    status: "building",
    paused: false,
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
  const initiative: Initiative = {
    id: newId(),
    projectId,
    name: "Dupe",
    status: "building",
    paused: false,
  };
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
  repo.save({ id: initiativeId, projectId, name: "I1", paused: false });

  // Insert second objective before first alphabetically by id to prove ordering
  const objB: Objective = {
    id: "b-" + newId(),
    initiativeId,
    name: "Objective B",
    status: "building",
  };
  const objA: Objective = {
    id: "a-" + newId(),
    initiativeId,
    name: "Objective A",
    status: "building",
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
    paused: false,
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
  repo.save({ id: initiativeId, projectId, name: "I-get-obj", paused: false });

  const objective: Objective = {
    id: newId(),
    initiativeId,
    name: "Obj to get",
    status: "building",
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

test("SqliteInitiativeRepository saveObjective persists commitOid and parentOid; getObjective round-trips them (Story B/C persistence)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-commit-oid" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-commit-oid",
    paused: false,
  });

  const objective: Objective = {
    id: newId(),
    initiativeId,
    name: "Obj with commitOid",
    status: "awaiting_confirmation",
    commitOid: "deadbeefcafef00d",
    parentOid: "0123456789abcdef",
  };
  repo.saveObjective(objective);

  const loaded = repo.getObjective(objective.id);
  assert.equal(loaded?.commitOid, "deadbeefcafef00d");
  assert.equal(loaded?.parentOid, "0123456789abcdef");
});

test("SqliteInitiativeRepository saveObjective persists note, conflictCause, observedTipOid, conflictReason; getObjective and listObjectives round-trip them (017 S1)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-decision-metadata" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-decision-metadata",
    paused: false,
  });

  const objective: Objective = {
    id: newId(),
    initiativeId,
    name: "Obj with decision metadata",
    status: "conflict",
    note: "resolve at the new tip",
    conflictCause: "cas-mismatch",
    observedTipOid: "abc123",
    conflictReason: "gate failed",
  };
  repo.saveObjective(objective);

  const loaded = repo.getObjective(objective.id);
  assert.equal(loaded?.note, "resolve at the new tip");
  assert.equal(loaded?.conflictCause, "cas-mismatch");
  assert.equal(loaded?.observedTipOid, "abc123");
  assert.equal(loaded?.conflictReason, "gate failed");

  const [listed] = repo.listObjectives(initiativeId);
  assert.equal(listed?.note, "resolve at the new tip");
  assert.equal(listed?.conflictCause, "cas-mismatch");
  assert.equal(listed?.observedTipOid, "abc123");
  assert.equal(listed?.conflictReason, "gate failed");
});

test("SqliteInitiativeRepository saveObjective without note/conflictCause/observedTipOid/conflictReason omits those keys on getObjective and listObjectives (017 S1)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-decision-metadata-absent" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-decision-metadata-absent",
    paused: false,
  });

  const objective: Objective = {
    id: newId(),
    initiativeId,
    name: "Obj without decision metadata",
  };
  repo.saveObjective(objective);

  const loaded = repo.getObjective(objective.id);
  assert.ok(loaded !== undefined);
  assert.equal("note" in loaded, false, "note key must be absent");
  assert.equal(
    "conflictCause" in loaded,
    false,
    "conflictCause key must be absent",
  );
  assert.equal(
    "observedTipOid" in loaded,
    false,
    "observedTipOid key must be absent",
  );
  assert.equal(
    "conflictReason" in loaded,
    false,
    "conflictReason key must be absent",
  );

  const [listed] = repo.listObjectives(initiativeId);
  assert.ok(listed !== undefined);
  assert.equal("note" in listed, false, "note key must be absent (list)");
  assert.equal(
    "conflictCause" in listed,
    false,
    "conflictCause key must be absent (list)",
  );
  assert.equal(
    "observedTipOid" in listed,
    false,
    "observedTipOid key must be absent (list)",
  );
  assert.equal(
    "conflictReason" in listed,
    false,
    "conflictReason key must be absent (list)",
  );
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
  repo.save({
    id: initiativeId,
    projectId,
    name: "target-initiative",
    paused: false,
  });

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
  repo.save({
    id: init1,
    projectId: proj1,
    name: "shared-name",
    paused: false,
  });
  repo.save({
    id: init2,
    projectId: proj2,
    name: "shared-name",
    paused: false,
  });

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
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-resolve-obj",
    paused: false,
  });

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
  repo.save({ id: init1Id, projectId, name: "Initiative One", paused: false });
  repo.save({ id: init2Id, projectId, name: "Initiative Two", paused: false });

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
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-resolve-obj-none",
    paused: false,
  });

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
    paused: false,
  };
  repo.save(initiative);
  repo.save({
    id: initiative.id,
    projectId,
    name: "Renamed Initiative",
    paused: false,
  });
  const loaded = repo.get(initiative.id);
  assert.equal(loaded?.name, "Renamed Initiative");
});

test("SqliteInitiativeRepository setPaused sets paused to true and listAllInitiatives reflects the flag", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-paused" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "Pausable", paused: false });

  // before: not paused
  const before = repo.listAllInitiatives();
  const beforeEntry = before.find((i) => i.id === initiativeId);
  assert.equal(
    beforeEntry?.paused,
    false,
    "new initiative must start unpaused",
  );

  repo.setPaused(initiativeId, true);
  const after_ = repo.listAllInitiatives();
  const afterEntry = after_.find((i) => i.id === initiativeId);
  assert.equal(
    afterEntry?.paused,
    true,
    "initiative must be paused after setPaused(id, true)",
  );
});

test("SqliteInitiativeRepository setPaused(id, false) clears the paused flag", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-resume" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "Resumable", paused: false });

  repo.setPaused(initiativeId, true);
  repo.setPaused(initiativeId, false);
  const rows = repo.listAllInitiatives();
  const entry = rows.find((i) => i.id === initiativeId);
  assert.equal(
    entry?.paused,
    false,
    "initiative must be unpaused after setPaused(id, false)",
  );
});

test("SqliteInitiativeRepository listAllInitiatives returns initiatives across multiple projects", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const proj1 = newId();
  const proj2 = newId();
  projectRepo.save({ id: proj1, name: "PA" });
  projectRepo.save({ id: proj2, name: "PB" });

  const repo = new SqliteInitiativeRepository(db);
  const init1 = newId();
  const init2 = newId();
  repo.save({ id: init1, projectId: proj1, name: "IA", paused: false });
  repo.save({ id: init2, projectId: proj2, name: "IB", paused: false });

  const all = repo.listAllInitiatives();
  const ids = all.map((i) => i.id);
  assert.ok(
    ids.includes(init1),
    "listAllInitiatives must include initiative from project 1",
  );
  assert.ok(
    ids.includes(init2),
    "listAllInitiatives must include initiative from project 2",
  );
  // each entry has an id and a paused flag
  for (const entry of all) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.paused, "boolean");
  }
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
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-rename-obj",
    paused: false,
  });

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

// ---------------------------------------------------------------------------
// S02-T4: write-hook stamps sha256 on initiative and objective mutation paths
// ---------------------------------------------------------------------------

type InitShaRow = { sha256: string };

function readInitiativeSha(
  db: ReturnType<typeof openDatabase>,
  id: string,
): string {
  const row = db
    .prepare("SELECT sha256 FROM initiatives WHERE id = ?")
    .get(id) as InitShaRow | undefined;
  if (row === undefined) throw new Error(`initiative ${id} not found`);
  return row.sha256;
}

function readObjectiveSha(
  db: ReturnType<typeof openDatabase>,
  id: string,
): string {
  const row = db
    .prepare("SELECT sha256 FROM objectives WHERE id = ?")
    .get(id) as InitShaRow | undefined;
  if (row === undefined) throw new Error(`objective ${id} not found`);
  return row.sha256;
}

test("save(initiative) stamps sha256Hex(canonicalInitiative({name, projectId}))", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-sha-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiative: Initiative = {
    id: newId(),
    projectId,
    name: "Sha Initiative",
    paused: false,
  };
  repo.save(initiative);

  const expected = sha256Hex(
    canonicalInitiative({ name: initiative.name, projectId }),
  );
  assert.equal(readInitiativeSha(db, initiative.id), expected);
});

test("saveObjective stamps sha256Hex(canonicalObjective({name, initiativeId}))", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-sha-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({ id: initiativeId, projectId, name: "I-sha-obj", paused: false });

  const objective: Objective = {
    id: newId(),
    initiativeId,
    name: "Sha Objective",
  };
  repo.saveObjective(objective);

  const expected = sha256Hex(
    canonicalObjective({ name: objective.name, initiativeId }),
  );
  assert.equal(readObjectiveSha(db, objective.id), expected);
});

test("re-saving initiative with a changed name bumps the sha256 token", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-bump-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiative: Initiative = {
    id: newId(),
    projectId,
    name: "Before Rename",
    paused: false,
  };
  repo.save(initiative);
  const shaBeforeRename = readInitiativeSha(db, initiative.id);

  repo.save({ ...initiative, name: "After Rename" });
  const shaAfterRename = readInitiativeSha(db, initiative.id);

  assert.notEqual(shaAfterRename, shaBeforeRename);
  const expectedAfter = sha256Hex(
    canonicalInitiative({ name: "After Rename", projectId }),
  );
  assert.equal(shaAfterRename, expectedAfter);
});

// ---------------------------------------------------------------------------
// S06-T2: CAS ops — conditionalRenameInitiative / conditionalRenameObjective /
//          conditionalDeleteObjective
// ---------------------------------------------------------------------------

test("conditionalRenameInitiative applies name change and returns applied with fresh sha", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-cas-rename-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Original Name",
    paused: false,
  });
  const originalSha = readInitiativeSha(db, initiativeId);

  const result: CasResult = repo.conditionalRenameInitiative(
    initiativeId,
    originalSha,
    "New Name",
  );

  assert.equal(result.status, "applied");
  assert.ok("freshSha" in result, "applied result must carry freshSha");
  assert.notEqual(
    (result as { status: "applied"; freshSha: string }).freshSha,
    originalSha,
    "freshSha must differ from originalSha after rename",
  );
  const expectedFreshSha = sha256Hex(
    canonicalInitiative({ name: "New Name", projectId }),
  );
  assert.equal(
    (result as { status: "applied"; freshSha: string }).freshSha,
    expectedFreshSha,
    "freshSha must equal recomputed canonical hash of new name",
  );
  assert.equal(repo.get(initiativeId)?.name, "New Name");
});

test("conditionalRenameInitiative returns conflict and leaves name unchanged on stale sha", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-cas-conflict-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Original Name",
    paused: false,
  });
  const realSha = readInitiativeSha(db, initiativeId);

  const result: CasResult = repo.conditionalRenameInitiative(
    initiativeId,
    "stale-sha-that-does-not-match",
    "New Name",
  );

  assert.equal(result.status, "conflict");
  assert.ok("currentSha" in result, "conflict result must carry currentSha");
  assert.equal(
    (result as { status: "conflict"; currentSha: string }).currentSha,
    realSha,
    "currentSha must equal the real stored sha",
  );
  assert.equal(
    repo.get(initiativeId)?.name,
    "Original Name",
    "name must be unchanged on conflict",
  );
});

test("conditionalRenameObjective applies name change and returns applied with fresh sha", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-cas-rename-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-cas-rename-obj",
    paused: false,
  });
  const objectiveId = newId();
  repo.saveObjective({ id: objectiveId, initiativeId, name: "Original Obj" });
  const originalSha = readObjectiveSha(db, objectiveId);

  const result: CasResult = repo.conditionalRenameObjective(
    objectiveId,
    originalSha,
    "New Obj Name",
  );

  assert.equal(result.status, "applied");
  assert.ok("freshSha" in result, "applied result must carry freshSha");
  assert.notEqual(
    (result as { status: "applied"; freshSha: string }).freshSha,
    originalSha,
    "freshSha must differ from originalSha after rename",
  );
  const expectedFreshSha = sha256Hex(
    canonicalObjective({ name: "New Obj Name", initiativeId }),
  );
  assert.equal(
    (result as { status: "applied"; freshSha: string }).freshSha,
    expectedFreshSha,
    "freshSha must equal recomputed canonical hash of new name",
  );
  assert.equal(repo.getObjective(objectiveId)?.name, "New Obj Name");
});

test("conditionalRenameObjective returns conflict and leaves name unchanged on stale sha", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-cas-conflict-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-cas-conflict-obj",
    paused: false,
  });
  const objectiveId = newId();
  repo.saveObjective({ id: objectiveId, initiativeId, name: "Original Obj" });
  const realSha = readObjectiveSha(db, objectiveId);

  const result: CasResult = repo.conditionalRenameObjective(
    objectiveId,
    "stale-sha-that-does-not-match",
    "New Obj Name",
  );

  assert.equal(result.status, "conflict");
  assert.ok("currentSha" in result, "conflict result must carry currentSha");
  assert.equal(
    (result as { status: "conflict"; currentSha: string }).currentSha,
    realSha,
    "currentSha must equal the real stored sha",
  );
  assert.equal(
    repo.getObjective(objectiveId)?.name,
    "Original Obj",
    "name must be unchanged on conflict",
  );
});

test("conditionalDeleteObjective deletes empty objective on sha match", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-cas-del-empty-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-cas-del-empty-obj",
    paused: false,
  });
  const objectiveId = newId();
  repo.saveObjective({
    id: objectiveId,
    initiativeId,
    name: "Empty Objective",
  });
  const sha = readObjectiveSha(db, objectiveId);

  const result: CasResult = repo.conditionalDeleteObjective(objectiveId, sha);

  // Status is "applied"; the row must be gone
  assert.equal(result.status, "applied");
  assert.equal(
    repo.getObjective(objectiveId),
    undefined,
    "objective must be deleted after conditionalDeleteObjective on match",
  );
});

test("conditionalDeleteObjective returns non-applied result for non-empty objective and leaves it intact", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-cas-del-nonempty-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-cas-del-nonempty-obj",
    paused: false,
  });
  const objectiveId = newId();
  repo.saveObjective({
    id: objectiveId,
    initiativeId,
    name: "Non-empty Objective",
  });
  const sha = readObjectiveSha(db, objectiveId);

  // Create a task referencing this objective so it is non-empty
  const taskRepo = new SqliteTaskRepository(db);
  const task = newTask({ objectiveId, title: "A task" });
  taskRepo.save(task);

  // Attempt to delete the non-empty objective
  const result = repo.conditionalDeleteObjective(objectiveId, sha);

  // Must NOT be "applied" — exact shape pinned by Story 08
  assert.notEqual(
    result.status,
    "applied",
    "non-empty objective must not be deleted",
  );
  assert.ok(
    repo.getObjective(objectiveId) !== undefined,
    "objective row must still exist after failed non-empty delete",
  );
});

// ---------------------------------------------------------------------------
// Story D (007.12): status persists on initiatives + objectives
// ---------------------------------------------------------------------------

test("save without an explicit status defaults the persisted initiative status to building", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-status-default-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  // no `status` field supplied
  repo.save({
    id: initiativeId,
    projectId,
    name: "No Status Given",
    paused: false,
  });

  assert.equal(repo.get(initiativeId)?.status, "building");
});

test("save persists and round-trips a non-default initiative status (landed)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-status-persist-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Landed Initiative",
    status: "landed",
    paused: false,
  });

  assert.equal(repo.get(initiativeId)?.status, "landed");
});

test("saveObjective without an explicit status defaults the persisted objective status to building", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-status-default-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-status-default-obj",
    paused: false,
  });

  const objectiveId = newId();
  // no `status` field supplied
  repo.saveObjective({ id: objectiveId, initiativeId, name: "No Status Obj" });

  assert.equal(repo.getObjective(objectiveId)?.status, "building");
});

test("saveObjective persists and round-trips a non-default objective status (integrated)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-status-persist-obj" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "I-status-persist-obj",
    paused: false,
  });

  const objectiveId = newId();
  repo.saveObjective({
    id: objectiveId,
    initiativeId,
    name: "Integrated Objective",
    status: "integrated",
  });

  assert.equal(repo.getObjective(objectiveId)?.status, "integrated");
});

test("re-saving an initiative with a new status updates the persisted status (upsert, not insert)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-status-update-init" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Status Update Initiative",
    status: "building",
    paused: false,
  });
  repo.save({
    id: initiativeId,
    projectId,
    name: "Status Update Initiative",
    status: "landed",
    paused: false,
  });

  assert.equal(repo.get(initiativeId)?.status, "landed");
});

test("listObjectives + listInitiatives include the persisted status field", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-status-list" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Listed Initiative",
    status: "landed",
    paused: false,
  });
  const objectiveId = newId();
  repo.saveObjective({
    id: objectiveId,
    initiativeId,
    name: "Listed Objective",
    status: "conflict",
  });

  const initiatives = repo.listInitiatives(projectId);
  assert.equal(
    initiatives.find((i) => i.id === initiativeId)?.status,
    "landed",
  );

  const objectives = repo.listObjectives(initiativeId);
  assert.equal(
    objectives.find((o) => o.id === objectiveId)?.status,
    "conflict",
  );
});

test("SqliteInitiativeRepository get returns no workspace key before setWorkspace is ever called", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-workspace-absent" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  const initiative: Initiative = {
    id: initiativeId,
    projectId,
    name: "Unprovisioned Initiative",
    status: "building",
    paused: false,
  };
  repo.save(initiative);

  const loaded = repo.get(initiativeId);
  assert.deepEqual(
    loaded,
    initiative,
    "an initiative with no workspace set must round-trip with no workspace key present",
  );
});

test("SqliteInitiativeRepository setWorkspace persists the clone dir; get() returns it as workspace", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-workspace" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Workspace Initiative",
    status: "building",
    paused: false,
  });

  repo.setWorkspace(initiativeId, "/tmp/kanthord/init/abc");

  assert.equal(
    repo.get(initiativeId)?.workspace,
    "/tmp/kanthord/init/abc",
    "get() must return the persisted clone dir as workspace",
  );
});

test("SqliteInitiativeRepository re-calling setWorkspace overwrites the persisted clone dir", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-workspace-overwrite" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Reprovisioned Initiative",
    status: "building",
    paused: false,
  });

  repo.setWorkspace(initiativeId, "/tmp/kanthord/init/first");
  repo.setWorkspace(initiativeId, "/tmp/kanthord/init/second");

  assert.equal(repo.get(initiativeId)?.workspace, "/tmp/kanthord/init/second");
});

test("SqliteInitiativeRepository listInitiatives includes the persisted workspace field", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-workspace-list" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  repo.save({
    id: initiativeId,
    projectId,
    name: "Listed Workspace Initiative",
    status: "building",
    paused: false,
  });
  repo.setWorkspace(initiativeId, "/tmp/kanthord/init/listed");

  const initiatives = repo.listInitiatives(projectId);
  assert.equal(
    initiatives.find((i) => i.id === initiativeId)?.workspace,
    "/tmp/kanthord/init/listed",
  );
});

// ---------------------------------------------------------------------------
// Story 1 (012) — `paused` is part of the creation INSERT and round-trips
// through get() / listInitiatives(). The conflict-update exclusion is the
// "setPaused is the only writer after creation" gate.
// ---------------------------------------------------------------------------

type PausedRow = { paused: number };

function readPausedColumn(
  db: ReturnType<typeof openDatabase>,
  id: string,
): number {
  const row = db
    .prepare("SELECT paused FROM initiatives WHERE id = ?")
    .get(id) as PausedRow | undefined;
  if (row === undefined) throw new Error(`initiative ${id} not found`);
  return row.paused;
}

test("SqliteInitiativeRepository save({ paused: true }) stores paused = 1 in one write, no setPaused needed", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-create-paused" });

  const repo = new SqliteInitiativeRepository(db);
  const initiative: Initiative = {
    id: newId(),
    projectId,
    name: "Born Paused",
    status: "building",
    paused: true,
  };
  repo.save(initiative);

  assert.equal(
    readPausedColumn(db, initiative.id),
    1,
    "paused === true must persist as 1 in the first write",
  );
});

test("SqliteInitiativeRepository save({ paused: false }) stores paused = 0; get() and listInitiatives() return paused as a boolean", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-create-active" });

  const repo = new SqliteInitiativeRepository(db);
  const activeId = newId();
  repo.save({
    id: activeId,
    projectId,
    name: "Active",
    status: "building",
    paused: false,
  });
  const pausedId = newId();
  repo.save({
    id: pausedId,
    projectId,
    name: "Paused",
    status: "building",
    paused: true,
  });

  assert.equal(
    readPausedColumn(db, activeId),
    0,
    "paused === false must persist as 0 in the first write",
  );
  assert.equal(
    readPausedColumn(db, pausedId),
    1,
    "paused === true must persist as 1 in the first write",
  );

  // get() round-trips the boolean
  assert.equal(repo.get(activeId)?.paused, false);
  assert.equal(repo.get(pausedId)?.paused, true);

  // listInitiatives() round-trips the boolean
  const listed = repo.listInitiatives(projectId);
  assert.equal(listed.find((i) => i.id === activeId)?.paused, false);
  assert.equal(listed.find((i) => i.id === pausedId)?.paused, true);
});

test("SqliteInitiativeRepository conflict-update exclusion: re-saving a paused:false snapshot does NOT clear a true value set by setPaused", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectRepo = new SqliteProjectRepository(db);
  const projectId = newId();
  projectRepo.save({ id: projectId, name: "P-conflict-exclusion" });

  const repo = new SqliteInitiativeRepository(db);
  const initiativeId = newId();
  // Creation with paused:false (stale in-memory snapshot)
  repo.save({
    id: initiativeId,
    projectId,
    name: "Conflict Exclusion",
    status: "building",
    paused: false,
  });
  // External mutator flips it to paused
  repo.setPaused(initiativeId, true);
  assert.equal(
    readPausedColumn(db, initiativeId),
    1,
    "setPaused(true) must persist 1",
  );
  // Stale re-save with paused:false MUST NOT overwrite the setPaused value
  repo.save({
    id: initiativeId,
    projectId,
    name: "Conflict Exclusion",
    status: "building",
    paused: false,
  });
  assert.equal(
    readPausedColumn(db, initiativeId),
    1,
    "ON CONFLICT DO UPDATE must not write paused — only setPaused owns the column",
  );
});
