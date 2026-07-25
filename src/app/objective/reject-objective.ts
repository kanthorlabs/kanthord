import type { Objective, Initiative } from "../../domain/initiative.ts";
import {
  transitionObjective,
  transitionInitiative,
} from "../../domain/initiative.ts";
import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import {
  UnknownReferenceError,
  ObjectiveNotAwaitingConfirmationError,
} from "../errors.ts";

interface RejectObjectiveStore {
  getObjective(id: string): Objective | undefined;
  saveObjective(objective: Objective): void;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveInitiative(initiative: Initiative): void;
  listTasksByObjective(objectiveId: string): Task[];
  saveTask(task: Task): void;
}

const DISCARD_ALLOWED_FROM = new Set([
  "building",
  "awaiting_confirmation",
  "conflict",
]);

export class RejectObjective {
  readonly #store: RejectObjectiveStore;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;

  constructor(store: RejectObjectiveStore, feed: EventFeed, uow: UnitOfWork) {
    this.#store = store;
    this.#feed = feed;
    this.#uow = uow;
  }

  async execute(input: {
    objectiveId: string;
    reason?: string;
  }): Promise<void> {
    const { objectiveId, reason } = input;

    const objective = this.#store.getObjective(objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", objectiveId);
    }
    const status = objective.status ?? "building";

    if (!DISCARD_ALLOWED_FROM.has(status)) {
      throw new ObjectiveNotAwaitingConfirmationError(objectiveId, status);
    }

    this.#uow.transaction(() => {
      const tasks = this.#store.listTasksByObjective(objectiveId);
      for (const task of tasks) {
        if (task.status === "pending" || task.status === "failed") {
          const discardedTask = transitionTask(task, "discarded");
          this.#store.saveTask(discardedTask);
          this.#feed.append(
            newEvent("task.discarded", {
              taskId: task.id,
              payload: { reason: "cascade", origin: objectiveId },
            }),
          );
        }
      }

      const updatedObjective = transitionObjective(objective, "discarded");
      this.#store.saveObjective(updatedObjective);
      this.#feed.append(
        newEvent("objective.discarded", {
          objectiveId,
          ...(reason !== undefined ? { payload: { reason } } : {}),
        }),
      );

      const initiative = this.#store.getInitiative(objective.initiativeId);
      if (initiative !== undefined && initiative.status !== "discarded") {
        const siblings = this.#store.listObjectives(objective.initiativeId);
        const allTerminal = siblings.every(
          (o) => o.status === "integrated" || o.status === "discarded",
        );
        const anyDiscarded = siblings.some((o) => o.status === "discarded");
        if (allTerminal && anyDiscarded) {
          const updatedInitiative = transitionInitiative(
            initiative,
            "discarded",
          );
          this.#store.saveInitiative(updatedInitiative);
          this.#feed.append(
            newEvent("initiative.discarded", {
              initiativeId: objective.initiativeId,
            }),
          );
        }
      }
    });
  }
}
