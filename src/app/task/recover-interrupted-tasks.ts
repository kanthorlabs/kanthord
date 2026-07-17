import type { Task } from "../../domain/task.ts";
import { transitionTask } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";

interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

export class RecoverInterruptedTasks {
  readonly #queue: JobQueue;
  readonly #store: TaskStore;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;

  constructor(
    queue: JobQueue,
    store: TaskStore,
    feed: EventFeed,
    uow: UnitOfWork,
  ) {
    this.#queue = queue;
    this.#store = store;
    this.#feed = feed;
    this.#uow = uow;
  }

  execute(): string[] {
    const recovered: string[] = [];
    this.#uow.transaction(() => {
      const runningJobs = this.#queue.listRunningJobs();
      for (const job of runningJobs) {
        const task = this.#store.get(job.taskId);
        if (task === undefined) continue;
        const pending = transitionTask(task, "pending");
        this.#store.save(pending);
        this.#queue.discard(job.id);
        const inserted = this.#queue.enqueue(job.taskId);
        if (inserted) {
          this.#feed.append(newEvent("task.ready", { taskId: job.taskId }));
        }
        recovered.push(job.taskId);
      }
    });
    return recovered;
  }
}
