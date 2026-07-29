import type { Entity } from "./entity.ts";
import { newId } from "./entity.ts";

export const INITIATIVE_STATUSES = ["building", "landed", "discarded"] as const;

export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export const OBJECTIVE_STATUSES = [
  "building",
  "awaiting_confirmation",
  "conflict",
  "integrated",
  "discarded",
] as const;

export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export interface Initiative extends Entity {
  projectId: string;
  name: string;
  /** Explicit-activation gate; orthogonal to `status`. The column is NOT NULL
   * DEFAULT 0, so every persisted row has a value. Set in the creation INSERT
   * — `setPaused` is the only mutator after creation. */
  paused: boolean;
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
  /** Consolidated human guidance recorded at `retry objective` time. */
  note?: string;
  /** Why `approve objective` recorded a conflict. Absent on pre-migration rows. */
  conflictCause?: "non-single-commit" | "cas-mismatch";
  /** The ref's actual OID observed at CAS-failure time. Only set for `cas-mismatch`. */
  observedTipOid?: string;
}

export function newInitiative(input: {
  projectId: string;
  name: string;
  paused: boolean;
}): Initiative {
  return {
    id: newId(),
    projectId: input.projectId,
    name: input.name,
    paused: input.paused,
    status: "building",
  };
}

export function newObjective(initiativeId: string, name: string): Objective {
  return { id: newId(), initiativeId, name, status: "building" };
}

const LEGAL_OBJECTIVE_TRANSITIONS: ReadonlySet<string> = new Set([
  "building->awaiting_confirmation",
  "awaiting_confirmation->conflict",
  "awaiting_confirmation->integrated",
  "conflict->awaiting_confirmation",
  "building->discarded",
  "awaiting_confirmation->discarded",
  "conflict->discarded",
]);

const LEGAL_INITIATIVE_TRANSITIONS: ReadonlySet<string> = new Set([
  "building->landed",
  "building->discarded",
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

/**
 * Refused an objective verdict because the candidate the client reviewed is no
 * longer this objective's candidate. The guard is the single comparison
 * implementation for `ApproveObjective` / `RejectObjective` / `RetryObjective`
 * (AGENTS.md forbids use-case-calls-use-case, so the check lives in domain/).
 *
 * The message must match `/stale|expected|moved/i` so the Proof's
 * `grep -qiE 'stale|expected|moved'` at `activation-verdict-proof.sh:97`
 * catches it.
 */
export class StaleCandidateError extends Error {
  readonly objectiveId: string;
  readonly expected: string;
  readonly actual: string;

  constructor(objectiveId: string, expected: string, actual: string) {
    super(
      `objective ${objectiveId} candidate moved: expected ${expected}, found ${actual}`,
    );
    this.name = "StaleCandidateError";
    this.objectiveId = objectiveId;
    this.expected = expected;
    this.actual = actual;
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

export function canRetryObjective(status: ObjectiveStatus): boolean {
  return status === "awaiting_confirmation" || status === "conflict";
}

/**
 * Refuse a verdict whose reviewed candidate is no longer this objective's
 * candidate. `actual === undefined` (no candidate at all) is always stale.
 * Shared across `ApproveObjective` / `RejectObjective` / `RetryObjective` so
 * the comparison lives in exactly one place.
 */
export function assertCandidateFresh(
  objectiveId: string,
  expectedCommit: string,
  actual: string | undefined,
): void {
  if (actual === undefined || actual !== expectedCommit) {
    throw new StaleCandidateError(objectiveId, expectedCommit, actual ?? "");
  }
}

/**
 * Clears conflict diagnosis fields (`conflictCause`, `observedTipOid`,
 * `conflictReason`) so a resolved objective stops reporting a stale cause or
 * reason. `note` is guidance, not diagnosis, and is deliberately kept.
 */
export function clearConflictDiagnosis(objective: Objective): Objective {
  const {
    conflictCause: _conflictCause,
    observedTipOid: _observedTipOid,
    conflictReason: _conflictReason,
    ...rest
  } = objective;
  return rest as Objective;
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
