import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export const INITIATIVE_STATUSES = [
  "building",
  "awaiting_pr",
  "delivered",
] as const;

export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export const OBJECTIVE_STATUSES = [
  "building",
  "awaiting_confirmation",
  "conflict",
  "integrated",
] as const;

export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export interface Initiative extends Entity {
  projectId: string;
  name: string;
  /** Defaults to `"building"`; optional so pre-migration rows/fixtures without a persisted status still type-check. */
  status?: InitiativeStatus;
  /** The daemon-provisioned isolated clone directory for this initiative's branch; absent until provisioned. */
  workspace?: string;
}

export interface Objective extends Entity {
  initiativeId: string;
  name: string;
  /** Defaults to `"building"`; optional so pre-migration rows/fixtures without a persisted status still type-check. */
  status?: ObjectiveStatus;
  /** The squashed objective commit's OID in the initiative clone; set when the objective reaches `awaiting_confirmation`. */
  commitOid?: string;
  /** The expected parent OID the squashed commit was built on top of (the broker's CAS anchor). */
  parentOid?: string;
  /** Set when a conflict-resolution gate run fails; absent otherwise. */
  conflictReason?: string;
}

export function newInitiative(projectId: string, name: string): Initiative {
  return { id: newId(), projectId, name, status: "building" };
}

export function newObjective(initiativeId: string, name: string): Objective {
  return { id: newId(), initiativeId, name, status: "building" };
}

const LEGAL_OBJECTIVE_TRANSITIONS: ReadonlySet<string> = new Set([
  "building->awaiting_confirmation",
  "awaiting_confirmation->conflict",
  "awaiting_confirmation->integrated",
  "conflict->awaiting_confirmation",
]);

const LEGAL_INITIATIVE_TRANSITIONS: ReadonlySet<string> = new Set([
  "building->awaiting_pr",
  "awaiting_pr->delivered",
]);

export class IllegalObjectiveTransitionError extends Error {
  readonly from: ObjectiveStatus;
  readonly to: ObjectiveStatus;

  constructor(from: ObjectiveStatus, to: ObjectiveStatus) {
    super(`Illegal objective transition: ${from} → ${to}`);
    this.name = "IllegalObjectiveTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class IllegalInitiativeTransitionError extends Error {
  readonly from: InitiativeStatus;
  readonly to: InitiativeStatus;

  constructor(from: InitiativeStatus, to: InitiativeStatus) {
    super(`Illegal initiative transition: ${from} → ${to}`);
    this.name = "IllegalInitiativeTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function transitionObjective(
  objective: Objective,
  to: ObjectiveStatus,
): Objective {
  const from = objective.status ?? "building";
  const key = `${from}->${to}`;
  if (!LEGAL_OBJECTIVE_TRANSITIONS.has(key)) {
    throw new IllegalObjectiveTransitionError(from, to);
  }
  return { ...objective, status: to };
}

export function transitionInitiative(
  initiative: Initiative,
  to: InitiativeStatus,
): Initiative {
  const from = initiative.status ?? "building";
  const key = `${from}->${to}`;
  if (!LEGAL_INITIATIVE_TRANSITIONS.has(key)) {
    throw new IllegalInitiativeTransitionError(from, to);
  }
  return { ...initiative, status: to };
}
