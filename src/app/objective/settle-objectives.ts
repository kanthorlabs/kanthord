// e2e 20260727-132041 B2 — objective integration must be re-entrant.
//
// The objective-boundary squash runs in RunNextTask *after* the last task's
// transaction has committed, so anything that throws in between (see B1: an
// empty commit crashed the whole daemon) leaves the objective in `building`
// with every task already `completed`. Nothing re-drives it: no task is left to
// schedule, so every later round is a no-op and the initiative can never land.
//
// This module owns the settle step once, so both callers share it:
//   - RunNextTask, on the happy path, right after the last task completes;
//   - SettleObjectives, swept at daemon startup, which is where a crashed run
//     gets its second chance.
// It is idempotent: an objective that already left `building` is skipped.

import type { Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import { transitionObjective } from "../../domain/initiative.ts";
import { newEvent } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";

export interface ObjectiveSettleStore {
  getObjective(id: string): Objective | undefined;
  saveObjective(objective: Objective): void;
  getObjectiveParentOid(objectiveId: string): string;
}

export interface ObjectiveSquasher {
  squashObjective(
    dir: string,
    parentOid: string,
    message: string,
  ): Promise<{ oid: string }>;
}

/**
 * Squash an objective's accumulated commits and move it to
 * `awaiting_confirmation`. Call only when every task of the objective is
 * `completed`. Returns true when this call performed the transition.
 */
export async function settleObjective(
  objectiveId: string,
  workspaceDir: string,
  store: ObjectiveSettleStore,
  workspaces: ObjectiveSquasher,
  feed: EventFeed,
): Promise<boolean> {
  const objective = store.getObjective(objectiveId);
  if (objective === undefined) return false;
  // Idempotence: only an objective still building has anything to settle.
  if ((objective.status ?? "building") !== "building") return false;

  const parentOid = store.getObjectiveParentOid(objectiveId);
  const { oid } = await workspaces.squashObjective(
    workspaceDir,
    parentOid,
    `objective ${objectiveId}`,
  );

  const transitioned = transitionObjective(objective, "awaiting_confirmation");
  store.saveObjective({ ...transitioned, commitOid: oid, parentOid });
  feed.append(newEvent("objective.awaiting_confirmation", { objectiveId }));
  return true;
}

interface SettleInitiativeSource {
  listAllInitiatives(): Array<{ id: string }>;
  get(id: string): { workspace?: string } | undefined;
  listObjectives(initiativeId: string): Objective[];
}

interface SettleTaskSource {
  listTasksByObjective(objectiveId: string): Task[];
}

/**
 * Startup sweep: settle every objective whose tasks are all completed but which
 * never reached `awaiting_confirmation` — the state a crash mid-integration
 * leaves behind. A daemon restart is exactly when this can be repaired, so
 * RunDaemon runs it once, right after recovering interrupted tasks.
 */
export class SettleObjectives {
  readonly #initiatives: SettleInitiativeSource;
  readonly #tasks: SettleTaskSource;
  readonly #store: ObjectiveSettleStore;
  readonly #workspaces: ObjectiveSquasher;
  readonly #feed: EventFeed;

  constructor(
    initiatives: SettleInitiativeSource,
    tasks: SettleTaskSource,
    store: ObjectiveSettleStore,
    workspaces: ObjectiveSquasher,
    feed: EventFeed,
  ) {
    this.#initiatives = initiatives;
    this.#tasks = tasks;
    this.#store = store;
    this.#workspaces = workspaces;
    this.#feed = feed;
  }

  /** Returns the ids of the objectives this sweep settled. */
  async execute(): Promise<string[]> {
    const settled: string[] = [];
    for (const initiative of this.#initiatives.listAllInitiatives()) {
      const workspaceDir = this.#initiatives.get(initiative.id)?.workspace;
      // No clone provisioned means no objective of it ever ran a task.
      if (workspaceDir === undefined) continue;

      for (const objective of this.#initiatives.listObjectives(initiative.id)) {
        if ((objective.status ?? "building") !== "building") continue;

        const tasks = this.#tasks.listTasksByObjective(objective.id);
        if (tasks.length === 0) continue;
        if (!tasks.every((t) => t.status === "completed")) continue;

        const done = await settleObjective(
          objective.id,
          workspaceDir,
          this.#store,
          this.#workspaces,
          this.#feed,
        );
        if (done) settled.push(objective.id);
      }
    }
    return settled;
  }
}
