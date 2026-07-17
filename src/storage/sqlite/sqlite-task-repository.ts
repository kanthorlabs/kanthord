import type { DatabaseSync } from "node:sqlite";

import type { TaskRepository } from "../port.ts";
import type { Task, TaskStatus } from "../../domain/task.ts";

type TaskRow = {
  id: string;
  objectiveId: string;
  title: string;
  status: TaskStatus;
};
type DepRow = { dependency: string };

/** `node:sqlite` adapter for the `TaskRepository` port. */
export class SqliteTaskRepository implements TaskRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  save(task: Task): void {
    this.#db.exec("BEGIN");
    try {
      this.#db
        .prepare(
          "INSERT INTO tasks (id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
        )
        .run(task.id, task.objectiveId, task.title, task.status);
      const insertDep = this.#db.prepare(
        "INSERT INTO task_dependencies (taskId, dependency, position) VALUES (?, ?, ?)",
      );
      for (const [i, dep] of task.dependencies.entries()) {
        insertDep.run(task.id, dep, i);
      }
      this.#db.exec("COMMIT");
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  saveAll(tasks: Task[]): void {
    this.#db.exec("BEGIN");
    try {
      const insertTask = this.#db.prepare(
        "INSERT INTO tasks (id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
      );
      for (const task of tasks) {
        insertTask.run(task.id, task.objectiveId, task.title, task.status);
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
      .prepare("SELECT id, objectiveId, title, status FROM tasks WHERE id = ?")
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
    };
  }

  listByInitiative(initiativeId: string): Task[] {
    const rows = this.#db
      .prepare(
        `SELECT t.id, t.objectiveId, t.title, t.status
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
      };
    });
  }
}
