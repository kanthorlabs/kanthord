import type { Objective, Initiative } from "../../domain/initiative.ts";
import {
  transitionObjective,
  transitionInitiative,
  assertCandidateFresh,
} from "../../domain/initiative.ts";
import { transitionTask } from "../../domain/task.ts";
import type { Task } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import {
  previewDiscard,
  type DiscardPreview,
  type ImpactTask,
  type ImpactObjective,
  type ImpactInitiative,
} from "../../domain/impact.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import {
  UnknownReferenceError,
  ObjectiveNotAwaitingConfirmationError,
  ImpactChangedError,
} from "../errors.ts";
// Story 3 (017) §B — `ImpactChangedError` is the confirm protocol's
// stale-impact guard, shared with `RejectTask` via `app/errors.ts` so
// `error-map.ts` catches both use cases' stale-impact rejections through one
// `instanceof` check. Re-exported so existing imports of `ImpactChangedError`
// from this module keep resolving.
export { ImpactChangedError };

interface RejectObjectiveStore {
  getObjective(id: string): Objective | undefined;
  saveObjective(objective: Objective): void;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveInitiative(initiative: Initiative): void;
  listTasksByObjective(objectiveId: string): Task[];
  saveTask(task: Task): void;
  listObjectiveAfter(objectiveId: string): string[];
  listInitiativeAfter(initiativeId: string): string[];
  listInitiatives(projectId: string): Initiative[];
  getProjectId(initiativeId: string): string | undefined;
  listTasksByInitiative(initiativeId: string): Task[];
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

  /**
   * Story 3 (017) §B.1 — assembles the `ImpactInput` from read-only store
   * calls (this initiative's project, every initiative in that project, and
   * each one's objectives/tasks) and hands it to the pure `previewDiscard`,
   * mirroring `RejectTask#buildPreview`.
   */
  #buildPreview(objectiveId: string, initiativeId: string): DiscardPreview {
    const projectId = this.#store.getProjectId(initiativeId);
    const initiatives: Initiative[] =
      projectId !== undefined
        ? this.#store.listInitiatives(projectId)
        : (() => {
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
      for (const t of this.#store.listTasksByInitiative(initiative.id)) {
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
      target: { type: "objective", id: objectiveId },
      tasks,
      objectives,
      initiatives: impactInitiatives,
    });
  }

  async execute(input: {
    objectiveId: string;
    reason?: string;
    expectedCommit: string;
    dryRun?: boolean;
    expectImpact?: string;
  }): Promise<{ preview: DiscardPreview }> {
    const { objectiveId, reason, expectedCommit, dryRun, expectImpact } = input;

    const objective = this.#store.getObjective(objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", objectiveId);
    }
    const status = objective.status ?? "building";

    if (!DISCARD_ALLOWED_FROM.has(status)) {
      throw new ObjectiveNotAwaitingConfirmationError(objectiveId, status);
    }

    // Story 4 (012) — early guard after the status guard. A stale verdict on
    // a discardable objective is refused before the cascade loop touches any
    // task, and before Story 3's preview is built at all.
    assertCandidateFresh(objectiveId, expectedCommit, objective.commitOid);

    // Story 3 (017) §B.4 — the preview is built once, after the 012 guard.
    const preview = this.#buildPreview(objectiveId, objective.initiativeId);

    // §B — `--dry-run` returns before the transaction: nothing is written.
    if (dryRun === true) {
      return { preview };
    }
    // The digest is checked once here, before the transaction, so a stale
    // `--expect-impact` never needs to enter it.
    if (expectImpact !== undefined && expectImpact !== preview.digest) {
      throw new ImpactChangedError(expectImpact, preview.digest);
    }

    return this.#uow.transaction(() => {
      // Story 4 (012) — in-transaction re-check. Throwing rolls the cascade
      // back so no task.discarded or objective.discarded is persisted.
      const fresh = this.#store.getObjective(objectiveId);
      assertCandidateFresh(objectiveId, expectedCommit, fresh?.commitOid);

      // §B.5 — the `expectImpact` re-check runs second, inside the
      // transaction, against a freshly-read graph.
      let effectivePreview = preview;
      if (expectImpact !== undefined) {
        const freshPreview = this.#buildPreview(
          objectiveId,
          objective.initiativeId,
        );
        if (freshPreview.digest !== expectImpact) {
          throw new ImpactChangedError(expectImpact, freshPreview.digest);
        }
        effectivePreview = freshPreview;
      }

      // Story 3 (017) §B.6 — the discarded task set is exactly the
      // preview's `discarded-by-cascade` task ids, so preview and mutation
      // cannot drift.
      const discardedTaskIds = new Set(
        effectivePreview.damage
          .filter(
            (d) =>
              d.target.type === "task" && d.effect === "discarded-by-cascade",
          )
          .map((d) => d.target.id),
      );
      const tasks = this.#store.listTasksByObjective(objectiveId);
      for (const task of tasks) {
        if (discardedTaskIds.has(task.id)) {
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

      return { preview: effectivePreview };
    });
  }
}
