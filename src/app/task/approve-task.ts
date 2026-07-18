import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork, TaskResultRow } from "../../storage/port.ts";
import {
  UnknownReferenceError,
  TaskNotAwaitingConfirmationError,
  ProposalWorkspaceMissingError,
} from "../errors.ts";

// Re-export so existing importers (tests, CLI error-map) keep working.
export { TaskNotAwaitingConfirmationError } from "../errors.ts";

export class ProposalMissingError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`proposal commit for task ${taskId} is missing or unreachable`);
    this.name = "ProposalMissingError";
    this.taskId = taskId;
  }
}

interface ApproveTaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  getTaskResult(taskId: string): TaskResultRow | undefined;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
}

export class ApproveTask {
  readonly #store: ApproveTaskStore;
  readonly #queue: JobQueue;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;
  readonly #promote: (
    dir: string,
    taskId: string,
    proposalCommit: string,
  ) => Promise<void>;

  constructor(
    store: ApproveTaskStore,
    queue: JobQueue,
    feed: EventFeed,
    uow: UnitOfWork,
    promote: (
      dir: string,
      taskId: string,
      proposalCommit: string,
    ) => Promise<void>,
  ) {
    this.#store = store;
    this.#queue = queue;
    this.#feed = feed;
    this.#uow = uow;
    this.#promote = promote;
  }

  async execute({ taskId }: { taskId: string }): Promise<void> {
    const task = this.#store.get(taskId);
    if (task === undefined) {
      throw new UnknownReferenceError("task", taskId);
    }

    const result = this.#store.getTaskResult(taskId);

    // (b) idempotent: already completed and commitSha matches proposalCommit
    if (
      task.status === "completed" &&
      result !== undefined &&
      result.commitSha !== null &&
      result.commitSha === result.proposalCommit
    ) {
      return;
    }

    // (c) wrong status
    if (task.status !== "awaiting_confirmation") {
      throw new TaskNotAwaitingConfirmationError(taskId, task.status);
    }

    // Promote the task branch to point at the proposal commit (d)/(a)
    if (result !== undefined && result.proposalCommit !== null) {
      if (result.workspace === null || result.workspace === "") {
        throw new ProposalWorkspaceMissingError(taskId);
      }
      try {
        await this.#promote(result.workspace, taskId, result.proposalCommit);
      } catch {
        throw new ProposalMissingError(taskId);
      }
    }

    // Determine the final commitSha (null if no proposalCommit)
    const commitSha = result?.proposalCommit ?? null;

    this.#uow.transaction(() => {
      // Persist the updated result row with commitSha set
      if (result !== undefined) {
        this.#store.saveTaskResult(taskId, { ...result, commitSha });
      }

      const completedTask = transitionTask(task, "completed");
      this.#store.save(completedTask);

      const approvedPayload: Record<string, string> = { actor: "human" };
      if (commitSha !== null) {
        approvedPayload["proposalCommit"] = commitSha;
      }
      this.#feed.append(
        newEvent("task.approved", { taskId, payload: approvedPayload }),
      );
      this.#feed.append(newEvent("task.completed", { taskId }));

      // Re-scan initiative for newly-ready dependents
      const initiativeId = this.#store.getInitiativeId(taskId);
      const allTasks = initiativeId
        ? this.#store.listByInitiative(initiativeId)
        : [];
      for (const entry of readiness(allTasks)) {
        if (entry.state === "ready") {
          const inserted = this.#queue.enqueue(entry.id);
          if (inserted) {
            this.#feed.append(newEvent("task.ready", { taskId: entry.id }));
          }
        }
      }
    });
  }
}
