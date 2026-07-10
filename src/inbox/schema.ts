/**
 * Inbox schema initialiser — creates all inbox tables idempotently.
 * Called by src/store/schema.ts aggregator.
 */

import type { Store } from "../foundations/sqlite-store.ts";

export function initInboxSchema(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS inbox_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      evidence TEXT NOT NULL
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS approval_decisions (
      item_id TEXT PRIMARY KEY,
      op_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      decided_at INTEGER NOT NULL
    )`,
  );
}
