// src/app/task/get-conflict.ts — query use case: recompute conflict overview on demand.
// CQRS-lite query: reads the retained landing candidate + current target OID,
// calls RepositoryLanding.preview, returns structured ConflictOverview. No mutations.

import type { ChangeCandidate } from "../../domain/landing.ts";
import type { LandingCandidate, PreviewOutcome } from "../../landing/port.ts";

// ---------------------------------------------------------------------------
// Port types (narrow — owned by this consumer per AGENTS.md)
// ---------------------------------------------------------------------------

interface CandidateRepo {
  getCandidateByTask(taskId: string): ChangeCandidate | undefined;
}

interface Landing {
  preview(
    homeDir: string,
    candidate: LandingCandidate,
    targetOID: string,
  ): Promise<PreviewOutcome>;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ConflictOverview {
  taskId: string;
  branch: string;
  targetOID: string;
  candidateOID: string;
  files: { path: string; hunks: string }[];
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class NoConflictCandidateError extends Error {
  readonly taskId: string;
  constructor(taskId: string) {
    super(`no conflict candidate found for task ${taskId}`);
    this.name = "NoConflictCandidateError";
    this.taskId = taskId;
  }
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------

export class GetConflict {
  readonly #candidates: CandidateRepo;
  readonly #landing: Landing;
  readonly #resolveHomeDir: (repoId: string) => string;
  readonly #resolveTargetOID: (
    homeDir: string,
    branch: string,
  ) => string | Promise<string>;

  constructor(
    candidates: CandidateRepo,
    landing: Landing,
    resolveHomeDir: (repoId: string) => string,
    resolveTargetOID: (
      homeDir: string,
      branch: string,
    ) => string | Promise<string>,
  ) {
    this.#candidates = candidates;
    this.#landing = landing;
    this.#resolveHomeDir = resolveHomeDir;
    this.#resolveTargetOID = resolveTargetOID;
  }

  async execute(input: { taskId: string }): Promise<ConflictOverview> {
    const { taskId } = input;

    const candidate = this.#candidates.getCandidateByTask(taskId);
    if (!candidate || candidate.state !== "conflict") {
      throw new NoConflictCandidateError(taskId);
    }

    const homeDir = this.#resolveHomeDir(candidate.repoId);
    const targetOID = await this.#resolveTargetOID(homeDir, candidate.target);

    // Build a LandingCandidate from the ChangeCandidate for the port call.
    const landingCandidate: LandingCandidate = {
      id: candidate.id,
      taskId: candidate.taskId,
      repoId: candidate.repoId,
      baseSHA: candidate.baseSHA,
      candidateSHA: candidate.candidateSHA,
      ref: candidate.ref,
      target: candidate.target,
      workspace: "",
    };

    const outcome = await this.#landing.preview(
      homeDir,
      landingCandidate,
      targetOID,
    );

    if (outcome.kind !== "conflict") {
      // The conflict may have resolved since it was first detected; treat it
      // as if there is nothing to explain (no conflict candidate to surface).
      throw new NoConflictCandidateError(taskId);
    }

    return {
      taskId,
      branch: candidate.target,
      targetOID,
      candidateOID: candidate.candidateSHA,
      files: outcome.perFile,
    };
  }
}
