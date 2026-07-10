/**
 * RPC schema initialiser — creates all rpc tables idempotently.
 * Called by src/store/schema.ts aggregator.
 */

import type { Store } from "../foundations/sqlite-store.ts";

export function initRpcSchema(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS escalation_responses (
      item_id      TEXT NOT NULL PRIMARY KEY,
      task_id      TEXT NOT NULL,
      actor        TEXT NOT NULL,
      action       TEXT NOT NULL,
      responded_at INTEGER NOT NULL
    )`,
  );
}
