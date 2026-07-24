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

  async execute(input: { objectiveId: string }): Promise<void> {
    const { objectiveId } = input;

    const objective = this.#store.getObjective(objectiveId);
    if (objective === undefined) {
      throw new UnknownReferenceError("objective", objectiveId);
    }

    if (objective.status === "integrated") {
      return;
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

    await this.#broker.fetch(homeDir, clonePath, commitOid);
    const commitCount = await this.#broker.countCommitsSince(
      homeDir,
      parentOid,
      commitOid,
    );

    if (commitCount !== 1) {
      this.#recordConflict(objective, objectiveId);
      return;
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
        return;
      }
      throw err;
    }

    this.#uow.transaction(() => {
      const updated = transitionObjective(objective, "integrated");
      this.#store.saveObjective(updated);
      this.#feed.append(newEvent("objective.integrated", { objectiveId }));

      const siblings = this.#store.listObjectives(objective.initiativeId);
      const allIntegrated = siblings.every((o) => o.status === "integrated");
      if (allIntegrated && initiative !== undefined) {
        const updatedInitiative = transitionInitiative(
          initiative,
          "awaiting_pr",
        );
        this.#store.saveInitiative(updatedInitiative);
        this.#feed.append(
          newEvent("initiative.awaiting_pr", {
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
