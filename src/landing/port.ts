// src/landing/port.ts — narrow local port for the RepositoryLanding capability.
// Only this file defines the landing seam; adapters (e.g. GitLanding) import it.

export interface LandingCandidate {
  id: string;
  taskId: string | null;
  repoId: string;
  baseSHA: string;
  candidateSHA: string;
  ref: string;
  target: string;
  workspace: string;
}

export type LandingOutcome =
  | { kind: "fast-forward" }
  | { kind: "merge"; mergeCommit: string }
  | { kind: "conflict"; files: string[] }
  | { kind: "already-landed"; canonicalSHA: string };

export interface LandingResult {
  candidate: LandingCandidate;
  outcome: LandingOutcome;
  canonicalSHA: string;
}

export class LandingInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LandingInvariantError";
  }
}

export class LandingConflictError extends Error {
  readonly candidate: LandingCandidate;
  readonly conflictFiles: string[];

  constructor(candidate: LandingCandidate, conflictFiles: string[]) {
    super(
      `Landing conflict for candidate ${candidate.id}: ${conflictFiles.length} file(s) in conflict`,
    );
    this.name = "LandingConflictError";
    this.candidate = candidate;
    this.conflictFiles = conflictFiles;
  }
}

export type PreviewOutcome =
  | { kind: "fast-forward"; candidateOID: string }
  | { kind: "mergeable"; treeOID: string }
  | {
      kind: "conflict";
      files: string[];
      perFile: { path: string; hunks: string }[];
    };

export class LandingCASMismatchError extends Error {
  readonly newTargetOID: string;

  constructor(newTargetOID: string) {
    super(`CAS mismatch: branch moved to ${newTargetOID}`);
    this.name = "LandingCASMismatchError";
    this.newTargetOID = newTargetOID;
  }
}

export interface RepositoryLanding {
  preview(
    homeDir: string,
    candidate: LandingCandidate,
    targetOID: string,
  ): Promise<PreviewOutcome>;
  landPreviewed(
    homeDir: string,
    candidate: LandingCandidate,
    previewOutcome: PreviewOutcome,
    targetOID: string,
  ): Promise<LandingResult>;
  resolveTargetOID(homeDir: string, branch: string): string | Promise<string>;
}
