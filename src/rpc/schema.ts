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

  // Singleton verify report: INSERT OR REPLACE keeps at most one row.
  store.run(
    `CREATE TABLE IF NOT EXISTS verify_report (
      id          TEXT NOT NULL PRIMARY KEY,
      outcome     TEXT NOT NULL,
      report_json TEXT NOT NULL,
      ran_at      INTEGER NOT NULL
    )`,
  );

  // Dead-man ping table (Epic 029 populates this; created here so getDaemonStatus
  // can query it without a "no such table" error and return { present: false } when
  // empty).
  store.run(
    `CREATE TABLE IF NOT EXISTS dead_man_ping (
      id        TEXT NOT NULL PRIMARY KEY,
      pinged_at INTEGER NOT NULL
    )`,
  );

  // Control journal: append-only log of control-verb invocations with actor.
  store.run(
    `CREATE TABLE IF NOT EXISTS control_journal (
      id          TEXT    NOT NULL PRIMARY KEY,
      action      TEXT    NOT NULL,
      target_id   TEXT    NOT NULL,
      actor       TEXT    NOT NULL,
      recorded_at INTEGER NOT NULL
    )`,
  );

  // Auth failure log: one row per failed Basic-auth attempt; source = remote IP,
  // never a credential value.  Created here (at boot) so getDaemonStatus and auth
  // middleware can query/write it without lazy DDL.
  store.run(
    `CREATE TABLE IF NOT EXISTS auth_failure_log (
      id        TEXT    NOT NULL PRIMARY KEY,
      source    TEXT    NOT NULL,
      failed_at INTEGER NOT NULL
    )`,
  );
}
