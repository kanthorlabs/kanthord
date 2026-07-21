// src/storage/sqlite/landing.ts — SQLite adapter for LandingRepository.

import type { DatabaseSync } from "node:sqlite";
import type { LandingRepository } from "../port.ts";
import type {
  ChangeCandidate,
  CandidateState,
  Integration,
} from "../../domain/landing.ts";

type LandingRow = {
  id: string;
  task_id: string | null;
  repo_id: string;
  base_sha: string;
  candidate_sha: string;
  ref: string;
  target: string;
  state: string;
};

export class SqliteLandingRepository implements LandingRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  saveCandidate(candidate: ChangeCandidate): void {
    this.#db
      .prepare(
        `INSERT INTO landing_candidates
           (id, task_id, repo_id, base_sha, candidate_sha, ref, target, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        candidate.id,
        candidate.taskId ?? null,
        candidate.repoId,
        candidate.baseSHA,
        candidate.candidateSHA,
        candidate.ref,
        candidate.target,
        candidate.state,
      );
  }

  getCandidate(id: string): ChangeCandidate | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, task_id, repo_id, base_sha, candidate_sha, ref, target, state
           FROM landing_candidates WHERE id = ?`,
      )
      .get(id) as LandingRow | undefined;
    if (row === undefined) return undefined;
    return this.rowToCandidate(row);
  }

  getCandidateByTask(taskId: string): ChangeCandidate | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, task_id, repo_id, base_sha, candidate_sha, ref, target, state
           FROM landing_candidates WHERE task_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId) as LandingRow | undefined;
    if (row === undefined) return undefined;
    return this.rowToCandidate(row);
  }

  /** Maps a `landing_candidates` row to the domain `ChangeCandidate`. */
  private rowToCandidate(row: LandingRow): ChangeCandidate {
    return {
      id: row.id,
      taskId: row.task_id,
      repoId: row.repo_id,
      baseSHA: row.base_sha,
      candidateSHA: row.candidate_sha,
      ref: row.ref,
      target: row.target,
      state: row.state as CandidateState,
    };
  }

  updateCandidateState(id: string, state: CandidateState): void {
    this.#db
      .prepare(`UPDATE landing_candidates SET state = ? WHERE id = ?`)
      .run(state, id);
  }

  saveIntegration(integration: Integration): void {
    const conflictFiles =
      integration.conflictFiles !== undefined
        ? JSON.stringify(integration.conflictFiles)
        : null;
    this.#db
      .prepare(
        `INSERT INTO landing_integrations
           (candidate_id, outcome, canonical_sha, merge_commit, conflict_files)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           outcome = excluded.outcome,
           canonical_sha = excluded.canonical_sha,
           merge_commit = excluded.merge_commit,
           conflict_files = excluded.conflict_files`,
      )
      .run(
        integration.candidateId,
        integration.outcome,
        integration.canonicalSHA,
        integration.mergeCommit ?? null,
        conflictFiles,
      );
  }

  getIntegration(candidateId: string): Integration | undefined {
    const row = this.#db
      .prepare(
        `SELECT candidate_id, outcome, canonical_sha, merge_commit, conflict_files
           FROM landing_integrations WHERE candidate_id = ?`,
      )
      .get(candidateId) as
      | {
          candidate_id: string;
          outcome: string;
          canonical_sha: string;
          merge_commit: string | null;
          conflict_files: string | null;
        }
      | undefined;
    if (row === undefined) return undefined;
    const result: Integration = {
      candidateId: row.candidate_id,
      outcome: row.outcome as Integration["outcome"],
      canonicalSHA: row.canonical_sha,
    };
    if (row.merge_commit !== null) result.mergeCommit = row.merge_commit;
    if (row.conflict_files !== null)
      result.conflictFiles = JSON.parse(row.conflict_files) as string[];
    return result;
  }
}
