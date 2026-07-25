import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import { dependentClosure } from "../../domain/graph.ts";
import {
  transitionObjective,
  transitionInitiative,
} from "../../domain/initiative.ts";
import type { Objective, Initiative } from "../../domain/initiative.ts";
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
  getObjective(objectiveId: string): Objective | undefined;
  saveObjective(objective: Objective): void;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveInitiative(initiative: Initiative): void;
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
  }): Promise<{ skipped: string[] } | undefined> {
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

    // (c) wrong status — `failed` is only accepted for `discard` (Story 05 §6);
    // `retry` from `failed` is `retry task`'s job, not this one's.
    if (
      task.status !== "awaiting_confirmation" &&
      !(task.status === "failed" && resolution === "discard")
    ) {
      throw new TaskNotAwaitingConfirmationError(taskId, task.status);
    }

    const storedResolution = result?.rejectionResolution ?? null;

    // (h-same) idempotent: same resolution already stored
    if (storedResolution === resolution) {
      return { skipped: [] };
    }

    // (h-conflict) different resolution already stored
    if (storedResolution !== null) {
      throw new RejectionConflictError(taskId, storedResolution, resolution);
    }

    return this.#uow.transaction(() => {
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
        return { skipped: [] };
      }

      // discard
      const discardedTask = transitionTask(task, "discarded");
      this.#store.save(discardedTask);
      this.#feed.append(newEvent("task.discarded", { taskId }));

      const initiativeId = this.#store.getInitiativeId(taskId);
      const allTasks = initiativeId
        ? this.#store.listByInitiative(initiativeId)
        : [];

      // Cascade: discard the transitive dependent closure, restricted to
      // `pending` tasks; every other status is skipped and reported. Computed
      // first so the task.blocked emission below can tell which direct
      // dependents survive as merely "blocked" versus which are discarded.
      const statusOverride = new Map<string, "discarded">([
        [taskId, "discarded"],
      ]);
      const skipped: string[] = [];
      const dependentIds = dependentClosure(allTasks, taskId);
      const tasksById = new Map(allTasks.map((t) => [t.id, t]));
      const discardedDependentIds = new Set<string>();
      for (const dependentId of dependentIds) {
        const dependentTask = tasksById.get(dependentId);
        if (dependentTask === undefined) continue;
        if (dependentTask.status !== "pending") {
          skipped.push(dependentId);
          continue;
        }
        const cascadedTask = transitionTask(dependentTask, "discarded");
        this.#store.save(cascadedTask);
        statusOverride.set(dependentId, "discarded");
        discardedDependentIds.add(dependentId);
        this.#feed.append(
          newEvent("task.discarded", {
            taskId: dependentId,
            payload: { reason: "cascade", origin: taskId },
          }),
        );
      }

      // Emit task.blocked for each direct dependent the cascade did not
      // discard (the ones reported as skipped) — a dependent the cascade
      // discards in this same transaction is never announced as blocked.
      for (const t of allTasks) {
        if (
          t.dependencies.includes(taskId) &&
          !discardedDependentIds.has(t.id)
        ) {
          this.#feed.append(
            newEvent("task.blocked", {
              taskId: t.id,
              payload: { dependencyId: taskId },
            }),
          );
        }
      }

      // Objective + initiative rollup (contract §4/§5).
      const currentStatus = (t: Task): string =>
        statusOverride.get(t.id) ?? t.status;
      const touchedObjectiveIds = new Set<string>([task.objectiveId]);
      for (const id of statusOverride.keys()) {
        const t = tasksById.get(id);
        if (t !== undefined) touchedObjectiveIds.add(t.objectiveId);
      }
      for (const objectiveId of touchedObjectiveIds) {
        const objective = this.#store.getObjective(objectiveId);
        if (objective === undefined || objective.status === "discarded") {
          continue;
        }
        const objectiveTasks = allTasks.filter(
          (t) => t.objectiveId === objectiveId,
        );
        const allTerminal = objectiveTasks.every((t) => {
          const s = currentStatus(t);
          return s === "completed" || s === "discarded";
        });
        const anyDiscarded = objectiveTasks.some(
          (t) => currentStatus(t) === "discarded",
        );
        if (allTerminal && anyDiscarded) {
          const updatedObjective = transitionObjective(objective, "discarded");
          this.#store.saveObjective(updatedObjective);
          this.#feed.append(
            newEvent("objective.discarded", {
              objectiveId,
              ...(reason !== undefined ? { payload: { reason } } : {}),
            }),
          );
        }
      }

      if (initiativeId !== undefined) {
        const initiative = this.#store.getInitiative(initiativeId);
        if (initiative !== undefined && initiative.status !== "discarded") {
          const siblings = this.#store.listObjectives(initiativeId);
          const allObjectivesTerminal = siblings.every(
            (o) => o.status === "integrated" || o.status === "discarded",
          );
          const anyObjectiveDiscarded = siblings.some(
            (o) => o.status === "discarded",
          );
          if (allObjectivesTerminal && anyObjectiveDiscarded) {
            const updatedInitiative = transitionInitiative(
              initiative,
              "discarded",
            );
            this.#store.saveInitiative(updatedInitiative);
            this.#feed.append(
              newEvent("initiative.discarded", { initiativeId }),
            );
          }
        }
      }

      return { skipped };
    });
  }
}
