/**
 * SQLite-backed ReconcileStorage with atomic read-modify-write via
 * BEGIN IMMEDIATE transactions so concurrent reserve() calls serialize.
 *
 * Uses Node 24 built-in `node:sqlite` (DatabaseSync) — no new npm dependency.
 * Schema: budget_ledger(task_id TEXT PRIMARY KEY, ledger TEXT NOT NULL).
 */

import { DatabaseSync } from "node:sqlite";
import type { ReconcileStorage } from "./budget-reconcile.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AtomicReconcileStorage extends ReconcileStorage {
  /**
   * Read-modify-write inside a single SQLite transaction (BEGIN IMMEDIATE).
   * The updater receives the current serialized ledger (or null if absent)
   * and must return the new serialized ledger to persist.
   * Concurrent calls serialize at the SQLite level — no two transactions
   * can hold a BEGIN IMMEDIATE write lock simultaneously.
   */
  atomicUpdate(
    taskId: string,
    updater: (current: string | null) => string,
  ): Promise<void>;

  /** Dispose the underlying DatabaseSync connection. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeSqliteReconcileStorage(dbPath: string): AtomicReconcileStorage {
  const db = new DatabaseSync(dbPath);

  // Create the table if it does not exist (migration).
  db.exec(`
    CREATE TABLE IF NOT EXISTS budget_ledger (
      task_id TEXT PRIMARY KEY,
      ledger  TEXT NOT NULL
    )
  `);

  // Prepared statements (synchronous — DatabaseSync is fully sync).
  const stmtSelect = db.prepare(
    "SELECT ledger FROM budget_ledger WHERE task_id = ?",
  );
  const stmtUpsert = db.prepare(
    "INSERT OR REPLACE INTO budget_ledger (task_id, ledger) VALUES (?, ?)",
  );

  // ---------------------------------------------------------------------------
  // atomicUpdate — the core primitive; load/save delegate to it.
  // ---------------------------------------------------------------------------
  function atomicUpdate(
    taskId: string,
    updater: (current: string | null) => string,
  ): Promise<void> {
    // DatabaseSync is synchronous; we wrap in a resolved Promise to satisfy
    // the async interface contract.
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = stmtSelect.get(taskId) as { ledger: string } | undefined;
      const current: string | null = row !== undefined ? row.ledger : null;
      const next = updater(current);
      stmtUpsert.run(taskId, next);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------------
  // ReconcileStorage contract
  // ---------------------------------------------------------------------------
  function load(taskId: string): Promise<string | null> {
    const row = stmtSelect.get(taskId) as { ledger: string } | undefined;
    return Promise.resolve(row !== undefined ? row.ledger : null);
  }

  function save(taskId: string, serialized: string): Promise<void> {
    return atomicUpdate(taskId, () => serialized);
  }

  function close(): void {
    db.close();
  }

  return { load, save, atomicUpdate, close };
}
