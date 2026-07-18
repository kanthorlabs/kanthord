import type { DatabaseSync } from "node:sqlite";
import type { GraphImportMap } from "../port.ts";

/**
 * `node:sqlite` adapter for the `GraphImportMap` port.
 * Backed by the `graph_import_map` table (migration 6).
 */
export class SqliteGraphImportMap implements GraphImportMap {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  reserve(
    packageId: string,
    kind: string,
    ref: string,
    nodeId: string,
    creationSha: string,
  ): void {
    const objectiveId = kind === "objective" ? nodeId : null;
    const taskId = kind === "task" ? nodeId : null;
    this.#db
      .prepare(
        `INSERT INTO graph_import_map
           (package_id, kind, ref, objective_id, task_id, creation_sha)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(packageId, kind, ref, objectiveId, taskId, creationSha);
  }

  lookup(
    packageId: string,
    kind: string,
    ref: string,
  ): { nodeId: string; creationSha: string } | undefined {
    const row = this.#db
      .prepare(
        `SELECT objective_id, task_id, creation_sha
           FROM graph_import_map
          WHERE package_id = ? AND kind = ? AND ref = ?`,
      )
      .get(packageId, kind, ref) as
      | {
          objective_id: string | null;
          task_id: string | null;
          creation_sha: string;
        }
      | undefined;

    if (row === undefined) return undefined;
    const nodeId = (row.objective_id ?? row.task_id) as string;
    return { nodeId, creationSha: row.creation_sha };
  }
}
