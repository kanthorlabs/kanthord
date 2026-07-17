/**
 * Integration tests — crash consistency (Story 04 Task T2).
 *
 * All three groups wire the *real* SQLite adapters + FakeRunner on a temp DB:
 *   (a) rollback: tx2 failure leaves task/job running; recovery + re-run completes it.
 *   (b) crash restart: manufactured running state recovered and completed with no duplicates.
 *   (c) idempotent re-scan: two extra recovery+scan rounds on a settled DB write nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../../storage/sqlite/open.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";
import { newId } from "../../domain/entity.ts";
import { SqliteJobQueue } from "../../queue/sqlite.ts";
import { SqliteEventFeed } from "../../events/sqlite.ts";
import { SqliteUnitOfWork } from "../../storage/sqlite/sqlite-unit-of-work.ts";
import { SqliteTaskRepository } from "../../storage/sqlite/sqlite-task-repository.ts";
import { FakeRunner } from "../../agent-runner/fake.ts";
import { RegistryRunnerResolver } from "../../agent-runner/resolver.ts";
import { EnqueueReadyTasks } from "./enqueue-ready-tasks.ts";
import { RunNextTask } from "./run-next-task.ts";
import { RecoverInterruptedTasks } from "./recover-interrupted-tasks.ts";
import type { Event } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";

// ---------------------------------------------------------------------------
// Setup helper — creates a temp DB with all migrations applied plus one
// project → initiative → objective → task chain.
// ---------------------------------------------------------------------------

interface Fixture {
  db: ReturnType<typeof openDatabase>;
  projectId: string;
  initiativeId: string;
  objectiveId: string;
  taskId: string;
  cleanup(): void;
}

function setupDb(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-consistency-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db, MIGRATIONS);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();
  const taskId = newId();

  db.exec(
    `INSERT INTO projects(id, name) VALUES('${projectId}', 'proj');` +
      `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeId}', '${projectId}', 'init');` +
      `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveId}', '${initiativeId}', 'obj');` +
      `INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskId}', '${objectiveId}', 'task1', 'pending');`,
  );

  return {
    db,
    projectId,
    initiativeId,
    objectiveId,
    taskId,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Narrow InitiativeSource backed by the real DB for EnqueueReadyTasks.
// ---------------------------------------------------------------------------

function makeInitiativeSource(db: ReturnType<typeof openDatabase>) {
  return {
    listAllInitiatives(): Array<{ id: string; paused: boolean }> {
      const rows = db
        .prepare("SELECT id, paused FROM initiatives ORDER BY id ASC")
        .all() as Array<{ id: string; paused: number }>;
      return rows.map((r) => ({ id: r.id, paused: r.paused !== 0 }));
    },
  };
}

// ---------------------------------------------------------------------------
// EventFeed wrapper that passes all appends through to the real feed except
// the first append with the specified type, which it throws on.
// ---------------------------------------------------------------------------

class ThrowOnTypeEventFeed implements EventFeed {
  readonly #inner: EventFeed;
  readonly #throwOnType: string;
  #thrown = false;

  constructor(inner: EventFeed, throwOnType: string) {
    this.#inner = inner;
    this.#throwOnType = throwOnType;
  }

  append(event: Event): void {
    if (!this.#thrown && event.type === this.#throwOnType) {
      this.#thrown = true;
      throw new Error(`injected failure on ${event.type}`);
    }
    this.#inner.append(event);
  }

  readAfter(cursor: string, limit?: number): Event[] {
    return this.#inner.readAfter(cursor, limit);
  }
}

// ---------------------------------------------------------------------------
// Helper: drain the claim-execute loop until idle (at most 50 iterations).
// ---------------------------------------------------------------------------

async function runUntilIdle(uc: RunNextTask): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const r = await uc.execute();
    if (r.outcome === "idle") return;
  }
  throw new Error("runUntilIdle: loop limit exceeded — possible infinite loop");
}

// ---------------------------------------------------------------------------
// Test (a): rollback in tx2 leaves task running; recovery + re-run completes it.
// ---------------------------------------------------------------------------

test("execution consistency — rollback in tx2 leaves task running; recovery + re-run completes it", async () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const queue = new SqliteJobQueue(db);
    const realFeed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const repo = new SqliteTaskRepository(db);
    const initSrc = makeInitiativeSource(db);

    // Enqueue the ready task.
    const enqueue = new EnqueueReadyTasks(initSrc, repo, queue, realFeed, uow);
    await enqueue.execute();

    // Use a feed that throws when task.completed is about to be appended (simulates tx2 crash).
    const throwingFeed = new ThrowOnTypeEventFeed(realFeed, "task.completed");
    const resolver = new RegistryRunnerResolver({
      defaultRunner: new FakeRunner({}),
    });
    const uc = new RunNextTask(queue, repo, throwingFeed, uow, resolver);

    // Execute — must throw because tx2 rolls back on the injected feed failure.
    await assert.rejects(uc.execute(), /injected failure/);

    // After rollback: task must still be running (tx1 committed its state transition).
    const taskMid = repo.get(taskId);
    assert.equal(
      taskMid?.status,
      "running",
      "task must still be running after tx2 rollback",
    );

    // Job must still be running (claim committed before tx1; tx2 rollback cannot undo it).
    const runningJobs = queue.listRunningJobs();
    assert.equal(
      runningJobs.length,
      1,
      "job must still be running after tx2 rollback",
    );

    // No task.completed event in the DB.
    const allEvents = realFeed.readAfter("0");
    const completedEvts = allEvents.filter((e) => e.type === "task.completed");
    assert.equal(
      completedEvts.length,
      0,
      "no task.completed event must exist after rollback",
    );

    // Recovery: reset the stuck task.
    const recovery = new RecoverInterruptedTasks(queue, repo, realFeed, uow);
    const recovered = recovery.execute();
    assert.deepEqual(
      recovered,
      [taskId],
      "recovery must return the recovered task id",
    );

    // Re-run with the clean feed: the task should now complete.
    const cleanResolver = new RegistryRunnerResolver({
      defaultRunner: new FakeRunner({}),
    });
    const cleanUc = new RunNextTask(queue, repo, realFeed, uow, cleanResolver);
    const result = await cleanUc.execute();
    assert.equal(result.outcome, "completed");

    const taskFinal = repo.get(taskId);
    assert.equal(
      taskFinal?.status,
      "completed",
      "task must be completed after clean re-run",
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test (b): crash restart — manufactured running state recovered and completed.
// ---------------------------------------------------------------------------

test("execution consistency — crash-state restart: manufactured running state recovered and completed", async () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const repo = new SqliteTaskRepository(db);
    const initSrc = makeInitiativeSource(db);

    // Manufacture post-tx1 state: task running, job running, task.started event appended.
    // (Simulates a daemon that crashed between tx1 commit and tx2 start.)
    const jobId = newId();
    const startedId = newId();
    db.exec(
      `UPDATE tasks SET status='running' WHERE id='${taskId}';` +
        `INSERT INTO jobs(id, taskId, status) VALUES('${jobId}', '${taskId}', 'running');` +
        `INSERT INTO events(id, type, taskId) VALUES('${startedId}', 'task.started', '${taskId}');`,
    );

    // Run recovery.
    const recovery = new RecoverInterruptedTasks(queue, repo, feed, uow);
    const recovered = recovery.execute();
    assert.deepEqual(
      recovered,
      [taskId],
      "recovery must return the recovered task id",
    );

    // Task reset to pending; no running jobs left.
    const taskAfterRecovery = repo.get(taskId);
    assert.equal(
      taskAfterRecovery?.status,
      "pending",
      "task must be reset to pending by recovery",
    );
    assert.equal(
      queue.listRunningJobs().length,
      0,
      "no running jobs after recovery",
    );

    // The recover already re-enqueued the task — run the loop until idle.
    const resolver = new RegistryRunnerResolver({
      defaultRunner: new FakeRunner({}),
    });
    const uc = new RunNextTask(queue, repo, feed, uow, resolver);
    await runUntilIdle(uc);

    const taskFinal = repo.get(taskId);
    assert.equal(
      taskFinal?.status,
      "completed",
      "task must be completed after recovery + re-run",
    );

    // No running jobs remain.
    assert.equal(
      queue.listRunningJobs().length,
      0,
      "no running jobs after completion",
    );

    // A further readiness scan must append zero new events (idempotent).
    const countBefore = feed.readAfter("0").length;
    const enqueue = new EnqueueReadyTasks(initSrc, repo, queue, feed, uow);
    await enqueue.execute();
    const countAfter = feed.readAfter("0").length;
    assert.equal(
      countAfter,
      countBefore,
      "a further scan after settling must write no new events",
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test (c): idempotent re-scan — two recovery+scan rounds on settled DB write nothing.
// ---------------------------------------------------------------------------

test("execution consistency — idempotent re-scan: two recovery+scan rounds on settled DB write nothing", async () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const repo = new SqliteTaskRepository(db);
    const initSrc = makeInitiativeSource(db);

    // Happy path: enqueue → complete.
    const enqueue = new EnqueueReadyTasks(initSrc, repo, queue, feed, uow);
    await enqueue.execute();

    const resolver = new RegistryRunnerResolver({
      defaultRunner: new FakeRunner({}),
    });
    const uc = new RunNextTask(queue, repo, feed, uow, resolver);
    await runUntilIdle(uc);

    const taskStatus = repo.get(taskId)?.status;
    assert.equal(
      taskStatus,
      "completed",
      "task must be completed before idempotency check",
    );

    // Snapshot counts after the first settled run.
    const eventCountAfterFirst = feed.readAfter("0").length;

    const recovery = new RecoverInterruptedTasks(queue, repo, feed, uow);

    // Round 1: recovery + scan.
    recovery.execute();
    await enqueue.execute();

    // Round 2: recovery + scan again.
    recovery.execute();
    await enqueue.execute();

    // Event count must not grow — a settled DB writes nothing on repeated recovery+scan.
    const eventCountAfterTwo = feed.readAfter("0").length;
    assert.equal(
      eventCountAfterTwo,
      eventCountAfterFirst,
      "two extra recovery+scan rounds must not add events to a settled DB",
    );

    // No phantom running jobs.
    assert.equal(
      queue.listRunningJobs().length,
      0,
      "no running jobs after idempotency rounds",
    );
  } finally {
    cleanup();
  }
});
