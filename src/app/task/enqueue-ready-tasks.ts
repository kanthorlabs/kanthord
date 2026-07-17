import type { Task } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";

interface InitiativeSource {
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
}

interface TaskSource {
  listByInitiative(initiativeId: string): Task[];
}

export class EnqueueReadyTasks {
  readonly #initSrc: InitiativeSource;
  readonly #taskSrc: TaskSource;
  readonly #queue: JobQueue;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;

  constructor(
    initSrc: InitiativeSource,
    taskSrc: TaskSource,
    queue: JobQueue,
    feed: EventFeed,
    uow: UnitOfWork,
  ) {
    this.#initSrc = initSrc;
    this.#taskSrc = taskSrc;
    this.#queue = queue;
    this.#feed = feed;
    this.#uow = uow;
  }

  async execute(): Promise<string[]> {
    const enqueued: string[] = [];
    this.#uow.transaction(() => {
      const initiatives = this.#initSrc.listAllInitiatives();
      for (const initiative of initiatives) {
        if (initiative.paused) continue;
        const tasks = this.#taskSrc.listByInitiative(initiative.id);
        const entries = readiness(tasks);
        for (const entry of entries) {
          if (entry.state !== "ready") continue;
          const inserted = this.#queue.enqueue(entry.id);
          if (inserted) {
            this.#feed.append(newEvent("task.ready", { taskId: entry.id }));
            enqueued.push(entry.id);
          }
        }
      }
    });
    return enqueued;
  }
}
