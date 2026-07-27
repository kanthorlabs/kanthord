import type { Objective, Initiative } from "../../domain/initiative.ts";
import {
  transitionObjective,
  canRetryObjective,
  assertCandidateFresh,
} from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { Event } from "../../domain/event.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import {
  UnknownReferenceError,
  ObjectiveNotAwaitingConfirmationError,
} from "../errors.ts";

export class ObjectiveNotRetryableError extends Error {
  readonly objectiveId: string;

  constructor(objectiveId: string) {
    super(
      `objective ${objectiveId} is a non-tip objective that is already integrated; ` +
        `it is not rewritable in place — open a corrective objective or restart the initiative`,
    );
    this.name = "ObjectiveNotRetryableError";
    this.objectiveId = objectiveId;
  }
}

interface ObjectiveStore {
  getObjective(id: string): Objective | undefined;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveObjective(objective: Objective): void;
  resolveHomeDir(initiativeId: string): string;
  listTasksByObjective(objectiveId: string): Task[];
  saveTask(task: Task): void;
}

interface ObjectiveTipReader {
  currentTip(homeDir: string, ref: string): Promise<string>;
}

interface ObjectiveSquasher {
  squashObjective(
    dir: string,
    parentOid: string,
    message: string,
  ): Promise<{ oid: string }>;
}

interface ObjectiveGate {
  verify(dir: string): Promise<{ passed: boolean; reason?: string }>;
}

interface EventAppender {
  append(event: Event): void;
}

export class RetryObjective {
  readonly #store: ObjectiveStore;
  readonly #broker?: ObjectiveTipReader;
  readonly #workspaces?: ObjectiveSquasher;
  readonly #gate?: ObjectiveGate;
  readonly #feed?: EventAppender;
  readonly #uow?: UnitOfWork;

  constructor(
    store: ObjectiveStore,
    broker?: ObjectiveTipReader,
    workspaces?: ObjectiveSquasher,
    gate?: ObjectiveGate,
    feed?: EventAppender,
    uow?: UnitOfWork,
  ) {
    this.#store = store;
    this.#broker = broker;
    this.#workspaces = workspaces;
    this.#gate = gate;
    this.#feed = feed;
    this.#uow = uow;
  }

  async execute(input: {
    objectiveId: string;
    note?: string;
    expectedCommit: string;
  }): Promise<void> {
    const { objectiveId, note, expectedCommit } = input;

    const objective = this.#store.getObjective(objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", objectiveId);
    }

    if (objective.status === "integrated") {
      const siblings = this.#store.listObjectives(objective.initiativeId);
      const index = siblings.findIndex((o) => o.id === objectiveId);
      const isNonTip = siblings
        .slice(index + 1)
        .some((o) => o.status === "integrated");
      if (isNonTip) {
        throw new ObjectiveNotRetryableError(objectiveId);
      }
      // Story 4 (012) — even the tip-integrated silent no-op is refused on a
      // stale guard. The client never reviewed the current candidate.
      assertCandidateFresh(objectiveId, expectedCommit, objective.commitOid);
      return;
    }

    if (!canRetryObjective(objective.status ?? "building")) {
      throw new ObjectiveNotAwaitingConfirmationError(
        objectiveId,
        objective.status,
      );
    }

    // Story 4 (012) — early guard after the retry-eligibility check, before
    // any broker / workspaces / gate call. SQLite cannot roll back a moved
    // ref, so the refusal must precede git work.
    assertCandidateFresh(objectiveId, expectedCommit, objective.commitOid);

    if (
      objective.status === "conflict" &&
      this.#broker !== undefined &&
      this.#workspaces !== undefined &&
      this.#gate !== undefined &&
      this.#feed !== undefined &&
      this.#uow !== undefined
    ) {
      await this.#resolveConflict(
        objective,
        this.#broker,
        this.#workspaces,
        this.#gate,
        this.#feed,
        this.#uow,
        note,
        expectedCommit,
      );
      return;
    }

    // Tip-integrated retry, and conflict retry without the full resolution
    // dependency set, are out of scope for this Task.
  }

  async #resolveConflict(
    objective: Objective,
    broker: ObjectiveTipReader,
    workspaces: ObjectiveSquasher,
    gate: ObjectiveGate,
    feed: EventAppender,
    uow: UnitOfWork,
    note: string | undefined,
    expectedCommit: string,
  ): Promise<void> {
    const { initiativeId, id: objectiveId } = objective;
    const homeDir = this.#store.resolveHomeDir(initiativeId);
    const ref = `refs/heads/kanthord/init/${initiativeId}`;
    const initiative = this.#store.getInitiative(initiativeId);
    const dir = initiative?.workspace ?? "";

    const newParentOid = await broker.currentTip(homeDir, ref);
    const { oid } = await workspaces.squashObjective(
      dir,
      newParentOid,
      `objective ${objectiveId} conflict resolution`,
    );
    const { passed, reason } = await gate.verify(dir);

    if (passed) {
      uow.transaction(() => {
        // Story 4 (012) — in-transaction re-check. Compare against the
        // STORED commitOid (still the pre-squash candidate at this point);
        // the new oid is only written inside this callback.
        const fresh = this.#store.getObjective(objectiveId);
        assertCandidateFresh(objectiveId, expectedCommit, fresh?.commitOid);

        const updated: Objective = {
          ...transitionObjective(objective, "awaiting_confirmation"),
          commitOid: oid,
          parentOid: newParentOid,
        };
        this.#store.saveObjective(updated);
        feed.append(
          newEvent("objective.awaiting_confirmation", { objectiveId }),
        );
        if (note !== undefined) {
          for (const task of this.#store.listTasksByObjective(objectiveId)) {
            if (task.status === "completed" || task.status === "discarded") {
              continue;
            }
            this.#store.saveTask({ ...task, note });
          }
        }
      });
      return;
    }

    uow.transaction(() => {
      const updated: Objective = { ...objective, conflictReason: reason };
      this.#store.saveObjective(updated);
    });
  }
}
