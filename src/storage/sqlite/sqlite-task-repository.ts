import type { DatabaseSync } from "node:sqlite";

import type { TaskRepository, TaskResultRow } from "../port.ts";
import type { Task, TaskStatus } from "../../domain/task.ts";

type TaskRow = {
  id: string;
  objectiveId: string;
  title: string;
  status: TaskStatus;
  agent: string;
  instructions: string;
  ac: string;
  verification: string | null;
};
type DepRow = { dependency: string };

/** `node:sqlite` adapter for the `TaskRepository` port. */
export class SqliteTaskRepository implements TaskRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  save(task: Task): void {
    this.#db
      .prepare(
        "INSERT INTO tasks (id, objectiveId, title, status, agent, instructions, ac, verification)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?)" +
          " ON CONFLICT(id) DO UPDATE SET" +
          " status = excluded.status," +
          " agent = excluded.agent," +
          " instructions = excluded.instructions," +
          " ac = excluded.ac," +
          " verification = excluded.verification",
      )
      .run(
        task.id,
        task.objectiveId,
        task.title,
        task.status,
        task.agent ?? "generic@1",
        task.instructions ?? "",
        JSON.stringify(task.ac ?? []),
        task.verification !== undefined
          ? JSON.stringify(task.verification)
          : null,
      );
    const insertDep = this.#db.prepare(
      "INSERT OR IGNORE INTO task_dependencies (taskId, dependency, position) VALUES (?, ?, ?)",
    );
    for (const [i, dep] of task.dependencies.entries()) {
      insertDep.run(task.id, dep, i);
    }
  }

  saveAll(tasks: Task[]): void {
    this.#db.exec("BEGIN");
    try {
      const insertTask = this.#db.prepare(
        "INSERT INTO tasks (id, objectiveId, title, status, agent, instructions, ac, verification)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const task of tasks) {
        insertTask.run(
          task.id,
          task.objectiveId,
          task.title,
          task.status,
          task.agent ?? "generic@1",
          task.instructions ?? "",
          JSON.stringify(task.ac ?? []),
          task.verification !== undefined
            ? JSON.stringify(task.verification)
            : null,
        );
      }
      const insertDep = this.#db.prepare(
        "INSERT INTO task_dependencies (taskId, dependency, position) VALUES (?, ?, ?)",
      );
      for (const task of tasks) {
        for (const [i, dep] of task.dependencies.entries()) {
          insertDep.run(task.id, dep, i);
        }
      }
      this.#db.exec("COMMIT");
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  get(id: string): Task | undefined {
    const row = this.#db
      .prepare(
        "SELECT id, objectiveId, title, status, agent, instructions, ac, verification FROM tasks WHERE id = ?",
      )
      .get(id) as TaskRow | undefined;
    if (row === undefined) return undefined;
    const deps = this.#db
      .prepare(
        "SELECT dependency FROM task_dependencies WHERE taskId = ? ORDER BY position ASC",
      )
      .all(id) as DepRow[];
    return {
      id: row.id,
      objectiveId: row.objectiveId,
      title: row.title,
      status: row.status,
      dependencies: deps.map((d) => d.dependency),
      agent: row.agent ?? "generic@1",
      instructions: row.instructions ?? "",
      ac: row.ac !== undefined ? (JSON.parse(row.ac) as string[]) : [],
      ...(row.verification != null
        ? { verification: JSON.parse(row.verification) as string[] }
        : {}),
    };
  }

  saveTaskContext(taskId: string, context: Record<string, string>): void {
    const upsert = this.#db.prepare(
      "INSERT INTO task_context (task_id, type, resource_id) VALUES (?, ?, ?) ON CONFLICT (task_id, type) DO UPDATE SET resource_id = excluded.resource_id",
    );
    for (const [type, resourceId] of Object.entries(context)) {
      upsert.run(taskId, type, resourceId);
    }
  }

  getTaskContext(taskId: string): Record<string, string> {
    type ContextRow = { type: string; resource_id: string };
    const rows = this.#db
      .prepare("SELECT type, resource_id FROM task_context WHERE task_id = ?")
      .all(taskId) as ContextRow[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.type] = row.resource_id;
    }
    return result;
  }

  addDependency(taskId: string, dependsOn: string): void {
    type MaxRow = { maxPos: number | null };
    const maxRow = this.#db
      .prepare(
        "SELECT MAX(position) AS maxPos FROM task_dependencies WHERE taskId = ?",
      )
      .get(taskId) as MaxRow | undefined;
    const nextPos =
      maxRow !== undefined && maxRow.maxPos !== null ? maxRow.maxPos + 1 : 0;
    this.#db
      .prepare(
        "INSERT INTO task_dependencies (taskId, dependency, position) VALUES (?, ?, ?)",
      )
      .run(taskId, dependsOn, nextPos);
  }

  removeDependency(taskId: string, dependsOn: string): void {
    this.#db
      .prepare(
        "DELETE FROM task_dependencies WHERE taskId = ? AND dependency = ?",
      )
      .run(taskId, dependsOn);
  }

  listTasksByObjective(objectiveId: string): Task[] {
    const rows = this.#db
      .prepare(
        "SELECT id, objectiveId, title, status, agent, instructions, ac, verification FROM tasks WHERE objectiveId = ? ORDER BY id ASC",
      )
      .all(objectiveId) as TaskRow[];
    const getDeps = this.#db.prepare(
      "SELECT dependency FROM task_dependencies WHERE taskId = ? ORDER BY position ASC",
    );
    return rows.map((row) => {
      const deps = getDeps.all(row.id) as DepRow[];
      return {
        id: row.id,
        objectiveId: row.objectiveId,
        title: row.title,
        status: row.status,
        dependencies: deps.map((d) => d.dependency),
        agent: row.agent ?? "generic@1",
        instructions: row.instructions ?? "",
        ac: row.ac !== undefined ? (JSON.parse(row.ac) as string[]) : [],
        ...(row.verification != null
          ? { verification: JSON.parse(row.verification) as string[] }
          : {}),
      };
    });
  }

  getInitiativeId(taskId: string): string | undefined {
    type Row = { initiativeId: string };
    const row = this.#db
      .prepare(
        "SELECT o.initiativeId FROM tasks t JOIN objectives o ON t.objectiveId = o.id WHERE t.id = ?",
      )
      .get(taskId) as Row | undefined;
    return row?.initiativeId;
  }

  listByInitiative(initiativeId: string): Task[] {
    const rows = this.#db
      .prepare(
        `SELECT t.id, t.objectiveId, t.title, t.status, t.agent, t.instructions, t.ac, t.verification
         FROM tasks t
         JOIN objectives o ON t.objectiveId = o.id
         WHERE o.initiativeId = ?
         ORDER BY t.id ASC`,
      )
      .all(initiativeId) as TaskRow[];
    const getDeps = this.#db.prepare(
      "SELECT dependency FROM task_dependencies WHERE taskId = ? ORDER BY position ASC",
    );
    return rows.map((row) => {
      const deps = getDeps.all(row.id) as DepRow[];
      return {
        id: row.id,
        objectiveId: row.objectiveId,
        title: row.title,
        status: row.status,
        dependencies: deps.map((d) => d.dependency),
        agent: row.agent ?? "generic@1",
        instructions: row.instructions ?? "",
        ac: row.ac !== undefined ? (JSON.parse(row.ac) as string[]) : [],
        ...(row.verification != null
          ? { verification: JSON.parse(row.verification) as string[] }
          : {}),
      };
    });
  }

  saveTaskResult(taskId: string, row: TaskResultRow): void {
    this.#db
      .prepare(
        "INSERT INTO task_results" +
          " (task_id, workspace, branch, base_commit, proposal_commit, commit_sha," +
          "  summary, reason, rejection_resolution, rejection_reason, evidence)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" +
          " ON CONFLICT(task_id) DO UPDATE SET" +
          " workspace = excluded.workspace," +
          " branch = excluded.branch," +
          " base_commit = excluded.base_commit," +
          " proposal_commit = excluded.proposal_commit," +
          " commit_sha = excluded.commit_sha," +
          " summary = excluded.summary," +
          " reason = excluded.reason," +
          " rejection_resolution = excluded.rejection_resolution," +
          " rejection_reason = excluded.rejection_reason," +
          " evidence = excluded.evidence",
      )
      .run(
        taskId,
        row.workspace,
        row.branch,
        row.baseCommit,
        row.proposalCommit,
        row.commitSha,
        row.summary,
        row.reason,
        row.rejectionResolution,
        row.rejectionReason,
        row.evidence !== null ? JSON.stringify(row.evidence) : null,
      );
  }

  getTaskResult(taskId: string): TaskResultRow | undefined {
    type ResultRow = {
      workspace: string | null;
      branch: string | null;
      base_commit: string | null;
      proposal_commit: string | null;
      commit_sha: string | null;
      summary: string | null;
      reason: string | null;
      rejection_resolution: string | null;
      rejection_reason: string | null;
      evidence: string | null;
    };
    const row = this.#db
      .prepare(
        "SELECT workspace, branch, base_commit, proposal_commit, commit_sha," +
          " summary, reason, rejection_resolution, rejection_reason, evidence" +
          " FROM task_results WHERE task_id = ?",
      )
      .get(taskId) as ResultRow | undefined;
    if (row === undefined) return undefined;
    return {
      workspace: row.workspace,
      branch: row.branch,
      baseCommit: row.base_commit,
      proposalCommit: row.proposal_commit,
      commitSha: row.commit_sha,
      summary: row.summary,
      reason: row.reason,
      rejectionResolution: row.rejection_resolution,
      rejectionReason: row.rejection_reason,
      evidence:
        row.evidence !== null
          ? (JSON.parse(row.evidence) as Array<{
              command: string;
              exitCode: number;
              output: string;
            }>)
          : null,
    };
  }
}
