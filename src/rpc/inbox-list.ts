/**
 * inbox-list — Story 017-001 Task T2.
 *
 * Provides `listOpenInboxItems` used by the `listInboxItems` Connect RPC and
 * directly in unit tests.  Queries the durable `inbox_items` SQLite table and
 * deserialises the stored JSON `evidence` column back to an object.
 */

import type { Store } from "../foundations/sqlite-store.ts";

type InboxItemRow = {
  id: string;
  kind: string;
  status: string;
  created_at: number;
  evidence: string;
};

export interface ListedInboxItem {
  id: string;
  kind: string;
  status: string;
  created_at: number;
  evidence: Record<string, unknown>;
}

/**
 * Return all open inbox items from the durable store, parsing each row's
 * `evidence` JSON column into a plain object.
 *
 * Returns an empty array when the `inbox_items` table does not yet exist (no
 * items have been created in this session).
 */
export function listOpenInboxItems(store: Store): ListedInboxItem[] {
  const columns = store.all<{ name: string }>("PRAGMA table_info(inbox_items)");
  if (columns.length === 0) return [];

  const rows = store.all<InboxItemRow>(
    `SELECT id, kind, status, created_at, evidence
     FROM inbox_items
     WHERE status = 'open'
     ORDER BY created_at ASC`,
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    created_at: row.created_at,
    evidence: JSON.parse(row.evidence) as Record<string, unknown>,
  }));
}
