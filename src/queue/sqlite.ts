import type { DatabaseSync } from "node:sqlite";

import { newId } from "../domain/entity.ts";
import type { ClaimedJob, JobQueue } from "./port.ts";

export class SqliteJobQueue implements JobQueue {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  enqueue(taskId: string): boolean {
    const id = newId();
    const result = this.#db
      .prepare(
        "INSERT INTO jobs(id, taskId, status) VALUES(?,?,'queued') ON CONFLICT DO NOTHING",
      )
      .run(id, taskId);
    return result.changes > 0;
  }

  claim(): ClaimedJob | undefined {
    const row = this.#db
      .prepare(
        `UPDATE jobs SET status='running'
         WHERE id = (SELECT id FROM jobs WHERE status='queued' ORDER BY id LIMIT 1)
         RETURNING id, taskId`,
      )
      .get() as { id: string; taskId: string } | undefined;
    return row;
  }
}
