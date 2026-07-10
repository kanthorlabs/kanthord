/**
 * Durable bounded attempt-evidence store (Epic 019.3, Story 002 T1).
 *
 * Contract that Epic 024's real gates must fill:
 *   - evidence shape: { taskId, attempt, phase, summary }
 *   - summary is bounded by EVIDENCE_SUMMARY_CAP before storage
 *   - all attempts for a task are retained for audit; only the latest is
 *     injected into the next spawn brief
 *
 * The table is created idempotently in each entry point so this module is
 * safe to call before any migration runner runs (sqlite-gotchas: IF NOT EXISTS).
 */

import type { Store } from "../foundations/sqlite-store.ts";

/**
 * Maximum characters stored in a failure summary.
 *
 * Rationale: the evidence is injected into the LLM spawn brief; an unbounded
 * summary could consume the entire context window and starve the task body.
 * 2048 characters is enough to convey a meaningful test-runner error while
 * keeping the brief's evidence section a small, predictable fraction of the
 * total prompt.
 */
export const EVIDENCE_SUMMARY_CAP = 2048;

/** Shape of one stored evidence row. */
export type AttemptEvidence = {
  taskId: string;
  attempt: number;
  phase: string;
  summary: string;
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Idempotent DDL — must be called before any DML on attempt_evidence. */
function ensureSchema(store: Store): void {
  store.run(`
    CREATE TABLE IF NOT EXISTS attempt_evidence (
      task_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      phase   TEXT NOT NULL,
      summary TEXT NOT NULL,
      PRIMARY KEY (task_id, attempt)
    )
  `);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Records a gate-failure evidence entry for the given task attempt.
 * Truncates `summary` to EVIDENCE_SUMMARY_CAP characters before storing.
 * Multiple attempts for the same task are all kept (audit trail).
 */
export function recordEvidence(
  store: Store,
  ev: { taskId: string; attempt: number; phase: string; summary: string },
): void {
  ensureSchema(store);
  const bounded = ev.summary.slice(0, EVIDENCE_SUMMARY_CAP);
  store.run(
    `INSERT OR REPLACE INTO attempt_evidence (task_id, attempt, phase, summary)
     VALUES (?, ?, ?, ?)`,
    ev.taskId,
    ev.attempt,
    ev.phase,
    bounded,
  );
}

/**
 * Returns the evidence row with the highest attempt number for the given task,
 * or `null` if none exists.
 */
export function latestEvidence(
  store: Store,
  taskId: string,
): AttemptEvidence | null {
  ensureSchema(store);
  const row = store.get<{ task_id: string; attempt: number; phase: string; summary: string }>(
    `SELECT task_id, attempt, phase, summary
     FROM attempt_evidence
     WHERE task_id = ?
     ORDER BY attempt DESC
     LIMIT 1`,
    taskId,
  );
  if (row === undefined) return null;
  return {
    taskId: row.task_id,
    attempt: row.attempt,
    phase: row.phase,
    summary: row.summary,
  };
}
