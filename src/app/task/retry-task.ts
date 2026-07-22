import type { Task, TaskStatus } from "../../domain/task.ts";
import { transitionTask } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { ChangeCandidate, CandidateState } from "../../domain/landing.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";

export class TaskNotRetryableError extends Error {
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus) {
    super(`task ${taskId} is not retryable (status: ${status})`);
    this.name = "TaskNotRetryableError";
    this.taskId = taskId;
    this.status = status;
  }
}

interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

interface KindResolver {
  resolveKind(id: string): string | undefined;
}

export interface ConflictCandidateStore {
  getCandidateByTask(taskId: string): ChangeCandidate | undefined;
  updateCandidateState(id: string, state: CandidateState): void;
  /** Optional: durably snapshot conflict metadata onto the recovery attempt. */
  saveConflictSnapshot?(
    taskId: string,
    snapshot: {
      candidateOID: string;
      targetOID: string;
      conflictContext: string;
    },
  ): void;
}

export class RetryTask {
  readonly #store: TaskStore;
  readonly #queue: JobQueue;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;
  readonly #resolver: KindResolver;
  readonly #candidateStore: ConflictCandidateStore | undefined;

  constructor(
    store: TaskStore,
    queue: JobQueue,
    feed: EventFeed,
    uow: UnitOfWork,
    resolver: KindResolver,
    candidateStore?: ConflictCandidateStore,
  ) {
    this.#store = store;
    this.#queue = queue;
    this.#feed = feed;
    this.#uow = uow;
    this.#resolver = resolver;
    this.#candidateStore = candidateStore;
  }

  async execute(input: {
    taskId: string;
    note?: string;
    rebuild?: boolean;
  }): Promise<void> {
    const { taskId, note, rebuild } = input;

    const kind = this.#resolver.resolveKind(taskId);
    if (kind === undefined) {
      throw new UnknownReferenceError("task", taskId);
    }
    if (kind !== "task") {
      throw new WrongTypeReferenceError("task", kind, taskId);
    }

    const task = this.#store.get(taskId);
    if (task === undefined) {
      throw new UnknownReferenceError("task", taskId);
    }

    if (task.status === "awaiting_confirmation") {
      const candidate = this.#candidateStore?.getCandidateByTask(taskId);
      const isConflict = candidate?.state === "conflict";
      const isRebuild = rebuild === true && candidate?.state === "pending";
      if (!isConflict && !isRebuild) {
        throw new TaskNotRetryableError(taskId, task.status);
      }
      const candidateId = candidate!.id;
      this.#uow.transaction(() => {
        this.#candidateStore!.updateCandidateState(candidateId, "pending");
        const updated = transitionTask(task, "pending");
        // Persist optional guidance note so it surfaces on get task --json
        // and is readable by the prompt hook (getPriorFeedback).
        const taskToSave = { ...updated, note: note ?? undefined };
        this.#store.save(taskToSave);
        if (isConflict) {
          // Durably snapshot conflict context for deterministic rebuild prompt.
          const candidateOID = candidate!.candidateSHA;
          const targetOID =
            typeof candidate!["targetOID"] === "string"
              ? candidate!["targetOID"]
              : "";
          const conflictContext =
            typeof candidate!["conflictContext"] === "string"
              ? candidate!["conflictContext"]
              : "";
          this.#candidateStore?.saveConflictSnapshot?.(taskId, {
            candidateOID,
            targetOID,
            conflictContext,
          });
        }
        const enqueued = this.#queue.enqueue(taskId);
        if (enqueued) {
          this.#feed.append(newEvent("task.ready", { taskId }));
        }
      });
      return;
    }

    if (task.status !== "failed") {
      throw new TaskNotRetryableError(taskId, task.status);
    }

    this.#uow.transaction(() => {
      const updated = transitionTask(task, "pending");
      this.#store.save(updated);
      const enqueued = this.#queue.enqueue(taskId);
      if (enqueued) {
        this.#feed.append(newEvent("task.ready", { taskId }));
      }
    });
  }
}
