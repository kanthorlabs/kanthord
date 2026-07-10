/**
 * Scheduler schema initialiser — creates all scheduler tables idempotently.
 * Re-uses the already-exported initSchedulerSchema for scheduler_task and
 * inlines the DDL for blocked_on_capability and scheduler_lease (the private
 * apply* fns in blocked-on.ts and leases.ts are not yet exported).
 * Called by src/store/schema.ts aggregator.
 */

import type { Store } from "../foundations/sqlite-store.ts";
import { initSchedulerSchema } from "./dispatch.ts";

export function initSchedulerSubsystemSchema(store: Store): void {
  // Creates scheduler_task + blocked_on column (idempotent).
  initSchedulerSchema(store);

  // dispatched_generation: ALTER TABLE has no IF NOT EXISTS in SQLite — guard
  // with PRAGMA table_info (sqlite-gotchas rule).
  const cols = store.all<{ name: string }>("PRAGMA table_info(scheduler_task)");
  if (cols.length > 0 && !cols.some((c) => c.name === "dispatched_generation")) {
    store.run(
      "ALTER TABLE scheduler_task ADD COLUMN dispatched_generation INTEGER",
    );
  }

  // blocked_on_capability: persists a parked task's capability list.
  store.run(
    `CREATE TABLE IF NOT EXISTS blocked_on_capability (
      task_id   TEXT NOT NULL,
      cap_kind  TEXT NOT NULL,
      cap_value TEXT NOT NULL
    )`,
  );

  // scheduler_lease: serializes concurrent task dispatch on shared capabilities.
  store.run(
    `CREATE TABLE IF NOT EXISTS scheduler_lease (
      capability_key TEXT NOT NULL PRIMARY KEY,
      holder         TEXT NOT NULL,
      acquired_at    INTEGER NOT NULL,
      expires_at     INTEGER NOT NULL,
      heartbeat_at   INTEGER NOT NULL
    )`,
  );
}
