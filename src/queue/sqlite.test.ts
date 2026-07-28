import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../storage/sqlite/open.ts";

const WORKER_PATH = fileURLToPath(
  new URL("./claim-worker.test-helper.ts", import.meta.url),
);
import { migrate } from "../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../storage/sqlite/migrations.ts";
import { SqliteProjectRepository } from "../storage/sqlite/sqlite-project-repository.ts";
import { SqliteInitiativeRepository } from "../storage/sqlite/sqlite-initiative-repository.ts";
import { SqliteTaskRepository } from "../storage/sqlite/sqlite-task-repository.ts";
import { newId } from "../domain/entity.ts";
import { SqliteJobQueue } from "./sqlite.ts";
import { StaleLeaseError } from "./port.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-queue-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

function seedTask(db: ReturnType<typeof openDatabase>): string {
  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const taskRepo = new SqliteTaskRepository(db);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();
  const taskId = newId();

  projectRepo.save({ id: projectId, name: "Proj" });
  initRepo.save({ id: initiativeId, projectId, name: "Init", paused: false });
  initRepo.saveObjective({ id: objectiveId, initiativeId, name: "Obj" });
  taskRepo.save({
    id: taskId,
    objectiveId,
    title: "Task",
    status: "pending",
    dependencies: [],
  });

  return taskId;
}

test("enqueue then claim returns { id, taskId } and job is running", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);

  const inserted = queue.enqueue(taskId);
  assert.equal(inserted, true);

  const claimed = queue.claim();
  assert.ok(claimed !== undefined);
  assert.equal(claimed.taskId, taskId);
  assert.ok(typeof claimed.id === "string" && claimed.id.length > 0);

  // verify the job is now running
  const row = db
    .prepare("SELECT status FROM jobs WHERE id = ?")
    .get(claimed.id) as { status: string } | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.status, "running");
});

test("claim on empty queue returns undefined", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const queue = new SqliteJobQueue(db);
  const claimed = queue.claim();
  assert.equal(claimed, undefined);
});

test("double enqueue leaves one queued job and returns true then false", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);

  const first = queue.enqueue(taskId);
  assert.equal(first, true);

  const second = queue.enqueue(taskId);
  assert.equal(second, false);

  // exactly one queued row for this taskId
  const row = db
    .prepare(
      "SELECT count(*) AS cnt FROM jobs WHERE taskId = ? AND status = 'queued'",
    )
    .get(taskId) as { cnt: number } | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.cnt, 1);
});

test("after claiming, re-enqueue of same task returns true and creates new queued job", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);

  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  // now that the job is 'running', a new enqueue should succeed
  const requeued = queue.enqueue(taskId);
  assert.equal(requeued, true);

  // one running, one queued
  const running = db
    .prepare(
      "SELECT count(*) AS cnt FROM jobs WHERE taskId = ? AND status = 'running'",
    )
    .get(taskId) as { cnt: number } | undefined;
  const queued = db
    .prepare(
      "SELECT count(*) AS cnt FROM jobs WHERE taskId = ? AND status = 'queued'",
    )
    .get(taskId) as { cnt: number } | undefined;
  assert.ok(running !== undefined && queued !== undefined);
  assert.equal(running.cnt, 1);
  assert.equal(queued.cnt, 1);
});

test("two tasks enqueued in order are claimed oldest-first", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId1 = seedTask(db);
  const taskId2 = seedTask(db);
  const queue = new SqliteJobQueue(db);

  queue.enqueue(taskId1);
  queue.enqueue(taskId2);

  const first = queue.claim();
  assert.ok(first !== undefined);
  assert.equal(first.taskId, taskId1);

  const second = queue.claim();
  assert.ok(second !== undefined);
  assert.equal(second.taskId, taskId2);
});

// ---------------------------------------------------------------------------
// Multi-process claim proof (S004-T2)
// ---------------------------------------------------------------------------

