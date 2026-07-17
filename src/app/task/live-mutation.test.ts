/**
 * Integration tests — live mutation contract (Story 09, Task T1).
 *
 * All tests use the real SQLite adapters + RunDaemon (until-idle) +
 * an InstrumentedRunner that fires per-task callbacks — simulating
 * concurrent CLI mutations from a second process. Single-threaded
 * interleaving is equivalent here because every loop decision reads
 * the DB inside a transaction.
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
import { SqliteInitiativeRepository } from "../../storage/sqlite/sqlite-initiative-repository.ts";
import { SqliteProjectRepository } from "../../storage/sqlite/sqlite-project-repository.ts";
import { SqliteReferenceResolver } from "../../storage/sqlite/reference-resolver.ts";
import { SqliteTransactor } from "../../storage/sqlite/sqlite-transactor.ts";
import { FakeRunner } from "../../agent-runner/fake.ts";
import { RegistryRunnerResolver } from "../../agent-runner/resolver.ts";
import { EnqueueReadyTasks } from "./enqueue-ready-tasks.ts";
import { RecoverInterruptedTasks } from "./recover-interrupted-tasks.ts";
import { RunNextTask } from "./run-next-task.ts";
import { RunDaemon } from "./run-daemon.ts";
import { CreateTask } from "./create-task.ts";
import { AddDependency } from "./add-dependency.ts";
import { DependenciesLockedError } from "../../domain/task.ts";
import type {
  AgentRunner,
  TaskContextBinding,
  TaskResult,
} from "../../agent-runner/port.ts";
import type { Task } from "../../domain/task.ts";

// ---------------------------------------------------------------------------
// InstrumentedRunner — wraps FakeRunner; fires a per-task callback (if set)
// during run() to simulate a concurrent CLI mutation, then delegates.
// ---------------------------------------------------------------------------

class InstrumentedRunner implements AgentRunner {
  readonly #inner: FakeRunner;
  readonly #callbacks: Map<string, () => Promise<void>>;

  constructor(inner: FakeRunner, callbacks: Map<string, () => Promise<void>>) {
    this.#inner = inner;
    this.#callbacks = callbacks;
  }

  async run(task: Task, context: TaskContextBinding[]): Promise<TaskResult> {
    const cb = this.#callbacks.get(task.id);
    if (cb !== undefined) await cb();
    return this.#inner.run(task, context);
  }
}

// ---------------------------------------------------------------------------
// Setup fixture — temp DB + all real adapters + convenience helpers.
// ---------------------------------------------------------------------------

interface Fixture {
  taskRepo: SqliteTaskRepository;
  initiativeRepo: SqliteInitiativeRepository;
  projectRepo: SqliteProjectRepository;
  resolver: SqliteReferenceResolver;
  transactor: SqliteTransactor;
  queue: SqliteJobQueue;
  feed: SqliteEventFeed;
  uow: SqliteUnitOfWork;
  objectiveId: string;
  buildDaemon(runner: AgentRunner): RunDaemon;
  createTask(title: string, deps?: string[]): Promise<string>;
  cleanup(): void;
}

function setup(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-live-mutation-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db, MIGRATIONS);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();

  db.exec(
    `INSERT INTO projects(id, name) VALUES('${projectId}', 'proj');` +
      `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeId}', '${projectId}', 'init');` +
      `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveId}', '${initiativeId}', 'obj');`,
  );

  const queue = new SqliteJobQueue(db);
  const feed = new SqliteEventFeed(db);
  const uow = new SqliteUnitOfWork(db);
  const taskRepo = new SqliteTaskRepository(db);
  const initiativeRepo = new SqliteInitiativeRepository(db);
  const projectRepo = new SqliteProjectRepository(db);
  const resolver = new SqliteReferenceResolver(db);
  const transactor = new SqliteTransactor(db);

  function buildDaemon(runner: AgentRunner): RunDaemon {
    const runnerResolver = new RegistryRunnerResolver({
      defaultRunner: runner,
    });
    const enqueueReady = new EnqueueReadyTasks(
      initiativeRepo,
      taskRepo,
      queue,
      feed,
      uow,
    );
    const recover = new RecoverInterruptedTasks(queue, taskRepo, feed, uow);
    const runNext = new RunNextTask(queue, taskRepo, feed, uow, runnerResolver);
    return new RunDaemon({
      recover,
      enqueueReady,
      runNext,
      sleep: () => Promise.resolve(),
    });
  }

  const createTaskUc = new CreateTask(
    taskRepo,
    initiativeRepo,
    projectRepo,
    resolver,
  );

  return {
    taskRepo,
    initiativeRepo,
    projectRepo,
    resolver,
    transactor,
    queue,
    feed,
    uow,
    objectiveId,
    buildDaemon,
    createTask: (title, deps) =>
      createTaskUc.execute({ objectiveId, title, dependencies: deps }),
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1: Insert while running — new task created during execution is picked
// up by the same daemon run before it goes idle.
// ---------------------------------------------------------------------------

test("live mutation — insert while running: new task created during execution is picked up before idle", async () => {
  const d = setup();
  try {
    const task1 = await d.createTask("task1");

    let task2: string | undefined;
    const callbacks = new Map<string, () => Promise<void>>([
      [
        task1,
        async () => {
          task2 = await d.createTask("task2");
        },
      ],
    ]);

    const daemon = d.buildDaemon(
      new InstrumentedRunner(new FakeRunner({}), callbacks),
    );
    const result = await daemon.execute({ untilIdle: true });

    assert.equal(result.exitCode, 0, "daemon exits 0");
    assert.ok(task2 !== undefined, "task2 was created during execution");

    assert.equal(d.taskRepo.get(task1)?.status, "completed", "task1 completed");
    assert.equal(
      d.taskRepo.get(task2)?.status,
      "completed",
      "task2 picked up and completed",
    );

    const startedEvents = d.feed
      .readAfter("0")
      .filter((e) => e.type === "task.started");
    assert.equal(startedEvents.length, 2, "exactly two task.started events");
  } finally {
    d.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 2 + 4: Re-arrange while queued — during pivot execution the callback
// adds X→Y (making X depend on Y). X's stale queued job is then skipped and
// discarded; Y completes first; X is re-enqueued and executes exactly once.
// Event-stream order: Y task.completed before X task.started.
// ---------------------------------------------------------------------------

test("live mutation — re-arrange while queued: X→Y added during pivot; X stale job skipped; Y completes first; X executes exactly once", async () => {
  const d = setup();
  try {
    // Three independent ready tasks.
    const pivot = await d.createTask("pivot");
    const taskX = await d.createTask("taskX");
    const taskY = await d.createTask("taskY");

    const addDep = new AddDependency(
      d.taskRepo,
      d.initiativeRepo,
      d.resolver,
      d.feed,
      d.transactor,
    );

    const callbacks = new Map<string, () => Promise<void>>([
      [
        pivot,
        async () => {
          // X is still pending; add X→Y (X now depends on Y).
          await addDep.execute({ taskId: taskX, dependsOn: taskY });
        },
      ],
    ]);

    const daemon = d.buildDaemon(
      new InstrumentedRunner(new FakeRunner({}), callbacks),
    );
    const result = await daemon.execute({ untilIdle: true });

    assert.equal(result.exitCode, 0, "daemon exits 0");
    assert.equal(d.taskRepo.get(pivot)?.status, "completed", "pivot completed");
    assert.equal(d.taskRepo.get(taskX)?.status, "completed", "X completed");
    assert.equal(d.taskRepo.get(taskY)?.status, "completed", "Y completed");

    // Event-stream ordering: Y task.completed must appear before X task.started.
    const events = d.feed.readAfter("0");
    const yCompletedIdx = events.findIndex(
      (e) => e.type === "task.completed" && e.taskId === taskY,
    );
    const xStartedIdx = events.findIndex(
      (e) => e.type === "task.started" && e.taskId === taskX,
    );
    assert.ok(
      yCompletedIdx >= 0,
      "Y task.completed event exists in the stream",
    );
    assert.ok(xStartedIdx >= 0, "X task.started event exists in the stream");
    assert.ok(
      yCompletedIdx < xStartedIdx,
      `Y task.completed (idx ${yCompletedIdx}) must precede X task.started (idx ${xStartedIdx})`,
    );

    // X has exactly one task.started event.
    const xStartedCount = events.filter(
      (e) => e.type === "task.started" && e.taskId === taskX,
    ).length;
    assert.equal(xStartedCount, 1, "X has exactly one task.started event");
  } finally {
    d.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 3: No retro-blocking — AddDependency against a running task throws
// DependenciesLockedError (same error for a completed task).
// ---------------------------------------------------------------------------

test("live mutation — no retro-blocking: AddDependency on a running task throws DependenciesLockedError; same for a completed task", async () => {
  const d = setup();
  try {
    const task1 = await d.createTask("task1");
    const task2 = await d.createTask("task2");

    const addDep = new AddDependency(
      d.taskRepo,
      d.initiativeRepo,
      d.resolver,
      d.feed,
      d.transactor,
    );

    // Capture the error thrown when trying to add a dep to a running task.
    let runningError: unknown;
    const callbacks = new Map<string, () => Promise<void>>([
      [
        task1,
        async () => {
          // task1 is running (tx1 committed its status = 'running').
          try {
            await addDep.execute({ taskId: task1, dependsOn: task2 });
          } catch (err) {
            runningError = err;
          }
        },
      ],
    ]);

    const daemon = d.buildDaemon(
      new InstrumentedRunner(new FakeRunner({}), callbacks),
    );
    await daemon.execute({ untilIdle: true });

    // Must have caught DependenciesLockedError for the running-task attempt.
    assert.ok(
      runningError instanceof DependenciesLockedError,
      `expected DependenciesLockedError for running task, got: ${String(runningError)}`,
    );

    // Post-run: task1 is completed — AddDependency must also throw.
    assert.equal(d.taskRepo.get(task1)?.status, "completed", "task1 completed");
    await assert.rejects(
      () => addDep.execute({ taskId: task1, dependsOn: task2 }),
      DependenciesLockedError,
      "AddDependency on completed task throws DependenciesLockedError",
    );
  } finally {
    d.cleanup();
  }
});
