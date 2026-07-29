import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import {
  transitionObjective,
  transitionInitiative,
} from "../../domain/initiative.ts";
import type { Objective, Initiative } from "../../domain/initiative.ts";
import { newEvent } from "../../domain/event.ts";
import {
  previewDiscard,
  type DiscardPreview,
  type ImpactTask,
  type ImpactObjective,
  type ImpactInitiative,
} from "../../domain/impact.ts";
import type { JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork, TaskResultRow } from "../../storage/port.ts";
import {
  UnknownReferenceError,
  TaskNotAwaitingConfirmationError,
  ImpactChangedError,
} from "../errors.ts";
// Story 3 (017) §A.3 — re-exported so existing imports of
// `ImpactChangedError` from this module keep resolving; the canonical class
// lives in `app/errors.ts`, shared with `RejectObjective`.
export { ImpactChangedError };

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
  listInitiativesByProject(projectId: string): Initiative[];
  getProjectId(initiativeId: string): string | undefined;
  listInitiativeAfter(initiativeId: string): string[];
  listObjectiveAfter(objectiveId: string): string[];
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

  /**
   * Story 3 (017) §A.5 — assembles the `ImpactInput` from read-only store
   * calls (this initiative's project, every initiative in that project, and
   * each one's objectives/tasks) and hands it to the pure `previewDiscard`.
   */
  #buildPreview(
    taskId: string,
    initiativeId: string | undefined,
  ): DiscardPreview {
    const projectId =
      initiativeId !== undefined
        ? this.#store.getProjectId(initiativeId)
        : undefined;
    const initiatives: Initiative[] =
      projectId !== undefined
        ? this.#store.listInitiativesByProject(projectId)
        : (() => {
            if (initiativeId === undefined) return [];
            const initiative = this.#store.getInitiative(initiativeId);
            return initiative !== undefined ? [initiative] : [];
          })();

    const objectives: ImpactObjective[] = [];
    const tasks: ImpactTask[] = [];
    for (const initiative of initiatives) {
      for (const objective of this.#store.listObjectives(initiative.id)) {
        objectives.push({
          id: objective.id,
          name: objective.name,
          initiativeId: objective.initiativeId,
          status: objective.status,
          after: this.#store.listObjectiveAfter(objective.id),
        });
      }
      for (const t of this.#store.listByInitiative(initiative.id)) {
        tasks.push({
          id: t.id,
          title: t.title,
          objectiveId: t.objectiveId,
          status: t.status,
          dependencies: t.dependencies,
        });
      }
    }

    const impactInitiatives: ImpactInitiative[] = initiatives.map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      after: this.#store.listInitiativeAfter(i.id),
    }));

    return previewDiscard({
      target: { type: "task", id: taskId },
      tasks,
      objectives,
      initiatives: impactInitiatives,
    });
  }

  async execute(input: {
    taskId: string;
    resolution: "retry" | "discard";
    reason?: string;
    dryRun?: boolean;
    expectImpact?: string;
  }): Promise<{ skipped: string[]; preview: DiscardPreview } | undefined> {
    const { taskId, resolution, reason, dryRun, expectImpact } = input;

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

    // Story 3 (017) — `dryRun`/`expectImpact` never apply to `retry` (§A.9);
    // its preview is always the empty one. `initiativeId` is read here, before
    // the transaction, since the preview needs it either way.
    const initiativeId = this.#store.getInitiativeId(taskId);
    const preview: DiscardPreview =
      resolution === "discard"
        ? this.#buildPreview(taskId, initiativeId)
        : previewDiscard({
            target: { type: "task", id: taskId },
            tasks: [],
            objectives: [],
            initiatives: [],
          });

    // (h-same) idempotent: same resolution already stored
    if (storedResolution === resolution) {
      return { skipped: [], preview };
    }

    // (h-conflict) different resolution already stored
    if (storedResolution !== null) {
      throw new RejectionConflictError(taskId, storedResolution, resolution);
    }

    if (resolution === "discard") {
      // §A.6 — `--dry-run` returns before the transaction: nothing is written.
      if (dryRun === true) {
        return { skipped: [], preview };
      }
      // §A.6 — the digest is checked once here, before the transaction, so a
      // stale `--expect-impact` never needs to enter it.
      if (expectImpact !== undefined && expectImpact !== preview.digest) {
        throw new ImpactChangedError(expectImpact, preview.digest);
      }
    }

    return this.#uow.transaction(() => {
      // §A.7 — in-transaction re-check against a freshly-read graph; throwing
      // here rolls back the transaction, so no transition or event persists.
      let effectivePreview = preview;
      if (resolution === "discard" && expectImpact !== undefined) {
        const fresh = this.#buildPreview(taskId, initiativeId);
        if (fresh.digest !== expectImpact) {
          throw new ImpactChangedError(expectImpact, fresh.digest);
        }
        effectivePreview = fresh;
      }

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
        return { skipped: [], preview: effectivePreview };
      }

      // discard
      const discardedTask = transitionTask(task, "discarded");
      this.#store.save(discardedTask);
      this.#feed.append(newEvent("task.discarded", { taskId }));

      const allTasks = initiativeId
        ? this.#store.listByInitiative(initiativeId)
        : [];

      // Story 3 (017) §A.8 — the discarded/skipped task ids are exactly the
      // preview's `discarded-by-cascade` / `left-blocked` task entries, so
      // preview and mutation cannot drift. The objective/initiative rollup
      // below is unchanged (its own ad-hoc statusOverride computation).
      const statusOverride = new Map<string, "discarded">([
        [taskId, "discarded"],
      ]);
      const tasksById = new Map(allTasks.map((t) => [t.id, t]));
      const discardedDependentIds = new Set(
        effectivePreview.damage
          .filter(
            (d) =>
              d.target.type === "task" && d.effect === "discarded-by-cascade",
          )
          .map((d) => d.target.id),
      );
      const skipped = effectivePreview.damage
        .filter((d) => d.effect === "left-blocked")
        .map((d) => d.target.id);
      for (const dependentId of discardedDependentIds) {
        const dependentTask = tasksById.get(dependentId);
        if (dependentTask === undefined) continue;
        const cascadedTask = transitionTask(dependentTask, "discarded");
        this.#store.save(cascadedTask);
        statusOverride.set(dependentId, "discarded");
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

      return { skipped, preview: effectivePreview };
    });
  }
}
