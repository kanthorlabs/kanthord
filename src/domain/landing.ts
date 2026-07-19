// src/domain/landing.ts — pure domain types for the landing lifecycle.
// No imports outside src/domain/.

export type CandidateState = "pending" | "landed" | "conflict";

export interface ChangeCandidate {
  [key: string]: unknown; // allows safe cast to Record<string, unknown> in tests
  id: string; // ULID minted at approve time
  taskId: string | null;
  repoId: string;
  baseSHA: string; // SHA of canonical branch HEAD at approve time (fixes A7)
  candidateSHA: string; // proposal commit to be landed
  ref: string; // task branch: "kanthord/<taskId>"
  target: string; // canonical branch, e.g. "main"
  state: CandidateState;
}

export interface Acceptance {
  candidateId: string;
  approvedBy: string; // "human" (or future automated policy name)
  approvedAt: string; // ISO timestamp
}

export interface Integration {
  candidateId: string;
  outcome: "fast-forward" | "merge" | "conflict";
  canonicalSHA: string; // final HEAD after landing; candidateSHA for conflict
  mergeCommit?: string; // set only for "merge" outcome
  conflictFiles?: string[]; // set only for "conflict" outcome
}

export interface LandedChange {
  candidateId: string;
  canonicalSHA: string;
  landedAt: string; // ISO timestamp
}

/**
 * Creates a new ChangeCandidate in `pending` state.
 * Returns a fresh object — the caller's input is not mutated.
 */
export function newChangeCandidate(input: {
  id: string;
  taskId: string | null;
  repoId: string;
  baseSHA: string;
  candidateSHA: string;
  ref: string;
  target: string;
}): ChangeCandidate {
  return {
    id: input.id,
    taskId: input.taskId,
    repoId: input.repoId,
    baseSHA: input.baseSHA,
    candidateSHA: input.candidateSHA,
    ref: input.ref,
    target: input.target,
    state: "pending",
  };
}
