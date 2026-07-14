/**
 * Broker schema initialiser — creates all broker tables idempotently.
 * Called by src/store/schema.ts aggregator; subsystem DDL is kept here as the
 * single source of truth for the broker subsystem.
 */

import type { Store } from "../foundations/sqlite-store.ts";

export function initBrokerSchema(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS broker_in_flight (
      op_id TEXT PRIMARY KEY,
      verb TEXT NOT NULL,
      request_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL
    )`,
  );
  const columns = store.all<{ name: string }>("PRAGMA table_info(broker_in_flight)");
  if (!columns.some((c) => c.name === "payload_json")) {
    store.run("ALTER TABLE broker_in_flight ADD COLUMN payload_json TEXT");
  }
  store.run(
    `CREATE TABLE IF NOT EXISTS broker_completion (
      op_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      at INTEGER NOT NULL
    )`,
  );
  store.run(
    `CREATE TABLE IF NOT EXISTS broker_pending (
      op_id TEXT PRIMARY KEY,
      verb TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      pending_at INTEGER NOT NULL,
      status TEXT NOT NULL
    )`,
  );
}