interface WorkerResult {
  exitCode: number;
  lines: string[];
  /**
   * The child's stderr. Captured because a worker that dies inside
   * `openDatabase` exits before printing "ready", and without its stderr the
   * only signal is a bare exit code — undiagnosable after the fact.
   * See the FINDING comment in `src/storage/sqlite/open.ts` for the leading
   * suspect if this test ever fails again.
   */
  stderr: string;
}

function spawnWorker(
  dbPath: string,
  barrierFile: string,
  batch = false,
): {
  ready: Promise<void>;
  done: Promise<WorkerResult>;
  /**
   * Kills the child. Callers MUST invoke this before removing the barrier's temp
   * dir: a worker still waiting on a barrier that can never appear keeps the
   * test-file process alive, which hangs `node --test` forever — a timed-out or
   * failed assertion must not be able to strand a child.
   */
  kill: () => void;
} {
  const args = ["--db", dbPath, "--wait-for", barrierFile];
  if (batch) args.push("--batch");
  const child = spawn("node", [WORKER_PATH, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines: string[] = [];
  let stderr = "";
  let readyResolve!: () => void;
  let readyReject!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  child.stdout.on("data", (chunk: Buffer) => {
    chunk
      .toString()
      .split("\n")
      .filter((l) => l.trim() !== "")
      .forEach((l) => {
        const line = l.trim();
        if (line === "ready") readyResolve();
        else lines.push(line);
      });
  });

  // Drain stderr. Without this the pipe is opened and never read, so the reason
  // a worker exited non-zero is discarded and every failure looks identical.
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const done = new Promise<WorkerResult>((resolve, reject) => {
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0)
        readyReject(
          new Error(
            `worker exited with code ${exitCode} before signalling ready; stderr: ${stderr.trim() || "(empty)"}`,
          ),
        );
      resolve({ exitCode, lines, stderr });
    });
    child.on("error", (err) => {
      readyReject(err);
      reject(err);
    });
  });

  return {
    ready,
    done,
    kill: () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    },
  };
}

test(
  "exact race: exactly one child claims, one sees empty",
  { timeout: 10000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanthord-race-test-"));
    const dbPath = join(dir, "race.db");
    const barrierFile = join(dir, "barrier");

    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    const taskId = seedTask(db);
    const queue = new SqliteJobQueue(db);
    queue.enqueue(taskId);
    db.close();

    const w1 = spawnWorker(dbPath, barrierFile);
    const w2 = spawnWorker(dbPath, barrierFile);
    // Kill the children BEFORE removing the dir — removing it first strands any
    // still-waiting worker on a barrier that can never appear.
    after(() => {
      w1.kill();
      w2.kill();
      rmSync(dir, { recursive: true, force: true });
    });

    await Promise.all([w1.ready, w2.ready]);
    writeFileSync(barrierFile, "go");

    const [r1, r2] = await Promise.all([w1.done, w2.done]);
    assert.equal(
      r1.exitCode,
      0,
      `worker 1 exited with ${r1.exitCode}; stderr: ${r1.stderr.trim() || "(empty)"}`,
    );
    assert.equal(
      r2.exitCode,
      0,
      `worker 2 exited with ${r2.exitCode}; stderr: ${r2.stderr.trim() || "(empty)"}`,
    );

    const allLines = [...r1.lines, ...r2.lines];
    const claimed = allLines.filter((l) => l.startsWith("claimed "));
    const empty = allLines.filter((l) => l === "empty");
    assert.equal(
      claimed.length,
      1,
      `expected 1 claimed, got: ${claimed.join(", ")}`,
    );
    assert.equal(empty.length, 1, `expected 1 empty, got: ${empty.length}`);
    assert.equal(claimed[0], `claimed ${taskId}`);
  },
);

// ---------------------------------------------------------------------------
// S02-T4: JobQueue extensions
// ---------------------------------------------------------------------------

function seedTaskWithInitiative(db: ReturnType<typeof openDatabase>): {
  taskId: string;
  initiativeId: string;
} {
  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const taskRepo = new SqliteTaskRepository(db);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();
  const taskId = newId();

  projectRepo.save({ id: projectId, name: "Proj" });
  initRepo.save({ id: initiativeId, projectId, name: "Init", paused: false });
  initRepo.saveObjective({ id: objectiveId, initiativeId, name: "Obj" });
  taskRepo.save({
    id: taskId,
    objectiveId,
    title: "Task",
    status: "pending",
    dependencies: [],
  });

  return { taskId, initiativeId };
}

