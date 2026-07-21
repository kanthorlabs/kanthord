import type { DatabaseSync } from "node:sqlite";

import type { TaskRepository, TaskResultRow, CasResult } from "../port.ts";
import type { Task, TaskStatus } from "../../domain/task.ts";
import { canonicalTask, sha256Hex } from "./node-sha.ts";

type TaskRow = {
  id: string;
  objectiveId: string;
  title: string;
  status: TaskStatus;
  agent: string;
  instructions: string;
  ac: string;
  verification: string | null;
  note: string | null;
};
type DepRow = { dependency: string };

/** `node:sqlite` adapter for the `TaskRepository` port. */
export class SqliteTaskRepository implements TaskRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Compute sha256 token from a task's aggregate fields. */
  #computeTaskSha(task: {
    title: string;
    instructions?: string;
    ac?: string[];
    agent?: string;
    verification?: string[];
    dependencies: string[];
    objectiveId: string;
    status: TaskStatus;
  }): string {
    return sha256Hex(
      canonicalTask({
        title: task.title,
        instructions: task.instructions ?? "",
        ac: task.ac ?? [],
        agent: task.agent ?? "generic@1",
        verification: task.verification,
        dependencies: task.dependencies,
        objectiveId: task.objectiveId,
        status: task.status,
      }),
    );
  }

  /**
   * Re-read current task fields + dependencies from DB, recompute the sha256
   * token, and stamp it onto the tasks row. Used after dep-table mutations.
   */
  #stampSha(taskId: string): void {
    const row = this.#db
      .prepare(
        "SELECT objectiveId, title, status, agent, instructions, ac, verification FROM tasks WHERE id = ?",
      )
      .get(taskId) as TaskRow | undefined;
    if (row === undefined) return;
    const deps = this.#db
      .prepare(
        "SELECT dependency FROM task_dependencies WHERE taskId = ? ORDER BY position ASC",
      )
      .all(taskId) as DepRow[];
    const sha = this.#computeTaskSha({
      title: row.title,
      instructions: row.instructions,
      ac: row.ac !== undefined ? (JSON.parse(row.ac) as string[]) : [],
      agent: row.agent,
      verification:
        row.verification != null
          ? (JSON.parse(row.verification) as string[])
          : undefined,
      dependencies: deps.map((d) => d.dependency),
      objectiveId: row.objectiveId,
      status: row.status,
    });
    this.#db
      .prepare("UPDATE tasks SET sha256 = ? WHERE id = ?")
      .run(sha, taskId);
  }

  save(task: Task): void {
    const sha = this.#computeTaskSha(task);
    this.#db
      .prepare(
        "INSERT INTO tasks (id, objectiveId, title, status, agent, instructions, ac, verification, sha256, note)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" +
          " ON CONFLICT(id) DO UPDATE SET" +
          " status = excluded.status," +
          " agent = excluded.agent," +
          " instructions = excluded.instructions," +
          " ac = excluded.ac," +
          " verification = excluded.verification," +
          " sha256 = excluded.sha256," +
          " note = excluded.note",
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
        sha,
        task.note ?? null,
      );
    const insertDep = this.#db.prepare(
      "INSERT OR IGNORE INTO task_dependencies (taskId, dependency, position) VALUES (?, ?, ?)",
    );
    for (const [i, dep] of task.dependencies.entries()) {
      insertDep.run(task.id, dep, i);
    }
  }

  saveAll(tasks: Task[]): void {
    this.#db.exec("SAVEPOINT saveAll");
    try {
      const insertTask = this.#db.prepare(
        "INSERT INTO tasks (id, objectiveId, title, status, agent, instructions, ac, verification, sha256)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const task of tasks) {
        const sha = this.#computeTaskSha(task);
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
          sha,
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
      this.#db.exec("RELEASE SAVEPOINT saveAll");
    } catch (err) {
      this.#db.exec("ROLLBACK TO SAVEPOINT saveAll");
      this.#db.exec("RELEASE SAVEPOINT saveAll");
      throw err;
    }
  }

  get(id: string): Task | undefined {
    const row = this.#db
      .prepare(
        "SELECT id, objectiveId, title, status, agent, instructions, ac, verification, note FROM tasks WHERE id = ?",
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
      ...(row.note != null ? { note: row.note } : {}),
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

  addDependency(taskId: string, dependencyId: string): void {
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
      .run(taskId, dependencyId, nextPos);
    this.#stampSha(taskId);
  }

  removeDependency(taskId: string, dependencyId: string): void {
    this.#db
      .prepare(
        "DELETE FROM task_dependencies WHERE taskId = ? AND dependency = ?",
      )
      .run(taskId, dependencyId);
    this.#stampSha(taskId);
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

  getSha256(id: string): string | undefined {
    type Row = { sha256: string };
    const row = this.#db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get(id) as Row | undefined;
    return row?.sha256;
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

  /**
   * Conditionally update a task's spec + dependency list.
   * Returns `applied` with a fresh sha on success, or `conflict` with the
   * current stored sha when `expectedSha` does not match.
   */
  compareAndApply(
    id: string,
    expectedSha: string,
    spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ): CasResult {
    type ShaRow = { sha256: string };
    const shaRow = this.#db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get(id) as ShaRow | undefined;
    const currentSha = shaRow?.sha256 ?? "";
    if (currentSha !== expectedSha) {
      return { status: "conflict", currentSha };
    }
    this.#db
      .prepare(
        "UPDATE tasks SET title = ?, instructions = ?, ac = ?, agent = ?, verification = ? WHERE id = ?",
      )
      .run(
        spec.title,
        spec.instructions,
        JSON.stringify(spec.ac),
        spec.agent,
        spec.verification !== null ? JSON.stringify(spec.verification) : null,
        id,
      );
    this.#db.prepare("DELETE FROM task_dependencies WHERE taskId = ?").run(id);
    const insertDep = this.#db.prepare(
      "INSERT INTO task_dependencies (taskId, dependency, position) VALUES (?, ?, ?)",
    );
    for (const [i, dep] of spec.dependencies.entries()) {
      insertDep.run(id, dep, i);
    }
    this.#stampSha(id);
    const freshRow = this.#db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get(id) as ShaRow | undefined;
    return { status: "applied", freshSha: freshRow?.sha256 ?? "" };
  }

  /**
   * Conditionally move a task to a different objective.
   * Returns `applied` with the updated sha, or `conflict` if the sha has
   * drifted since the caller last read it.
   */
  conditionalReparent(
    id: string,
    expectedSha: string,
    objectiveId: string,
  ): CasResult {
    type ShaRow = { sha256: string };
    const shaRow = this.#db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get(id) as ShaRow | undefined;
    const currentSha = shaRow?.sha256 ?? "";
    if (currentSha !== expectedSha) {
      return { status: "conflict", currentSha };
    }
    this.#db
      .prepare("UPDATE tasks SET objectiveId = ? WHERE id = ?")
      .run(objectiveId, id);
    this.#stampSha(id);
    const freshRow = this.#db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get(id) as ShaRow | undefined;
    return { status: "applied", freshSha: freshRow?.sha256 ?? "" };
  }

  /**
   * Conditionally delete a task (and cascade its graph_import_map row via FK).
   * Returns `applied` if the sha matched and the row was deleted, or `conflict`
   * if the sha has drifted.
   */
  conditionalDeleteTask(id: string, expectedSha: string): CasResult {
    type ShaRow = { sha256: string };
    const shaRow = this.#db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get(id) as ShaRow | undefined;
    const currentSha = shaRow?.sha256 ?? "";
    if (currentSha !== expectedSha) {
      return { status: "conflict", currentSha };
    }
    this.#db.prepare("DELETE FROM task_dependencies WHERE taskId = ?").run(id);
    this.#db
      .prepare("DELETE FROM task_dependencies WHERE dependency = ?")
      .run(id);
    this.#db.prepare("DELETE FROM events WHERE taskId = ?").run(id);
    this.#db.prepare("DELETE FROM jobs WHERE taskId = ?").run(id);
    this.#db.prepare("DELETE FROM task_context WHERE task_id = ?").run(id);
    this.#db.prepare("DELETE FROM task_results WHERE task_id = ?").run(id);
    this.#db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return { status: "applied", freshSha: "" };
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

  /** Resolve a repository resource's configured canonical branch. */
  getRepositoryBranch(repoId: string): string | undefined {
    type Row = { attributes: string };
    const row = this.#db
      .prepare(
        "SELECT attributes FROM resources WHERE id = ? AND type = 'repository'",
      )
      .get(repoId) as Row | undefined;
    if (row === undefined) return undefined;
    const attrs = JSON.parse(row.attributes) as Record<string, unknown>;
    const branch = attrs["branch"];
    return typeof branch === "string" ? branch : undefined;
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
