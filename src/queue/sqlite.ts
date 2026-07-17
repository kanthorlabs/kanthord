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
         WHERE id = (
           SELECT j.id FROM jobs j
           JOIN tasks t ON j.taskId = t.id
           JOIN objectives o ON t.objectiveId = o.id
           JOIN initiatives i ON o.initiativeId = i.id
           WHERE j.status='queued' AND i.paused = 0
           ORDER BY j.id LIMIT 1
         )
         RETURNING id, taskId`,
      )
      .get() as { id: string; taskId: string } | undefined;
    return row;
  }

  finish(jobId: string, outcome: "completed" | "failed"): void {
    this.#db.prepare("UPDATE jobs SET status=? WHERE id=?").run(outcome, jobId);
  }

  discard(jobId: string): void {
    this.#db.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
  }

  listRunningJobs(): ClaimedJob[] {
    return this.#db
      .prepare(
        "SELECT id, taskId FROM jobs WHERE status='running' ORDER BY id ASC",
      )
      .all() as unknown as ClaimedJob[];
  }
}
