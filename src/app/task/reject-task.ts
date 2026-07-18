import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork, TaskResultRow } from "../../storage/port.ts";
import {
  UnknownReferenceError,
  TaskNotAwaitingConfirmationError,
} from "../errors.ts";

export class RejectionConflictError extends Error {
  readonly taskId: string;
  readonly stored: string;
  readonly requested: string;

  constructor(taskId: string, stored: string, requested: string) {
    super(
      `rejection conflict for task ${taskId}: stored=${stored}, requested=${requested}`,
    );
    this.name = "RejectionConflictError";
    this.taskId = taskId;
    this.stored = stored;
    this.requested = requested;
  }
}

interface RejectTaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  getTaskResult(taskId: string): TaskResultRow | undefined;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
}

export class RejectTask {
  readonly #store: RejectTaskStore;
  readonly #queue: JobQueue;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;

  constructor(
    store: RejectTaskStore,
    queue: JobQueue,
    feed: EventFeed,
    uow: UnitOfWork,
  ) {
    this.#store = store;
    this.#queue = queue;
    this.#feed = feed;
    this.#uow = uow;
  }

  async execute(input: {
    taskId: string;
    resolution: "retry" | "discard";
    reason?: string;
  }): Promise<void> {
    const { taskId, resolution, reason } = input;

    const task = this.#store.get(taskId);
    if (task === undefined) {
      throw new UnknownReferenceError("task", taskId);
    }

    const result = this.#store.getTaskResult(taskId);

    // (h-after-approve) completed task → conflict with "approved" decision
    if (task.status === "completed") {
      throw new RejectionConflictError(taskId, "approved", resolution);
    }

    // (c) wrong status
    if (task.status !== "awaiting_confirmation") {
      throw new TaskNotAwaitingConfirmationError(taskId, task.status);
    }

    const storedResolution = result?.rejectionResolution ?? null;

    // (h-same) idempotent: same resolution already stored
    if (storedResolution === resolution) {
      return;
    }

    // (h-conflict) different resolution already stored
    if (storedResolution !== null) {
      throw new RejectionConflictError(taskId, storedResolution, resolution);
    }

    this.#uow.transaction(() => {
      // Persist decision into result row
      const updatedResult: TaskResultRow =
        result !== undefined
          ? {
              ...result,
              rejectionResolution: resolution,
              rejectionReason: reason ?? null,
            }
          : {
              workspace: null,
              branch: null,
              baseCommit: null,
              proposalCommit: null,
              commitSha: null,
              summary: null,
              reason: null,
              rejectionResolution: resolution,
              rejectionReason: reason ?? null,
              evidence: null,
            };
      this.#store.saveTaskResult(taskId, updatedResult);

      // Emit task.rejected
      const rejectedPayload: Record<string, string> = {
        code: "REJECTED_BY_ACTOR",
        resolution,
        actor: "human",
      };
      if (reason !== undefined) {
        rejectedPayload["message"] = reason;
      }
      if (
        result?.proposalCommit !== null &&
        result?.proposalCommit !== undefined
      ) {
        rejectedPayload["proposalCommit"] = result.proposalCommit;
      }
      this.#feed.append(
        newEvent("task.rejected", { taskId, payload: rejectedPayload }),
      );

      if (resolution === "retry") {
        const pendingTask = transitionTask(task, "pending");
        this.#store.save(pendingTask);
      } else {
        // discard
        const discardedTask = transitionTask(task, "discarded");
        this.#store.save(discardedTask);
        this.#feed.append(newEvent("task.discarded", { taskId }));

        // Emit task.blocked for each direct dependent
        const initiativeId = this.#store.getInitiativeId(taskId);
        const allTasks = initiativeId
          ? this.#store.listByInitiative(initiativeId)
          : [];
        for (const t of allTasks) {
          if (t.dependencies.includes(taskId)) {
            this.#feed.append(
              newEvent("task.blocked", {
                taskId: t.id,
                payload: { dependencyId: taskId },
              }),
            );
          }
        }
      }
    });
  }
}
