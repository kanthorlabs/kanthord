import type { Objective, Initiative } from "../../domain/initiative.ts";
import {
  transitionObjective,
  transitionInitiative,
} from "../../domain/initiative.ts";
import { newEvent } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { ObjectiveNotAwaitingConfirmationError } from "../errors.ts";
import { LandingCASMismatchError } from "../../landing/port.ts";
import type { ObjectiveBroker } from "../../objective-broker/port.ts";

interface ObjectiveStore {
  getObjective(id: string): Objective | undefined;
  saveObjective(objective: Objective): void;
  getInitiative(initiativeId: string): Initiative | undefined;
  resolveHomeDir(initiativeId: string): string;
  listObjectives(initiativeId: string): Objective[];
  saveInitiative(initiative: Initiative): void;
}

export class ApproveObjective {
  readonly #store: ObjectiveStore;
  readonly #broker: ObjectiveBroker;
  readonly #feed: EventFeed;
  readonly #uow: UnitOfWork;

  constructor(
    store: ObjectiveStore,
    broker: ObjectiveBroker,
    feed: EventFeed,
    uow: UnitOfWork,
  ) {
    this.#store = store;
    this.#broker = broker;
    this.#feed = feed;
    this.#uow = uow;
  }

  /**
   * Returns what actually happened, so callers (the CLI) can report a conflict
   * instead of announcing an integration that did not occur.
   */
  async execute(input: {
    objectiveId: string;
  }): Promise<{ outcome: "integrated" | "conflict" }> {
    const { objectiveId } = input;

    const objective = this.#store.getObjective(objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", objectiveId);
    }

    if (objective.status !== "awaiting_confirmation") {
      throw new ObjectiveNotAwaitingConfirmationError(
        objectiveId,
        objective.status,
      );
    }

    const initiative = this.#store.getInitiative(objective.initiativeId);
    const homeDir = this.#store.resolveHomeDir(objective.initiativeId);
    const clonePath = initiative?.workspace ?? "";
    const commitOid = objective.commitOid ?? "";
    const parentOid = objective.parentOid ?? "";

    // e2e 20260727-141944 — an objective whose tasks left no net diff carries
    // commitOid === parentOid (squashObjective reports the parent as its tip
    // rather than creating an empty commit). There is nothing to fetch and
    // nothing to fast-forward: the branch already points at that oid, so this
    // integrates as a no-op. Falling through would count 0 commits, record a
    // conflict, and livelock — retry re-squashes to the same empty result.
    if (commitOid !== "" && commitOid === parentOid) {
      this.#integrate(objective, objectiveId, initiative);
      return { outcome: "integrated" };
    }

    await this.#broker.fetch(homeDir, clonePath, commitOid);
    const commitCount = await this.#broker.countCommitsSince(
      homeDir,
      parentOid,
      commitOid,
    );

    if (commitCount !== 1) {
      this.#recordConflict(objective, objectiveId);
      return { outcome: "conflict" };
    }

    try {
      await this.#broker.casUpdateRef(
        homeDir,
        `refs/heads/kanthord/init/${objective.initiativeId}`,
        commitOid,
        parentOid,
      );
    } catch (err) {
      if (err instanceof LandingCASMismatchError) {
        this.#recordConflict(objective, objectiveId);
        return { outcome: "conflict" };
      }
      throw err;
    }

    this.#integrate(objective, objectiveId, initiative);
    return { outcome: "integrated" };
  }

  /** Mark the objective integrated, landing the initiative once all are. */
  #integrate(
    objective: Objective,
    objectiveId: string,
    initiative: Initiative | undefined,
  ): void {
    this.#uow.transaction(() => {
      const updated = transitionObjective(objective, "integrated");
      this.#store.saveObjective(updated);
      this.#feed.append(newEvent("objective.integrated", { objectiveId }));

      const siblings = this.#store.listObjectives(objective.initiativeId);
      const allIntegrated = siblings.every((o) => o.status === "integrated");
      if (allIntegrated && initiative !== undefined) {
        const updatedInitiative = transitionInitiative(initiative, "landed");
        this.#store.saveInitiative(updatedInitiative);
        this.#feed.append(
          newEvent("initiative.landed", {
            initiativeId: objective.initiativeId,
          }),
        );
      }
    });
  }

  #recordConflict(objective: Objective, objectiveId: string): void {
    this.#uow.transaction(() => {
      const updated = transitionObjective(objective, "conflict");
      this.#store.saveObjective(updated);
      this.#feed.append(newEvent("objective.conflict", { objectiveId }));
    });
  }
}
