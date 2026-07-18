/**
 * Story 06 T3 — real-SQLite late-failure rollback (B10)
 *
 * Proves that ONE `UnitOfWork.transaction` (BEGIN IMMEDIATE) rolls back
 * entirely when an error is thrown after early successful CAS writes —
 * fakes cannot prove this atomicity guarantee.
 */
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
  const dir = mkdtempSync(join(tmpdir(), "kanthord-cas-rollback-"));
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

function makeTask(objectiveId: string, title: string): Task {
  return {
    id: newId(),
    objectiveId,
    title,
    instructions: "do something",
    ac: ["criterion one"],
    agent: "generic@1",
    status: "pending",
    dependencies: [],
  };
}

test(
  "UnitOfWork.transaction rolls back all CAS writes when late error thrown — " +
    "both task A and B sha unchanged after rollback",
  () => {
    const { db, dir } = makeTempDb();
    after(() => {
      db.close();
      rmSync(dir, { recursive: true });
    });

    const { objectiveId } = seedHierarchy(db);
    const repo = new SqliteTaskRepository(db);
    const uow = new SqliteUnitOfWork(db);

    // Persist two tasks outside the transaction
    const taskA = makeTask(objectiveId, "Task A");
    const taskB = makeTask(objectiveId, "Task B");
    repo.save(taskA);
    repo.save(taskB);

    // Record pre-txn sha values
    type ShaRow = { sha256: string };
    const preA = (
      db
        .prepare("SELECT sha256 FROM tasks WHERE id = ?")
        .get(taskA.id) as ShaRow
    ).sha256;
    const preB = (
      db
        .prepare("SELECT sha256 FROM tasks WHERE id = ?")
        .get(taskB.id) as ShaRow
    ).sha256;

    // Verify pre-txn shas are non-empty (write-hook fired on save)
    assert.ok(preA.length > 0, "taskA sha should be non-empty before txn");
    assert.ok(preB.length > 0, "taskB sha should be non-empty before txn");

    const specA = {
      title: "Task A — updated",
      instructions: "updated instructions",
      ac: ["updated criterion"],
      agent: "generic@1",
      verification: null,
      dependencies: [] as string[],
    };
    const specB = {
      title: "Task B — updated",
      instructions: "updated instructions B",
      ac: ["updated criterion B"],
      agent: "generic@1",
      verification: null,
      dependencies: [] as string[],
    };

    // Run a transaction that successfully applies task A, applies task B,
    // then throws a late error — simulating a real failure after partial work.
    assert.throws(
      () => {
        uow.transaction(() => {
          const resultA = repo.compareAndApply(taskA.id, preA, specA);
          assert.equal(
            resultA.status,
            "applied",
            "compareAndApply on task A should succeed inside txn",
          );

          const resultB = repo.compareAndApply(taskB.id, preB, specB);
          assert.equal(
            resultB.status,
            "applied",
            "compareAndApply on task B should succeed inside txn",
          );

          // Simulate a late failure (e.g. a constraint violation, network error,
          // or any unexpected throw after early writes have been staged)
          throw new Error("simulated late failure inside transaction");
        });
      },
      /simulated late failure/,
      "the late error should propagate out of uow.transaction",
    );

    // After the ROLLBACK, BOTH tasks must be byte-identical to their pre-txn state.
    const postA = (
      db
        .prepare("SELECT sha256 FROM tasks WHERE id = ?")
        .get(taskA.id) as ShaRow
    ).sha256;
    const postB = (
      db
        .prepare("SELECT sha256 FROM tasks WHERE id = ?")
        .get(taskB.id) as ShaRow
    ).sha256;

    assert.equal(
      postA,
      preA,
      "task A sha must be unchanged after rollback — compareAndApply inside the txn must not have persisted",
    );
    assert.equal(
      postB,
      preB,
      "task B sha must be unchanged after rollback — compareAndApply inside the txn must not have persisted",
    );

    // Also confirm that the titles were not persisted
    type TitleRow = { title: string };
    const titleA = (
      db
        .prepare("SELECT title FROM tasks WHERE id = ?")
        .get(taskA.id) as TitleRow
    ).title;
    const titleB = (
      db
        .prepare("SELECT title FROM tasks WHERE id = ?")
        .get(taskB.id) as TitleRow
    ).title;
    assert.equal(
      titleA,
      "Task A",
      "task A title must be unchanged after rollback",
    );
    assert.equal(
      titleB,
      "Task B",
      "task B title must be unchanged after rollback",
    );
  },
);
