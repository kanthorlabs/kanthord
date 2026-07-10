/**
 * Ring-1 schema initialiser — creates the budget_ledger table idempotently.
 * The primary DDL lives in sqlite-reconcile-storage.ts (DatabaseSync); this
 * init applies the same schema to the shared Store so the aggregator can
 * include it without opening a second connection.
 * Called by src/store/schema.ts aggregator.
 */

import type { Store } from "../foundations/sqlite-store.ts";

export function initRing1Schema(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS budget_ledger (
      task_id TEXT PRIMARY KEY,
      ledger  TEXT NOT NULL
    )`,
  );
}
