/**
 * inbox-respond — Story 017-002 Task T2.
 *
 * Escalation response functions: resume (re-dispatch) and halt.
 * Each response is journaled with actor+timestamp in `escalation_responses`,
 * updates the scheduler task status, and resolves the inbox item as durable
 * state (never recomputed away on restart — debate finding).
 */

import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";

function ensureEscalationResponsesTable(store: Store): void {
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

function resolveInboxItem(store: Store, itemId: string): void {
  store.run(
    "UPDATE inbox_items SET status = 'resolved' WHERE id = ?",
    itemId,
  );
}

function journalEscalationResponse(
  store: Store,
  itemId: string,
  taskId: string,
  actor: string,
  action: string,
  respondedAt: number,
): void {
  store.run(
    `INSERT OR IGNORE INTO escalation_responses
       (item_id, task_id, actor, action, responded_at)
     VALUES (?, ?, ?, ?, ?)`,
    itemId,
    taskId,
    actor,
    action,
    respondedAt,
  );
}

/**
 * Record a "resume" response to an escalation item.
 * Sets the blocked scheduler task back to `pending` (blocked_on cleared)
 * so the scheduler can re-dispatch it.
 */
export function resumeEscalationItem(opts: {
  item_id: string;
  task_id: string;
  actor: string;
  store: Store;
  clock: Clock;
}): void {
  const { item_id, task_id, actor, store, clock } = opts;
  ensureEscalationResponsesTable(store);

  journalEscalationResponse(store, item_id, task_id, actor, "resume", clock.now());

  store.run(
    "UPDATE scheduler_task SET status = 'pending', blocked_on = NULL WHERE node_id = ?",
    task_id,
  );

  resolveInboxItem(store, item_id);
}

/**
 * Record a "halt" response to an escalation item.
 * Sets the blocked scheduler task to `halted` — it will not be re-dispatched.
 */
export function haltEscalationItem(opts: {
  item_id: string;
  task_id: string;
  actor: string;
  store: Store;
  clock: Clock;
}): void {
  const { item_id, task_id, actor, store, clock } = opts;
  ensureEscalationResponsesTable(store);

  journalEscalationResponse(store, item_id, task_id, actor, "halt", clock.now());

  store.run(
    "UPDATE scheduler_task SET status = 'halted' WHERE node_id = ?",
    task_id,
  );

  resolveInboxItem(store, item_id);
}
