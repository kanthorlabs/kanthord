import { newId, ID_PREFIX } from "../foundations/id.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { appendTimelineEvent } from "./task-timeline.ts";

export interface ModelCallRecord {
  call_id: string;
  task_id: string;
  attempt: number;
  session_id: string;
  account_id: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  latency_ms: number;
  stop_reason: string;
  typed_error?: string;
  correlation_id: string;
}

export function initModelCallLogSchema(store: Store): void {
  store.run(`
    CREATE TABLE IF NOT EXISTS model_call_log (
      call_id        TEXT    NOT NULL PRIMARY KEY,
      task_id        TEXT    NOT NULL,
      attempt        INTEGER NOT NULL,
      session_id     TEXT    NOT NULL,
      account_id     TEXT    NOT NULL,
      model          TEXT    NOT NULL,
      tokens_in      INTEGER NOT NULL,
      tokens_out     INTEGER NOT NULL,
      cost           REAL    NOT NULL,
      latency_ms     INTEGER NOT NULL,
      stop_reason    TEXT    NOT NULL,
      typed_error    TEXT,
      correlation_id TEXT    NOT NULL,
      ts             INTEGER NOT NULL
    )
  `);
  store.run(
    "CREATE INDEX IF NOT EXISTS idx_mcl_task ON model_call_log (task_id, ts ASC)",
  );
}

export function appendModelCallRecord(
  store: Store,
  opts: Omit<ModelCallRecord, "call_id">,
): void {
  const call_id = newId(ID_PREFIX.call);
  const ts = Date.now();

  store.run(
    `INSERT INTO model_call_log
      (call_id, task_id, attempt, session_id, account_id, model,
       tokens_in, tokens_out, cost, latency_ms, stop_reason, typed_error,
       correlation_id, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    call_id,
    opts.task_id,
    opts.attempt,
    opts.session_id,
    opts.account_id,
    opts.model,
    opts.tokens_in,
    opts.tokens_out,
    opts.cost,
    opts.latency_ms,
    opts.stop_reason,
    opts.typed_error ?? null,
    opts.correlation_id,
    ts,
  );

  // Also write a task_timeline_event row (kind="model_call") so the timeline
  // reconstruction includes per-model-call detail. The call_id FK links the
  // timeline event to the model_call_log row for the enriched JOIN (S6).
  appendTimelineEvent(store, {
    task_id: opts.task_id,
    attempt: opts.attempt,
    session_id: opts.session_id,
    correlation_id: opts.correlation_id,
    kind: "model_call",
    ts,
    call_id,
    summary: `model=${opts.model} account=${opts.account_id} tokens=${opts.tokens_in}+${opts.tokens_out} stop=${opts.stop_reason}`,
  });
}

export function queryModelCallLog(
  store: Store,
  task_id: string,
): ModelCallRecord[] {
  return store.all<ModelCallRecord>(
    `SELECT call_id, task_id, attempt, session_id, account_id, model,
            tokens_in, tokens_out, cost, latency_ms, stop_reason, typed_error,
            correlation_id
     FROM model_call_log
     WHERE task_id = ?
     ORDER BY ts ASC`,
    task_id,
  );
}
