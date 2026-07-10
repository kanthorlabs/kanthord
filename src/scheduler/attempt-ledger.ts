/**
 * Durable attempt ledger (Epic 019.3, Story 003 T1).
 *
 * Tracks how many times a task has been dispatched (per-dispatch, not
 * per-failure) and whether the operator has granted one extra attempt.
 *
 * Design decisions:
 *  - `dispatch_count` increments at each spawn; lifecycle respawns
 *    (crash/threshold) must NOT call `incrementAttempt` — they continue the
 *    same attempt and only the run-loop dispatcher calls this.
 *  - `grant_one` is a boolean flag set by the operator `retry-once` action;
 *    it does not change `dispatch_count`.
 *  - `rearmLedger` (operator `re-arm` action) resets `dispatch_count` to 0
 *    and returns the prior value for the interaction record.
 *
 * The table is created idempotently in each entry point so this module is
 * safe to call before any migration runner (sqlite-gotchas: IF NOT EXISTS).
 */

import type { Store } from "../foundations/sqlite-store.ts";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Idempotent DDL — must be called before any DML on attempt_ledger. */
function ensureSchema(store: Store): void {
  store.run(`
    CREATE TABLE IF NOT EXISTS attempt_ledger (
      task_id        TEXT    NOT NULL PRIMARY KEY,
      dispatch_count INTEGER NOT NULL DEFAULT 0,
      grant_one      INTEGER NOT NULL DEFAULT 0
    )
  `);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Increments the dispatched-attempt count for a task and returns the new
 * value (1-based: first dispatch returns 1).
 */
export function incrementAttempt(store: Store, taskId: string): number {
  ensureSchema(store);
  store.run(
    `INSERT INTO attempt_ledger (task_id, dispatch_count, grant_one)
     VALUES (?, 1, 0)
     ON CONFLICT(task_id) DO UPDATE SET dispatch_count = dispatch_count + 1`,
    taskId,
  );
  const row = store.get<{ dispatch_count: number }>(
    `SELECT dispatch_count FROM attempt_ledger WHERE task_id = ?`,
    taskId,
  );
  return row?.dispatch_count ?? 0;
}

/**
 * Returns the current dispatched-attempt count without modifying it.
 * Returns 0 when no row exists for the task.
 */
export function readAttempts(store: Store, taskId: string): number {
  ensureSchema(store);
  const row = store.get<{ dispatch_count: number }>(
    `SELECT dispatch_count FROM attempt_ledger WHERE task_id = ?`,
    taskId,
  );
  return row?.dispatch_count ?? 0;
}

/**
 * Resets the dispatched-attempt count to 0 (operator `re-arm` action).
 * Returns the count that was in effect before the reset, for use in the
 * interaction record.
 */
export function rearmLedger(store: Store, taskId: string): number {
  ensureSchema(store);
  const prior = readAttempts(store, taskId);
  store.run(
    `INSERT INTO attempt_ledger (task_id, dispatch_count, grant_one)
     VALUES (?, 0, 0)
     ON CONFLICT(task_id) DO UPDATE SET dispatch_count = 0`,
    taskId,
  );
  return prior;
}

/**
 * Sets the `grant_one` flag (operator `retry-once` action).
 * Does NOT change the dispatch count; the next spawn checks this flag and
 * clears it when the extra attempt is consumed.
 */
export function grantOne(store: Store, taskId: string): void {
  ensureSchema(store);
  store.run(
    `INSERT INTO attempt_ledger (task_id, dispatch_count, grant_one)
     VALUES (?, 0, 1)
     ON CONFLICT(task_id) DO UPDATE SET grant_one = 1`,
    taskId,
  );
}

/**
 * Returns `true` when the operator has granted one extra attempt for this
 * task (i.e. `grantOne` was called and the flag has not yet been cleared).
 */
export function readGrantOne(store: Store, taskId: string): boolean {
  ensureSchema(store);
  const row = store.get<{ grant_one: number }>(
    `SELECT grant_one FROM attempt_ledger WHERE task_id = ?`,
    taskId,
  );
  return (row?.grant_one ?? 0) === 1;
}