test("finish(jobId, 'completed') sets job status to completed", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  queue.finish(claimed.id, "completed");

  const row = db
    .prepare("SELECT status FROM jobs WHERE id = ?")
    .get(claimed.id) as { status: string } | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.status, "completed");
});

test("finish(jobId, 'failed') sets job status to failed", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  queue.finish(claimed.id, "failed");

  const row = db
    .prepare("SELECT status FROM jobs WHERE id = ?")
    .get(claimed.id) as { status: string } | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.status, "failed");
});

test("discard(jobId) deletes the job row", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  queue.discard(claimed.id);

  const row = db.prepare("SELECT id FROM jobs WHERE id = ?").get(claimed.id) as
    { id: string } | undefined;
  assert.equal(row, undefined);
});

test("listRunningJobs returns exactly the running jobs", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId1 = seedTask(db);
  const taskId2 = seedTask(db);
  const taskId3 = seedTask(db);
  const queue = new SqliteJobQueue(db);

  queue.enqueue(taskId1);
  queue.enqueue(taskId2);
  queue.enqueue(taskId3);

  const claimed1 = queue.claim();
  const claimed2 = queue.claim();
  assert.ok(claimed1 !== undefined);
  assert.ok(claimed2 !== undefined);

  // taskId3 still queued — should not appear
  const running = queue.listRunningJobs();
  assert.equal(running.length, 2);
  const runningIds = running.map((j) => j.id).sort();
  assert.deepEqual(runningIds, [claimed1.id, claimed2.id].sort());
});

test("claim skips queued job for paused initiative; claimable after resume", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const { taskId: pausedTaskId, initiativeId } = seedTaskWithInitiative(db);
  const activeTaskId = seedTask(db);
  const queue = new SqliteJobQueue(db);

  queue.enqueue(pausedTaskId);
  queue.enqueue(activeTaskId);

  // Pause the first initiative via raw SQL
  db.prepare("UPDATE initiatives SET paused = 1 WHERE id = ?").run(
    initiativeId,
  );

  // claim should skip the paused initiative's task and return the active one
  const claimed = queue.claim();
  assert.ok(claimed !== undefined, "should claim the active task");
  assert.equal(claimed.taskId, activeTaskId);

  // queue is now exhausted of claimable jobs (paused task remains queued)
  const second = queue.claim();
  assert.equal(second, undefined);

  // resume and now the formerly-paused task is claimable
  db.prepare("UPDATE initiatives SET paused = 0 WHERE id = ?").run(
    initiativeId,
  );
  const resumed = queue.claim();
  assert.ok(resumed !== undefined, "should claim after resume");
  assert.equal(resumed.taskId, pausedTaskId);
});

// ---------------------------------------------------------------------------
// Story E — per-initiative claim exclusion
// ---------------------------------------------------------------------------

function seedInitiative(db: ReturnType<typeof openDatabase>): string {
  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);

  const projectId = newId();
  const initiativeId = newId();

  projectRepo.save({ id: projectId, name: "Proj" });
  initRepo.save({ id: initiativeId, projectId, name: "Init", paused: false });

  return initiativeId;
}

function seedTaskUnderInitiative(
  db: ReturnType<typeof openDatabase>,
  initiativeId: string,
): string {
  const initRepo = new SqliteInitiativeRepository(db);
  const taskRepo = new SqliteTaskRepository(db);

  const objectiveId = newId();
  const taskId = newId();

  initRepo.saveObjective({ id: objectiveId, initiativeId, name: "Obj" });
  taskRepo.save({
    id: taskId,
    objectiveId,
    title: "Task",
    status: "pending",
    dependencies: [],
  });

  return taskId;
}

