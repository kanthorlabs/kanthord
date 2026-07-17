/**
 * Integration regression test — failure semantics (Story 06 Task T2).
 *
 * Graph: A → B (B depends on A); C is independent.
 * A is scripted to fail.
 *
 * Step 1: run until idle with A scripted to fail.
 *   → A: failed + task.failed event with reason
 *   → B: still pending, never enqueued
 *   → C: completed (daemon moved on)
 *
 * Step 2: RetryTask(A) + run until idle.
 *   → A: completed; B: completed.
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
import { RetryTask } from "./retry-task.ts";

async function runUntilIdle(uc: RunNextTask): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const r = await uc.execute();
    if (r.outcome === "idle") return;
  }
  throw new Error("runUntilIdle: loop limit exceeded — possible infinite loop");
}

test("failure semantics — failed task blocks dependents, daemon moves on, retry unblocks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-failure-"));
  const db = openDatabase(join(dir, "test.db"));
  try {
    migrate(db, MIGRATIONS);

    const projectId = newId();
    const initiativeId = newId();
    const objectiveId = newId();

    db.exec(
      `INSERT INTO projects(id, name) VALUES('${projectId}', 'proj');` +
        `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeId}', '${projectId}', 'init');` +
        `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveId}', '${initiativeId}', 'obj');`,
    );

    const repo = new SqliteTaskRepository(db);

    // Three tasks: A (independent), C (independent), B (depends on A).
    const taskA = {
      id: newId(),
      objectiveId,
      title: "A",
      status: "pending" as const,
      dependencies: [],
    };
    const taskC = {
      id: newId(),
      objectiveId,
      title: "C",
      status: "pending" as const,
      dependencies: [],
    };
    const taskB = {
      id: newId(),
      objectiveId,
      title: "B",
      status: "pending" as const,
      dependencies: [taskA.id],
    };

    repo.save(taskA);
    repo.save(taskC);
    repo.save(taskB);

    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);

    const initSrc = {
      listAllInitiatives(): Array<{ id: string; paused: boolean }> {
        return [{ id: initiativeId, paused: false }];
      },
    };

    const enqueue = new EnqueueReadyTasks(initSrc, repo, queue, feed, uow);

    // Step 1: A is scripted to fail; C should complete; B stays pending.
    const failingRunner = new FakeRunner({ failTaskIds: [taskA.id] });
    const resolver = new RegistryRunnerResolver({
      defaultRunner: failingRunner,
    });
    const runNext = new RunNextTask(queue, repo, feed, uow, resolver);

    await enqueue.execute();
    await runUntilIdle(runNext);

    // A must be failed.
    assert.equal(
      repo.get(taskA.id)?.status,
      "failed",
      "A must be failed after the run",
    );

    // B must still be pending (blocked by failed A).
    assert.equal(
      repo.get(taskB.id)?.status,
      "pending",
      "B must still be pending",
    );

    // C must be completed (daemon moved on past A's failure).
    assert.equal(
      repo.get(taskC.id)?.status,
      "completed",
      "C must be completed",
    );

    // One task.failed event for A with a non-empty reason.
    const events = feed.readAfter("0");
    const aFailedEvts = events.filter(
      (e) => e.type === "task.failed" && e.taskId === taskA.id,
    );
    assert.equal(aFailedEvts.length, 1, "exactly one task.failed event for A");
    assert.ok(
      (aFailedEvts[0]!.payload?.reason ?? "").length > 0,
      "task.failed event must carry a non-empty reason",
    );

    // B must never have been enqueued (no task.ready event for B).
    const bReadyEvts = events.filter(
      (e) => e.type === "task.ready" && e.taskId === taskB.id,
    );
    assert.equal(bReadyEvts.length, 0, "B must never have a task.ready event");

    // Step 2: retry A — reset to pending, re-enqueue, then run until idle.
    const kindResolver = {
      resolveKind(id: string): string | undefined {
        return id === taskA.id ? "task" : undefined;
      },
    };
    const retryUC = new RetryTask(repo, queue, feed, uow, kindResolver);
    await retryUC.execute({ taskId: taskA.id });

    // A must be pending again after retry.
    assert.equal(
      repo.get(taskA.id)?.status,
      "pending",
      "A must be pending after retry",
    );

    // Run until idle with a non-failing runner.
    const cleanRunner = new FakeRunner({});
    const cleanResolver = new RegistryRunnerResolver({
      defaultRunner: cleanRunner,
    });
    const cleanRunNext = new RunNextTask(queue, repo, feed, uow, cleanResolver);
    await runUntilIdle(cleanRunNext);

    // Both A and B must now be completed.
    assert.equal(
      repo.get(taskA.id)?.status,
      "completed",
      "A must be completed after retry + re-run",
    );
    assert.equal(
      repo.get(taskB.id)?.status,
      "completed",
      "B must be completed after A completes",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
