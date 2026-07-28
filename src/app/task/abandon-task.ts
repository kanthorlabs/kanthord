import type { Task, TaskStatus } from "../../domain/task.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { JobQueue } from "../../queue/port.ts";

/**
 * EPIC 013 Story 3 — `abandon task` use case.
 *
 * Operator-driven revocation: flips the lease row to `revoked=1` with the
 * reason, leaving the job row in `status='running'` so the per-initiative
 * `NOT EXISTS` guard in `claim()` keeps blocking a new live run against the
 * same initiative while the old run drains. The runner observes the
 * revocation at the next `beforeToolCall` boundary and exits without
 * starting another tool call. Story 4 wires the requeue + `task.abandoned`
 * event on top of this.
 */
export class TaskNotAbandonableError extends Error {
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus) {
    super(`task ${taskId} is not abandonable (status: ${status})`);
    this.name = "TaskNotAbandonableError";
    this.taskId = taskId;
    this.status = status;
  }
}

export class NoRunningJobError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`task ${taskId} has no running job to abandon`);
    this.name = "NoRunningJobError";
    this.taskId = taskId;
  }
}

export class AmbiguousRunningJobError extends Error {
  readonly taskId: string;
  readonly count: number;

  constructor(taskId: string, count: number) {
    super(
      `task ${taskId} has ${count} running jobs; refusing to guess which to abandon`,
    );
    this.name = "AmbiguousRunningJobError";
    this.taskId = taskId;
    this.count = count;
  }
}

export type AbandonOutcome =
  | { outcome: "abandoning"; taskId: string }
  | { outcome: "already_abandoning"; taskId: string };

interface TaskStore {
  get(id: string): Task | undefined;
}

export class AbandonTask {
  readonly #store: TaskStore;
  readonly #queue: JobQueue;
  readonly #uow: { transaction<T>(fn: () => T): T };

  constructor(
    store: TaskStore,
    queue: JobQueue,
    uow: { transaction<T>(fn: () => T): T },
  ) {
    this.#store = store;
    this.#queue = queue;
    this.#uow = uow;
  }

  /**
   * Revoke a `running` task's lease. The 7-step order is the Story 3 spec:
   *   1. Look up the task; unknown → `UnknownReferenceError`.
   *   2. Status guard; non-`running` → `TaskNotAbandonableError` (message
   *      names the actual status).
   *   3. List running jobs for the task.
   *   4. Zero jobs → `NoRunningJobError`.
   *   5. More than one job → `AmbiguousRunningJobError` (refuse, never guess;
   *      no revoke called).
   *   6. The one running job is already revoked → `already_abandoning`
   *      (no revoke called, idempotent).
   *   7. Exactly one non-revoked job → revoke it, return `abandoning`. The
   *      revoke result must be `"revoked"`; anything else contradicts the
   *      step 3 read inside the same transaction and is thrown, not mapped.
   *
   * The whole body runs inside exactly one `uow.transaction` so a partial
   * read-then-write cannot leak an un-revoked run that the operator was
   * told was revoked.
   */
  execute(input: { taskId: string; reason: string }): AbandonOutcome {
    const { taskId, reason } = input;
    return this.#uow.transaction((): AbandonOutcome => {
      // 1. Look up the task.
      const task = this.#store.get(taskId);
      if (task === undefined) {
        throw new UnknownReferenceError("task", taskId);
      }

      // 2. Status guard — only `running` tasks are abandonable.
      if (task.status !== "running") {
        throw new TaskNotAbandonableError(taskId, task.status);
      }

      // 3. List running jobs for the task.
      const jobs = this.#queue.listRunningJobsForTask(taskId);

      // 4. No running job row → typed error.
      if (jobs.length === 0) {
        throw new NoRunningJobError(taskId);
      }

      // 5. More than one running job → refuse, never guess.
      if (jobs.length > 1) {
        throw new AmbiguousRunningJobError(taskId, jobs.length);
      }

      const job = jobs[0]!;

      // 6. Already revoked → idempotent no-op.
      if (job.revoked) {
        return { outcome: "already_abandoning", taskId };
      }

      // 7. Exactly one non-revoked job → revoke it. Step 3 read this row as
      // non-revoked and still `running` inside this same `BEGIN IMMEDIATE`
      // transaction, so `"revoked"` is the only result that can follow. Any
      // other discriminant means the read and the write disagree — broken
      // isolation or a mismatched adapter — so fail loudly and roll back
      // rather than report an outcome the operator would read as ordinary.
      const revokeResult = this.#queue.revoke(job.id, reason);
      if (revokeResult !== "revoked") {
        throw new Error(
          `revoke invariant violated for task ${taskId}, job ${job.id}: ` +
            `read a non-revoked running lease but revoke returned "${revokeResult}"`,
        );
      }
      return { outcome: "abandoning", taskId };
    });
  }
}