test("claim serializes tasks within the SAME initiative", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const initiativeId = seedInitiative(db);
  const taskId1 = seedTaskUnderInitiative(db, initiativeId);
  const taskId2 = seedTaskUnderInitiative(db, initiativeId);
  const queue = new SqliteJobQueue(db);

  queue.enqueue(taskId1);
  queue.enqueue(taskId2);

  const job1 = queue.claim();
  assert.ok(job1 !== undefined, "first claim should return task 1");
  assert.equal(job1.taskId, taskId1);

  // task 1's job is still running, so task 2 (same initiative) must NOT be
  // claimable yet.
  const blocked = queue.claim();
  assert.equal(
    blocked,
    undefined,
    "second claim must be blocked while the initiative has an in-flight job",
  );

  queue.finish(job1.id, "completed");

  const job2 = queue.claim();
  assert.ok(job2 !== undefined, "claim after finish should return task 2");
  assert.equal(job2.taskId, taskId2);
});

test("claim allows parallelism across DIFFERENT initiatives", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const initiativeId1 = seedInitiative(db);
  const initiativeId2 = seedInitiative(db);
  const taskId1 = seedTaskUnderInitiative(db, initiativeId1);
  const taskId2 = seedTaskUnderInitiative(db, initiativeId2);
  const queue = new SqliteJobQueue(db);

  queue.enqueue(taskId1);
  queue.enqueue(taskId2);

  const job1 = queue.claim();
  const job2 = queue.claim();
  assert.ok(job1 !== undefined, "first initiative's task should be claimable");
  assert.ok(
    job2 !== undefined,
    "second initiative's task should be claimable in parallel",
  );
  assert.notEqual(job1.taskId, job2.taskId);
});

test(
  "batch sweep: two workers together claim exactly the full set",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanthord-batch-test-"));
    const dbPath = join(dir, "batch.db");
    const barrierFile = join(dir, "barrier");

    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    const queue = new SqliteJobQueue(db);
    const taskIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const taskId = seedTask(db);
      taskIds.push(taskId);
      queue.enqueue(taskId);
    }
    db.close();

    const w1 = spawnWorker(dbPath, barrierFile, true);
    const w2 = spawnWorker(dbPath, barrierFile, true);
    // Kill the children BEFORE removing the dir — see the race test above.
    after(() => {
      w1.kill();
      w2.kill();
      rmSync(dir, { recursive: true, force: true });
    });

    await Promise.all([w1.ready, w2.ready]);
    writeFileSync(barrierFile, "go");

    const [r1, r2] = await Promise.all([w1.done, w2.done]);
    assert.equal(
      r1.exitCode,
      0,
      `worker 1 exited with ${r1.exitCode}; stderr: ${r1.stderr.trim() || "(empty)"}`,
    );
    assert.equal(
      r2.exitCode,
      0,
      `worker 2 exited with ${r2.exitCode}; stderr: ${r2.stderr.trim() || "(empty)"}`,
    );

    const set1 = new Set(r1.lines);
    const set2 = new Set(r2.lines);
    const totalLines = r1.lines.length + r2.lines.length;
    assert.equal(totalLines, 50, `expected 50 total claims, got ${totalLines}`);

    // disjoint
    for (const id of set1)
      assert.ok(!set2.has(id), `${id} claimed by both workers`);

    // union = all 50 enqueued ids
    const union = new Set([...set1, ...set2]);
    assert.equal(union.size, 50);
    for (const id of taskIds)
      assert.ok(union.has(id), `${id} not claimed by any worker`);
  },
);

// ---------------------------------------------------------------------------
// EPIC 013 Story 1 — lease identity (isLeaseCurrent, listRunningJobsForTask)
// ---------------------------------------------------------------------------

test("isLeaseCurrent returns true for a freshly claimed job's id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  assert.equal(
    queue.isLeaseCurrent(claimed.id),
    true,
    "a freshly claimed job's id is a current lease",
  );
});

test("isLeaseCurrent returns false for an unknown id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const queue = new SqliteJobQueue(db);
  assert.equal(
    queue.isLeaseCurrent("does-not-exist"),
    false,
    "an unknown id is not a current lease",
  );
});

