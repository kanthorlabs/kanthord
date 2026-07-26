/**
 * Story 3 (13, 14) — Integration regression: the full daemon loop respects
 * initiative-level and objective-level sequencing.
 *
 * Uses real SQLite. Because `SqliteSequencingRepository` is created by the SE
 * as part of Story 2's port+adapter scope, this file imports it from its
 * expected path and will fail with ERR_MODULE_NOT_FOUND until the SE creates
 * that module.
 *
 * Step 1 (test 13):
 *   Two initiatives A and B in one project. B after: [A]. Each initiative has
 *   one zero-dependency pending task. runUntilIdle → A's task reaches
 *   completed and B's task is still pending; the events table holds zero
 *   task.ready rows for B's task id.
 *
 * Step 2 (test 14):
 *   Update A's status to landed and runUntilIdle again → B's task reaches
 *   completed and exactly one task.ready row exists for it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "../../storage/sqlite/open.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";
import { newId } from "../../domain/entity.ts";
import { SqliteJobQueue } from "../../queue/sqlite.ts";
import { SqliteEventFeed } from "../../events/sqlite.ts";
import { SqliteUnitOfWork } from "../../storage/sqlite/sqlite-unit-of-work.ts";
import { SqliteTaskRepository } from "../../storage/sqlite/sqlite-task-repository.ts";
import { SqliteSequencingRepository } from "../../storage/sqlite/sqlite-sequencing-repository.ts";
import type { SequencingSource } from "./enqueue-ready-tasks.ts";
import type {
  InitiativeStatus,
  ObjectiveStatus,
} from "../../domain/initiative.ts";
import { FakeRunner } from "../../agent-runner/fake.ts";
import { RegistryRunnerResolver } from "../../agent-runner/resolver.ts";
import { EnqueueReadyTasks } from "./enqueue-ready-tasks.ts";
import { RunNextTask } from "./run-next-task.ts";

// Narrow InitiativeSource backed by the real DB.
function makeInitiativeSource(db: ReturnType<typeof openDatabase>) {
  return {
    listAllInitiatives(): Array<{ id: string; paused: boolean }> {
      const rows = db
        .prepare("SELECT id, paused FROM initiatives ORDER BY id ASC")
        .all() as Array<{ id: string; paused: number }>;
      return rows.map((r) => ({ id: r.id, paused: r.paused !== 0 }));
    },
    get(id: string) {
      const row = db
        .prepare("SELECT status FROM initiatives WHERE id = ?")
        .get(id) as { status: string } | undefined;
      return row !== undefined
        ? { status: row.status as InitiativeStatus }
        : undefined;
    },
    getObjective(id: string) {
      const row = db
        .prepare("SELECT status FROM objectives WHERE id = ?")
        .get(id) as { status: string } | undefined;
      return row !== undefined
        ? { status: row.status as ObjectiveStatus }
        : undefined;
    },
  };
}

async function runUntilIdle(uc: RunNextTask): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const r = await uc.execute();
    if (r.outcome === "idle") return;
  }
  throw new Error("runUntilIdle: loop limit exceeded");
}

test("(13) two initiatives A and B, B after: [A], A building → runUntilIdle leaves B's task pending with zero task.ready events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-seq-13-"));
  const db = openDatabase(join(dir, "test.db"));
  try {
    migrate(db, MIGRATIONS);

    const projectId = newId();
    const initiativeA = newId();
    const initiativeB = newId();
    const objectiveA = newId();
    const objectiveB = newId();

    db.exec(
      `INSERT INTO projects(id, name) VALUES('${projectId}', 'p');` +
        `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeA}', '${projectId}', 'A');` +
        `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeB}', '${projectId}', 'B');` +
        `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveA}', '${initiativeA}', 'obj-a');` +
        `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveB}', '${initiativeB}', 'obj-b');`,
    );

    // Edge: B after: [A]
    db.exec(
      `INSERT INTO initiative_dependencies(initiativeId, dependency) VALUES('${initiativeB}', '${initiativeA}');`,
    );
    const seqRepo = new SqliteSequencingRepository(db);

    const taskRepo = new SqliteTaskRepository(db);
    const taskA = {
      id: newId(),
      objectiveId: objectiveA,
      title: "task-A",
      status: "pending" as const,
      dependencies: [],
    };
    const taskB = {
      id: newId(),
      objectiveId: objectiveB,
      title: "task-B",
      status: "pending" as const,
      dependencies: [],
    };
    taskRepo.save(taskA);
    taskRepo.save(taskB);

    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const runner = new FakeRunner({});
    const resolver = new RegistryRunnerResolver({
      runners: new Map([["generic@1", runner]]),
    });

    const initSrc = makeInitiativeSource(db);
    const enqueue = new EnqueueReadyTasks(
      initSrc,
      taskRepo,
      queue,
      feed,
      uow,
      seqRepo,
    );
    const runNext = new RunNextTask(queue, taskRepo, feed, uow, resolver);

    // Step 1: runUntilIdle
    await enqueue.execute();
    await runUntilIdle(runNext);

    // A's task must be completed
    const savedA = taskRepo.get(taskA.id)!;
    assert.equal(
      savedA.status,
      "completed",
      "A's task must be completed after runUntilIdle",
    );

    // B's task must still be pending
    const savedB = taskRepo.get(taskB.id)!;
    assert.equal(
      savedB.status,
      "pending",
      "B's task must stay pending when A is not landed",
    );

    // Zero task.ready events for B's task
    const events = feed.readAfter("");
    const bReady = events.filter(
      (e) => e.type === "task.ready" && e.taskId === taskB.id,
    );
    assert.equal(bReady.length, 0, "zero task.ready events for B's task id");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(14) after landing A and re-running → B's task is completed with exactly one task.ready event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-seq-14-"));
  const db = openDatabase(join(dir, "test.db"));
  try {
    migrate(db, MIGRATIONS);

    const projectId = newId();
    const initiativeA = newId();
    const initiativeB = newId();
    const objectiveA = newId();
    const objectiveB = newId();

    db.exec(
      `INSERT INTO projects(id, name) VALUES('${projectId}', 'p');` +
        `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeA}', '${projectId}', 'A');` +
        `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeB}', '${projectId}', 'B');` +
        `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveA}', '${initiativeA}', 'obj-a');` +
        `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveB}', '${initiativeB}', 'obj-b');`,
    );

    const seqRepo = new SqliteSequencingRepository(db);

    const taskRepo = new SqliteTaskRepository(db);
    const taskA = {
      id: newId(),
      objectiveId: objectiveA,
      title: "task-A",
      status: "pending" as const,
      dependencies: [],
    };
    const taskB = {
      id: newId(),
      objectiveId: objectiveB,
      title: "task-B",
      status: "pending" as const,
      dependencies: [],
    };
    taskRepo.save(taskA);
    taskRepo.save(taskB);

    // Edge: B after: [A]
    db.exec(
      `INSERT INTO initiative_dependencies(initiativeId, dependency) VALUES('${initiativeB}', '${initiativeA}');`,
    );

    // Pre-seed: A's task is completed, A's initiative is landed
    db.exec(
      `UPDATE tasks SET status='completed' WHERE id='${taskA.id}';` +
        `UPDATE initiatives SET status='landed' WHERE id='${initiativeA}';`,
    );

    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const runner = new FakeRunner({});
    const resolver = new RegistryRunnerResolver({
      runners: new Map([["generic@1", runner]]),
    });

    const initSrc = makeInitiativeSource(db);
    const enqueue = new EnqueueReadyTasks(
      initSrc,
      taskRepo,
      queue,
      feed,
      uow,
      seqRepo,
    );
    const runNext = new RunNextTask(queue, taskRepo, feed, uow, resolver);

    await enqueue.execute();
    await runUntilIdle(runNext);

    // B's task must be completed
    const savedB = taskRepo.get(taskB.id)!;
    assert.equal(
      savedB.status,
      "completed",
      "B's task must be completed when A is landed",
    );

    // Exactly one task.ready event for B's task
    const events = feed.readAfter("");
    const bReady = events.filter(
      (e) => e.type === "task.ready" && e.taskId === taskB.id,
    );
    assert.equal(
      bReady.length,
      1,
      "exactly one task.ready event for B's task id",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
