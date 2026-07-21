import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqliteLandingRepository } from "./landing.ts";
import { newChangeCandidate } from "../../domain/landing.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-landing-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  // Isolated repo unit test: the FK chain (project→initiative→objective→task)
  // is not what this suite exercises, so disable enforcement to let the
  // repository methods run against a minimal DB.
  db.exec("PRAGMA foreign_keys=OFF");
  return { db, dir, repo: new SqliteLandingRepository(db) };
}

// Explicit 26-char ids so ordering is deterministic (ULIDs sort by time/lex):
// "B".repeat(26) > "A".repeat(26) → the "latest" candidate by id is the B one.
const ID_A = "A".repeat(26);
const ID_B = "B".repeat(26);

function cand(id: string, taskId: string) {
  return newChangeCandidate({
    id,
    taskId,
    repoId: "repo-1",
    baseSHA: "baseSHA",
    candidateSHA: "candSHA",
    ref: "kanthord/t1",
    target: "release",
  });
}

test("SqliteLandingRepository.getCandidateByTask returns the saved candidate for a task", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  repo.saveCandidate(cand(ID_A, "task-1"));

  const got = repo.getCandidateByTask("task-1");
  assert.ok(got !== undefined, "must return the candidate for the task");
  assert.equal(got.id, ID_A);
  assert.equal(got.taskId, "task-1");
  assert.equal(got.repoId, "repo-1");
  assert.equal(got.baseSHA, "baseSHA");
  assert.equal(got.candidateSHA, "candSHA");
  assert.equal(got.ref, "kanthord/t1");
  assert.equal(got.target, "release");
  assert.equal(got.state, "pending");
});

test("SqliteLandingRepository.getCandidateByTask returns the latest when two candidates exist", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  repo.saveCandidate(cand(ID_A, "task-1"));
  repo.saveCandidate(cand(ID_B, "task-1"));

  const got = repo.getCandidateByTask("task-1");
  assert.ok(got !== undefined, "must return a candidate when two exist");
  // latest by id (ULIDs sort by time) must win
  assert.equal(got.id, ID_B, "must return the latest candidate by id");
});

test("SqliteLandingRepository.getCandidateByTask returns undefined when none", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(
    repo.getCandidateByTask("missing"),
    undefined,
    "must return undefined for an unknown task",
  );
});