test("isLeaseCurrent returns false for a queued job's id (only running is current)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);

  // pull the queued row's id directly from the jobs table
  const row = db
    .prepare("SELECT id FROM jobs WHERE taskId=? AND status='queued'")
    .get(taskId) as { id: string } | undefined;
  assert.ok(row !== undefined);
  assert.equal(
    queue.isLeaseCurrent(row.id),
    false,
    "a queued job is not a current lease (the run has not started)",
  );
});

test("isLeaseCurrent returns false after finish(jobId, 'completed')", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);
  queue.finish(claimed.id, "completed");

  assert.equal(
    queue.isLeaseCurrent(claimed.id),
    false,
    "after finish the lease is no longer current",
  );
});

test("isLeaseCurrent returns false after revoked=1 is set on a running job", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  // sanity: current before revoke
  assert.equal(queue.isLeaseCurrent(claimed.id), true);

  db.prepare("UPDATE jobs SET revoked=1 WHERE id=?").run(claimed.id);

  assert.equal(
    queue.isLeaseCurrent(claimed.id),
    false,
    "a revoked running job is not a current lease",
  );
});

test("listRunningJobsForTask returns [] for a task with only a queued job", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);

  const rows = queue.listRunningJobsForTask(taskId);
  assert.deepEqual(rows, [], "a queued-only task has no running jobs");
});

test("listRunningJobsForTask returns one row with revoked:false, revokeReason:null after claim", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  const rows = queue.listRunningJobsForTask(taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, claimed.id);
  assert.equal(rows[0]!.taskId, taskId);
  assert.equal(rows[0]!.revoked, false);
  assert.equal(rows[0]!.revokeReason, null);
});

test("listRunningJobsForTask returns revoked:true and the stored reason after direct UPDATE", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  db.prepare("UPDATE jobs SET revoked=1, revokeReason=? WHERE id=?").run(
    "why",
    claimed.id,
  );

  const rows = queue.listRunningJobsForTask(taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, claimed.id);
  assert.equal(rows[0]!.revoked, true);
  assert.equal(rows[0]!.revokeReason, "why");
});

test("listRunningJobsForTask ignores running jobs belonging to other tasks", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskIdA = seedTask(db);
  const taskIdB = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskIdA);
  queue.enqueue(taskIdB);
  const claimA = queue.claim();
  const claimB = queue.claim();
  assert.ok(claimA !== undefined);
  assert.ok(claimB !== undefined);

  const rowsA = queue.listRunningJobsForTask(taskIdA);
  assert.equal(rowsA.length, 1, "task A sees only its own running job");
  assert.equal(rowsA[0]!.taskId, taskIdA);

  const rowsB = queue.listRunningJobsForTask(taskIdB);
  assert.equal(rowsB.length, 1, "task B sees only its own running job");
  assert.equal(rowsB[0]!.taskId, taskIdB);
});

// ---------------------------------------------------------------------------
// EPIC 013 Story 2 — lease-guarded finish(): the row id IS the lease, and a
// write from a revoked / non-running / non-existent job must throw
// StaleLeaseError without mutating any row.
// ---------------------------------------------------------------------------

test("finish throws StaleLeaseError for an unknown id (013 S2)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const queue = new SqliteJobQueue(db);
  assert.throws(
    () => queue.finish("does-not-exist", "completed"),
    (err: unknown) => err instanceof StaleLeaseError,
    "finish on an unknown id must throw StaleLeaseError",
  );
});

test("finish throws StaleLeaseError for a queued job's id (013 S2)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);

  // pull the queued row's id directly from the jobs table
  const row = db
    .prepare("SELECT id FROM jobs WHERE taskId=? AND status='queued'")
    .get(taskId) as { id: string } | undefined;
  assert.ok(row !== undefined);

  assert.throws(
    () => queue.finish(row.id, "completed"),
    (err: unknown) => err instanceof StaleLeaseError,
    "finish on a queued job's id must throw StaleLeaseError (a queued job is not yet a lease)",
  );
});

