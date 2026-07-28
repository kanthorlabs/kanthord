import type { DatabaseSync } from "node:sqlite";

import { newId } from "../domain/entity.ts";
import { StaleLeaseError } from "./port.ts";
import type { ClaimedJob, JobQueue, RunningJob } from "./port.ts";

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
             AND NOT EXISTS (
               SELECT 1 FROM jobs rj
               JOIN tasks rt ON rj.taskId = rt.id
               JOIN objectives ro ON rt.objectiveId = ro.id
               WHERE rj.status='running' AND ro.initiativeId = i.id
             )
           ORDER BY j.id LIMIT 1
         )
         RETURNING id, taskId`,
      )
      .get() as { id: string; taskId: string } | undefined;
    return row;
  }

  finish(jobId: string, outcome: "completed" | "failed"): void {
    // Story 013-2 — lease-guarded write. Only a `running`, non-revoked row
    // counts as a current lease; anything else is a stale-lease write and must
    // throw so the caller's transaction rolls back / the per-branch guard
    // surfaces the violation.
    const result = this.#db
      .prepare(
        "UPDATE jobs SET status=? WHERE id=? AND status='running' AND revoked=0",
      )
      .run(outcome, jobId);
    if (result.changes === 0) throw new StaleLeaseError(jobId);
  }

  discard(jobId: string): void {
    // Story 013-2 — `discard` is deliberately NOT lease-guarded. It is keyed
    // on `id` and removes only a queue row, so a write from lease A can never
    // touch lease B's row; the fence that matters is on `finish`. Story 4's
    // `requeueRunningTask` and `RecoverInterruptedTasks` also rely on being
    // able to clean up a revoked row.
    this.#db.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
  }

  listRunningJobs(): ClaimedJob[] {
    return this.#db
      .prepare(
        "SELECT id, taskId FROM jobs WHERE status='running' ORDER BY id ASC",
      )
      .all() as unknown as ClaimedJob[];
  }

  isLeaseCurrent(leaseToken: string): boolean {
    const row = this.#db
      .prepare(
        "SELECT 1 AS ok FROM jobs WHERE id=? AND status='running' AND revoked=0",
      )
      .get(leaseToken) as { ok: number } | undefined;
    return row !== undefined;
  }

  listRunningJobsForTask(taskId: string): RunningJob[] {
    const rows = this.#db
      .prepare(
        "SELECT id, taskId, revoked, revokeReason FROM jobs" +
          " WHERE taskId=? AND status='running' ORDER BY id ASC",
      )
      .all(taskId) as unknown as Array<{
      id: string;
      taskId: string;
      revoked: number;
      revokeReason: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      revoked: r.revoked === 1,
      revokeReason: r.revokeReason,
    }));
  }

  // EPIC 013 Story 3 — lease revocation. A successful revoke flips the row to
  // `revoked=1` with the operator's reason; the row keeps `status='running'`
  // so the per-initiative `NOT EXISTS` guard in `claim()` continues to block
  // a new live run against the same initiative while the revoked run drains.
  // A second call is idempotent — it does NOT overwrite the first reason.
  revoke(
    leaseToken: string,
    reason: string,
  ): "revoked" | "already_revoked" | "not_found" {
    const updated = this.#db
      .prepare(
        "UPDATE jobs SET revoked=1, revokeReason=?" +
          " WHERE id=? AND status='running' AND revoked=0",
      )
      .run(reason, leaseToken);
    if (updated.changes > 0) return "revoked";
    const row = this.#db
      .prepare("SELECT revoked FROM jobs WHERE id=? AND status='running'")
      .get(leaseToken) as { revoked: number } | undefined;
    if (row === undefined) return "not_found";
    return "already_revoked";
  }
}
