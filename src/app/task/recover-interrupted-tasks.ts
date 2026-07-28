import type { Task } from "../../domain/task.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import { requeueRunningTask } from "./requeue-running-task.ts";

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
        if (this.#store.get(job.taskId) === undefined) continue;
        requeueRunningTask(job, {
          store: this.#store,
          queue: this.#queue,
          feed: this.#feed,
        });
        recovered.push(job.taskId);
      }
    });
    return recovered;
  }
}
