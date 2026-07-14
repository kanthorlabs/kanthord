/**
 * DDL for the external_tracking table.
 *
 * external_tracking is the durable projection/worklist for external state the
 * daemon must observe and act on after creation (PRs, issues, remote branches).
 * Rows are written at delivery time and survive daemon restart; the in-memory
 * prOpTaskMap is only a read-cache derived from these rows.
 *
 * Columns
 * -------
 * id                 - deterministic opaque PK
 * local_kind         - 'task' | 'op' etc.
 * local_id           - e.g. task id
 * external_kind      - 'pull_request' | 'issue' etc.
 * external_provider  - 'github' etc.
 * external_id        - remote identifier (PR number as string, issue number, …)
 * external_url       - remote artifact URL (nullable)
 * created_by_op_id   - op that created the external resource
 * idempotency_key    - UNIQUE — prevent duplicate rows for same delivery
 * tracking_status    - 'active' | 'terminal'
 * observed_state_json- last observed external state as JSON (nullable)
 * next_poll_at       - epoch ms: when to next poll (0 = now)
 * attempt_count      - cumulative poll attempts
 * last_error_json    - JSON of last poll error (nullable)
 * created_at         - epoch ms
 * updated_at         - epoch ms
 */

import type { Store } from "../foundations/sqlite-store.ts";

export function initExternalTrackingSchema(store: Store): void {
  store.run(`
    CREATE TABLE IF NOT EXISTS external_tracking (
      id                  TEXT    NOT NULL PRIMARY KEY,
      local_kind          TEXT    NOT NULL,
      local_id            TEXT    NOT NULL,
      external_kind       TEXT    NOT NULL,
      external_provider   TEXT    NOT NULL,
      external_id         TEXT    NOT NULL,
      external_url        TEXT,
      created_by_op_id    TEXT    NOT NULL DEFAULT '',
      idempotency_key     TEXT    NOT NULL UNIQUE,
      tracking_status     TEXT    NOT NULL DEFAULT 'active',
      observed_state_json TEXT,
      next_poll_at        INTEGER NOT NULL DEFAULT 0,
      attempt_count       INTEGER NOT NULL DEFAULT 0,
      last_error_json     TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    )
  `);
}
