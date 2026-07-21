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

  async execute(input: { taskId: string }): Promise<void> {
    const { taskId } = input;

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
      if (candidate?.state !== "conflict") {
        throw new TaskNotRetryableError(taskId, task.status);
      }
      const conflictCandidateId = candidate.id;
      this.#uow.transaction(() => {
        this.#candidateStore!.updateCandidateState(
          conflictCandidateId,
          "pending",
        );
        const updated = transitionTask(task, "pending");
        this.#store.save(updated);
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