test("finish throws StaleLeaseError for an already-finished job's id (013 S2)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);
  queue.finish(claimed.id, "completed");

  // second finish on the same (now completed) id
  assert.throws(
    () => queue.finish(claimed.id, "failed"),
    (err: unknown) => err instanceof StaleLeaseError,
    "finish on a completed job's id must throw StaleLeaseError",
  );
});

test("finish throws StaleLeaseError for a running row with revoked=1 (013 S2)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  // revoke the lease (Story 3 wires this; here we drive the column directly)
  db.prepare("UPDATE jobs SET revoked=1 WHERE id=?").run(claimed.id);

  assert.throws(
    () => queue.finish(claimed.id, "completed"),
    (err: unknown) => err instanceof StaleLeaseError,
    "finish on a revoked running job must throw StaleLeaseError",
  );
});

test("finish throw leaves the jobs row unchanged: zero rows written (013 S2)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  // Revoke; the row is still 'running' on disk, but the lease is no longer
  // current. A finish() call must be a no-op on disk.
  db.prepare("UPDATE jobs SET revoked=1 WHERE id=?").run(claimed.id);

  // Capture the on-disk state BEFORE the throw.
  const before = db
    .prepare("SELECT status, revoked FROM jobs WHERE id=?")
    .get(claimed.id) as { status: string; revoked: number };
  assert.equal(before.status, "running");
  assert.equal(before.revoked, 1);

  try {
    queue.finish(claimed.id, "completed");
  } catch {
    // expected
  }

  // The on-disk state MUST be byte-identical to before — no status change,
  // no row written. The epic's invariant: a revoked write is rolled back / a
  // no-op so the on-disk row never moves.
  const afterRow = db
    .prepare("SELECT status, revoked FROM jobs WHERE id=?")
    .get(claimed.id) as { status: string; revoked: number };
  assert.deepEqual(
    { status: afterRow.status, revoked: afterRow.revoked },
    { status: before.status, revoked: before.revoked },
    "finish() must not mutate the jobs row when the lease is stale",
  );
  assert.equal(afterRow.status, "running", "row stays 'running'");
  assert.equal(afterRow.revoked, 1, "row stays revoked=1");
});

test("late write from lease A cannot touch lease B's row (013 S2)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  // Two tasks in the same initiative (a real, distinct id for each).
  // After claim→discard of A, B is enqueued + claimed. The lease row id
  // belongs to B now. A's id is stale.
  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const taskRepo = new SqliteTaskRepository(db);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();
  const taskId1 = newId();
  const taskId2 = newId();
  projectRepo.save({ id: projectId, name: "P" });
  initRepo.save({ id: initiativeId, projectId, name: "I", paused: false });
  initRepo.saveObjective({ id: objectiveId, initiativeId, name: "O" });
  taskRepo.save({
    id: taskId1,
    objectiveId,
    title: "T1",
    status: "pending",
    dependencies: [],
  });
  taskRepo.save({
    id: taskId2,
    objectiveId,
    title: "T2",
    status: "pending",
    dependencies: [],
  });

  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId1);
  const claimA = queue.claim();
  assert.ok(claimA !== undefined);
  queue.discard(claimA.id);

  queue.enqueue(taskId2);
  const claimB = queue.claim();
  assert.ok(claimB !== undefined);

  // A late write from lease A must not touch lease B's row.
  assert.throws(
    () => queue.finish(claimA.id, "completed"),
    (err: unknown) => err instanceof StaleLeaseError,
    "finish(A, 'completed') is a stale-lease write — must throw StaleLeaseError",
  );
  // `discard` is id-keyed and deliberately unguarded: re-discarding A's gone
  // row is a no-op and must not touch B's row.
  queue.discard(claimA.id);

  // B's row is untouched and still current.
  const bRow = db
    .prepare("SELECT status FROM jobs WHERE id=?")
    .get(claimB.id) as { status: string } | undefined;
  assert.ok(bRow !== undefined);
  assert.equal(
    bRow.status,
    "running",
    "B's job row must still be 'running' — the late write from A did not touch it",
  );
  assert.equal(
    queue.isLeaseCurrent(claimB.id),
    true,
    "B's lease must still be current after A's stale writes",
  );
});

