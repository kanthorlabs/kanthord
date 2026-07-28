/**
 * Job queue port.
 *
 * SQLITE_BUSY policy: `openDatabase` sets `busy_timeout=5000` so a writer
 * that hits a locked page waits up to 5 s before throwing SQLITE_BUSY.
 * Callers do NOT need to retry on busy; a timeout error propagates as an
 * ordinary thrown exception.
 *
 * Ordering: job ids are ULIDs (monotonically increasing). `claim()` picks
 * the smallest queued id — i.e. oldest-enqueued-first (FIFO).
 */

/** The lease token of a claimed run. It IS the `jobs` row id — no second identifier. */
export type LeaseToken = string;

export interface ClaimedJob {
  id: LeaseToken;
  taskId: string;
}

/** A `running` job row plus its revocation state. */
export interface RunningJob extends ClaimedJob {
  revoked: boolean;
  revokeReason: string | null;
}

export interface JobQueue {
  /**
   * Enqueue a job for the given task.
   * Returns `true` if a new queued row was created.
   * Returns `false` when the task already has a `queued` job (idempotent).
   */
  enqueue(taskId: string): boolean;

  /**
   * Atomically claim the oldest queued job, updating its status to `running`.
   * Skips jobs whose owning initiative is paused.
   * Returns the claimed job, or `undefined` when the queue is empty.
   */
  claim(): ClaimedJob | undefined;

  /**
   * Set the final status of a running job to `completed` or `failed`.
   * Throws `StaleLeaseError` when `jobId` does not name a `running`,
   * non-revoked job row.
   */
  finish(jobId: string, outcome: "completed" | "failed"): void;

  /**
   * Delete a job row entirely (used to discard a stale queued job).
   *
   * Deliberately not lease-guarded: it is keyed on `id`, so a write from one
   * lease can never touch another lease's row, and deleting a row that is
   * already gone is a no-op.
   */
  discard(jobId: string): void;

  /**
   * Return all jobs currently in `running` status.
   */
  listRunningJobs(): ClaimedJob[];

  /**
   * True when `leaseToken` names a job row that is still `running` and not
   * revoked — i.e. its run still owns the task.
   */
  isLeaseCurrent(leaseToken: LeaseToken): boolean;

  /** All `running` jobs for one task, with revocation state, ordered by id ASC. */
  listRunningJobsForTask(taskId: string): RunningJob[];

  /**
   * Revoke the lease of a `running` job, recording the operator's reason.
   * `"revoked"`         — this call revoked it.
   * `"already_revoked"` — it was already revoked; `reason` is NOT overwritten.
   * `"not_found"`       — no `running` job row with that id.
   */
  revoke(
    leaseToken: LeaseToken,
    reason: string,
  ): "revoked" | "already_revoked" | "not_found";
}

/** A write was attempted with a lease that is no longer current. */
export class StaleLeaseError extends Error {
  readonly leaseToken: string;

  constructor(leaseToken: string) {
    super(`lease ${leaseToken} is no longer current`);
    this.name = "StaleLeaseError";
    this.leaseToken = leaseToken;
  }
}
