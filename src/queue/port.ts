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

export interface ClaimedJob {
  id: string;
  taskId: string;
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
   */
  finish(jobId: string, outcome: "completed" | "failed"): void;

  /**
   * Delete a job row entirely (used to discard a stale queued job).
   */
  discard(jobId: string): void;

  /**
   * Return all jobs currently in `running` status.
   */
  listRunningJobs(): ClaimedJob[];
}