// ---------------------------------------------------------------------------
// EPIC 013 Story 3 — revoke() is a queue operation. The lease row stays
// `status='running'` (so the per-initiative NOT EXISTS guard keeps blocking
// new claims against the same initiative), but `revoked=1` flips the lease
// into a stale-lease state. The 5 tests cover: claimed→revoked, idempotency,
// unknown/queued/finished-not-found, and the post-revoke read-only view.
// ---------------------------------------------------------------------------

test("revoke returns 'revoked' on a claimed job and sets revoked=1 + revokeReason (013 S3)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  const result = queue.revoke(claimed.id, "stuck on a slow tool");
  assert.equal(result, "revoked", "a claimed job must revoke to 'revoked'");

  const row = db
    .prepare("SELECT status, revoked, revokeReason FROM jobs WHERE id=?")
    .get(claimed.id) as
    | { status: string; revoked: number; revokeReason: string | null }
    | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.status, "running", "row stays 'running' after revoke");
  assert.equal(row.revoked, 1, "row has revoked=1");
  assert.equal(row.revokeReason, "stuck on a slow tool", "reason persisted");
});

test("revoke returns 'already_revoked' on a second call and leaves the FIRST reason in place (013 S3)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  const first = queue.revoke(claimed.id, "first reason");
  assert.equal(first, "revoked");

  const second = queue.revoke(claimed.id, "second reason overwrites nothing");
  assert.equal(
    second,
    "already_revoked",
    "a second revoke on the same id must be idempotent — 'already_revoked'",
  );

  const row = db
    .prepare("SELECT revokeReason FROM jobs WHERE id=?")
    .get(claimed.id) as { revokeReason: string | null } | undefined;
  assert.ok(row !== undefined);
  assert.equal(
    row.revokeReason,
    "first reason",
    "the FIRST reason is preserved; the second call does NOT overwrite",
  );
});

test("revoke returns 'not_found' for an unknown id (013 S3)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const queue = new SqliteJobQueue(db);
  assert.equal(
    queue.revoke("does-not-exist", "any reason"),
    "not_found",
    "an unknown id revokes to 'not_found'",
  );
});

test("revoke returns 'not_found' for a queued job's id (013 S3)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);

  const row = db
    .prepare("SELECT id FROM jobs WHERE taskId=? AND status='queued'")
    .get(taskId) as { id: string } | undefined;
  assert.ok(row !== undefined);

  assert.equal(
    queue.revoke(row.id, "any reason"),
    "not_found",
    "a queued job has no live lease — revoke is 'not_found'",
  );
});

test("revoke returns 'not_found' for a finished job's id (013 S3)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);
  queue.finish(claimed.id, "completed");

  assert.equal(
    queue.revoke(claimed.id, "too late"),
    "not_found",
    "a finished job has no live lease — revoke is 'not_found'",
  );
});

test("after revoke, isLeaseCurrent is false while SELECT status is still 'running' (013 S3)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const taskId = seedTask(db);
  const queue = new SqliteJobQueue(db);
  queue.enqueue(taskId);
  const claimed = queue.claim();
  assert.ok(claimed !== undefined);

  // sanity: current before revoke
  assert.equal(queue.isLeaseCurrent(claimed.id), true);

  const r = queue.revoke(claimed.id, "any reason");
  assert.equal(r, "revoked");

  assert.equal(
    queue.isLeaseCurrent(claimed.id),
    false,
    "after revoke the lease is no longer current",
  );

  // The on-disk row keeps status='running' — that is what upholds the
  // per-initiative NOT EXISTS guard in claim() while a revoked run drains.
  const row = db
    .prepare("SELECT status FROM jobs WHERE id=?")
    .get(claimed.id) as { status: string } | undefined;
  assert.ok(row !== undefined);
  assert.equal(
    row.status,
    "running",
    "row keeps status='running' after revoke so a new claim is still blocked",
  );
});
