/**
 * src/metrics/timeline-query.ts
 *
 * Story 005 T1 (Epic 019.5) — enriched task timeline query.
 *
 * Design: two-query approach (no JOIN).
 *   Query 1: single-table scan of task_timeline_event with optional paging.
 *   Query 2: per-page enrichment — fetch account_id + model for model_call events
 *            from model_call_log via their call_id FK (stable surrogate key, S6).
 *
 * Defaults: order = "desc" (newest event_id first), limit = 100.
 */

import type { Store } from "../foundations/sqlite-store.ts";
import type { TimelineEvent } from "./task-timeline.ts";

export interface EnrichedTimelineEvent extends TimelineEvent {
  account_id?: string | null;
  model?: string | null;
}

export function queryTaskTimeline(
  store: Store,
  taskId: string,
  opts?: {
    failuresOnly?: boolean;
    limit?: number;
    /** Cursor: return only events strictly beyond this event_id in sort order. */
    before?: string;
    order?: "asc" | "desc";
  },
): EnrichedTimelineEvent[] {
  const order = opts?.order ?? "desc";
  const limit = opts?.limit ?? 100;

  const params: unknown[] = [taskId];

  let sql =
    `SELECT event_id, task_id, attempt, session_id, correlation_id,
            kind, ts, observed_failure_signal, summary,
            suspected_root_cause, root_cause_confidence, call_id
     FROM task_timeline_event
     WHERE task_id = ?`;

  if (opts?.failuresOnly === true) {
    sql += ` AND observed_failure_signal IS NOT NULL`;
  }

  if (opts?.before !== undefined) {
    sql += order === "desc" ? ` AND event_id < ?` : ` AND event_id > ?`;
    params.push(opts.before);
  }

  sql += ` ORDER BY event_id ${order === "desc" ? "DESC" : "ASC"} LIMIT ?`;
  params.push(limit);

  const page = store.all<EnrichedTimelineEvent>(sql, ...params);

  // Collect call_ids from model_call events on this page only.
  const modelCallIds: string[] = [];
  for (const ev of page) {
    if (ev.kind === "model_call") {
      const cid = ev.call_id;
      if (typeof cid === "string" && cid.length > 0) {
        modelCallIds.push(cid);
      }
    }
  }

  // Skip the second query entirely when the page has no model_call events.
  if (modelCallIds.length === 0) {
    return page;
  }

  const placeholders = modelCallIds.map(() => "?").join(", ");
  const callRecords = store.all<{ call_id: string; account_id: string; model: string }>(
    `SELECT call_id, account_id, model FROM model_call_log WHERE call_id IN (${placeholders})`,
    ...modelCallIds,
  );

  const callMap = new Map<string, { account_id: string; model: string }>();
  for (const rec of callRecords) {
    callMap.set(rec.call_id, { account_id: rec.account_id, model: rec.model });
  }

  // Merge enrichment onto model_call events in-place.
  for (const ev of page) {
    if (ev.kind === "model_call") {
      const cid = ev.call_id;
      if (typeof cid === "string") {
        const enrichment = callMap.get(cid);
        if (enrichment !== undefined) {
          ev.account_id = enrichment.account_id;
          ev.model = enrichment.model;
        }
      }
    }
  }

  return page;
}
