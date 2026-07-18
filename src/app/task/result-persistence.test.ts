/**
 * Story 06 T2 — RunNextTask tx2 persistence of task_results
 *
 * Integration tests using the real SQLite adapters + a scripted runner on a
 * temp DB.  Verifies that tx2 writes (and correctly populates) a task_results
 * row when a completed TaskResult carries workspace/branch/commitSha/evidence.
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
import { RegistryRunnerResolver } from "../../agent-runner/resolver.ts";
import { RunNextTask } from "./run-next-task.ts";
import type {
  AgentRunner,
  TaskContextBinding,
  TaskResult,
} from "../../agent-runner/port.ts";
import type { Task } from "../../domain/task.ts";
import type { VerificationEvidence } from "../../agent-runner/verification.ts";

// ---------------------------------------------------------------------------
// Scripted runner — returns a pre-configured TaskResult.
// ---------------------------------------------------------------------------

class ScriptedRunner implements AgentRunner {
  readonly #result: TaskResult;
  constructor(result: TaskResult) {
    this.#result = result;
  }
  async run(_task: Task, _context: TaskContextBinding[]): Promise<TaskResult> {
    return this.#result;
  }
}

// ---------------------------------------------------------------------------
// Setup helper — temp DB with migrations + one FK chain + one queued job.
// ---------------------------------------------------------------------------

interface Fixture {
  db: ReturnType<typeof openDatabase>;
  taskId: string;
  cleanup(): void;
}

function setupDb(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-result-persist-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db, MIGRATIONS);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();
  const taskId = newId();
  const jobId = newId();

  db.exec(
    `INSERT INTO projects(id, name) VALUES('${projectId}', 'proj');` +
      `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeId}', '${projectId}', 'init');` +
      `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveId}', '${initiativeId}', 'obj');` +
      `INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskId}', '${objectiveId}', 'task1', 'pending');` +
      `INSERT INTO jobs(id, taskId, status) VALUES('${jobId}', '${taskId}', 'queued');`,
  );

  return {
    db,
    taskId,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("RunNextTask tx2 persists task_results row with evidence JSON for completed result with evidence", async () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const evidence: VerificationEvidence[] = [
      { command: "npm test", exitCode: 0, output: "ok" },
      { command: "npm run lint", exitCode: 0, output: "clean" },
    ];

    const runner = new ScriptedRunner({
      outcome: "completed",
      workspace: "/ws/task-001",
      branch: "kanthord/task-001",
      commitSha: "deadbeef",
      summary: "agent finished",
      evidence,
    });

    const repo = new SqliteTaskRepository(db);
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const resolver = new RegistryRunnerResolver({
      runners: new Map<string, AgentRunner>([["generic@1", runner]]),
    });

    const uc = new RunNextTask(queue, repo, feed, uow, resolver);
    const result = await uc.execute();

    assert.equal(
      result.outcome,
      "completed",
      `task must complete (got: ${result.outcome})`,
    );

    // Assert task_results row was persisted.
    const row = db
      .prepare("SELECT * FROM task_results WHERE task_id = ?")
      .get(taskId) as
      | {
          task_id: string;
          workspace: string;
          branch: string;
          commit_sha: string;
          summary: string;
          evidence: string;
        }
      | undefined;

    assert.ok(
      row !== undefined,
      "task_results row must be written after completed tx2",
    );
    assert.equal(row!.workspace, "/ws/task-001", "workspace persisted");
    assert.equal(row!.branch, "kanthord/task-001", "branch persisted");
    assert.equal(row!.commit_sha, "deadbeef", "commit_sha persisted");
    assert.equal(row!.summary, "agent finished", "summary persisted");

    const evidenceParsed = JSON.parse(row!.evidence) as VerificationEvidence[];
    assert.equal(evidenceParsed.length, 2, "evidence must have 2 entries");
    assert.equal(evidenceParsed[0]!.command, "npm test");
    assert.equal(evidenceParsed[0]!.exitCode, 0);
    assert.equal(evidenceParsed[1]!.command, "npm run lint");
    assert.equal(evidenceParsed[1]!.exitCode, 0);
  } finally {
    cleanup();
  }
});

test("RunNextTask tx2 persists task_results row with null evidence for completed result without evidence", async () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const runner = new ScriptedRunner({
      outcome: "completed",
      workspace: "/ws/task-002",
      branch: "kanthord/task-002",
      commitSha: "cafebabe",
      summary: "done quietly",
      // no evidence field
    });

    const repo = new SqliteTaskRepository(db);
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const resolver = new RegistryRunnerResolver({
      runners: new Map<string, AgentRunner>([["generic@1", runner]]),
    });

    const uc = new RunNextTask(queue, repo, feed, uow, resolver);
    const result = await uc.execute();

    assert.equal(result.outcome, "completed", "task must complete");

    const row = db
      .prepare(
        "SELECT workspace, commit_sha, evidence FROM task_results WHERE task_id = ?",
      )
      .get(taskId) as
      | { workspace: string; commit_sha: string; evidence: string | null }
      | undefined;

    assert.ok(
      row !== undefined,
      "task_results row must be written even when evidence is absent",
    );
    assert.equal(row!.workspace, "/ws/task-002", "workspace persisted");
    assert.equal(row!.commit_sha, "cafebabe", "commit_sha persisted");
    assert.equal(
      row!.evidence,
      null,
      "evidence column must be NULL when no evidence provided",
    );
  } finally {
    cleanup();
  }
});
