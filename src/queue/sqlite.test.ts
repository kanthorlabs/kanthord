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
  initRepo.save({ id: initiativeId, projectId, name: "Init" });
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
}

function spawnWorker(
  dbPath: string,
  barrierFile: string,
  batch = false,
): {
  ready: Promise<void>;
  done: Promise<WorkerResult>;
} {
  const args = ["--db", dbPath, "--wait-for", barrierFile];
  if (batch) args.push("--batch");
  const child = spawn("node", [WORKER_PATH, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines: string[] = [];
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

  const done = new Promise<WorkerResult>((resolve, reject) => {
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0)
        readyReject(new Error(`worker exited with code ${exitCode}`));
      resolve({ exitCode, lines });
    });
    child.on("error", (err) => {
      readyReject(err);
      reject(err);
    });
  });

  return { ready, done };
}

test(
  "exact race: exactly one child claims, one sees empty",
  { timeout: 10000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanthord-race-test-"));
    const dbPath = join(dir, "race.db");
    const barrierFile = join(dir, "barrier");
    after(() => {
      rmSync(dir, { recursive: true });
    });

    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    const taskId = seedTask(db);
    const queue = new SqliteJobQueue(db);
    queue.enqueue(taskId);
    db.close();

    const w1 = spawnWorker(dbPath, barrierFile);
    const w2 = spawnWorker(dbPath, barrierFile);

    await Promise.all([w1.ready, w2.ready]);
    writeFileSync(barrierFile, "go");

    const [r1, r2] = await Promise.all([w1.done, w2.done]);
    assert.equal(r1.exitCode, 0, `worker 1 exited with ${r1.exitCode}`);
    assert.equal(r2.exitCode, 0, `worker 2 exited with ${r2.exitCode}`);

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
  initRepo.save({ id: initiativeId, projectId, name: "Init" });
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
  initRepo.save({ id: initiativeId, projectId, name: "Init" });

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
    after(() => {
      rmSync(dir, { recursive: true });
    });

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

    await Promise.all([w1.ready, w2.ready]);
    writeFileSync(barrierFile, "go");

    const [r1, r2] = await Promise.all([w1.done, w2.done]);
    assert.equal(r1.exitCode, 0, `worker 1 exited with ${r1.exitCode}`);
    assert.equal(r2.exitCode, 0, `worker 2 exited with ${r2.exitCode}`);

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
