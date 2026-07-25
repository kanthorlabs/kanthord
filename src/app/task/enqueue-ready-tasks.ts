import type { Task } from "../../domain/task.ts";
import { readiness } from "../../domain/graph.ts";
import { newEvent } from "../../domain/event.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type {
  InitiativeStatus,
  ObjectiveStatus,
} from "../../domain/initiative.ts";
import {
  unsatisfiedInitiativeEdges,
  unsatisfiedObjectiveEdges,
} from "../../domain/sequencing.ts";

interface InitiativeSource {
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
  get?(id: string): { status?: InitiativeStatus } | undefined;
  getObjective?(id: string): { status?: ObjectiveStatus } | undefined;
}

export interface SequencingSource {
  listInitiativeAfter(initiativeId: string): string[];
  listObjectiveAfter(objectiveId: string): string[];
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
  readonly #sequencing?: SequencingSource;

  constructor(
    initSrc: InitiativeSource,
    taskSrc: TaskSource,
    queue: JobQueue,
    feed: EventFeed,
    uow: UnitOfWork,
    sequencing?: SequencingSource,
  ) {
    this.#initSrc = initSrc;
    this.#taskSrc = taskSrc;
    this.#queue = queue;
    this.#feed = feed;
    this.#uow = uow;
    this.#sequencing = sequencing;
  }

  async execute(): Promise<string[]> {
    const enqueued: string[] = [];
    this.#uow.transaction(() => {
      const initiatives = this.#initSrc.listAllInitiatives();
      for (const initiative of initiatives) {
        if (initiative.paused) continue;

        // Initiative-level gate: skip if any after edge is unsatisfied
        const after = this.#sequencing?.listInitiativeAfter(initiative.id);
        if (after !== undefined && after.length > 0) {
          const deps = after.map((depId) => ({
            id: depId,
            status: this.#initSrc.get?.(depId)?.status,
          }));
          if (unsatisfiedInitiativeEdges(deps).length > 0) continue;
        }

        const tasks = this.#taskSrc.listByInitiative(initiative.id);
        const entries = readiness(tasks);
        for (const entry of entries) {
          if (entry.state !== "ready") continue;

          // Objective-level gate: skip task if its objective's after edges are unsatisfied
          const task = tasks.find((t) => t.id === entry.id);
          if (
            task !== undefined &&
            task.objectiveId &&
            this.#sequencing !== undefined
          ) {
            const objAfter = this.#sequencing.listObjectiveAfter(
              task.objectiveId,
            );
            if (objAfter.length > 0) {
              const objDeps = objAfter.map((depId) => ({
                id: depId,
                status: this.#initSrc.getObjective?.(depId)?.status,
              }));
              if (unsatisfiedObjectiveEdges(objDeps).length > 0) continue;
            }
          }

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
