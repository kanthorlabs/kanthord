import { newId, ID_PREFIX } from "../foundations/id.ts";
import type { Store } from "../foundations/sqlite-store.ts";

export interface TimelineEvent {
  event_id: string;
  task_id: string;
  attempt: number;
  session_id?: string;
  correlation_id: string;
  kind: string;
  ts: number;
  observed_failure_signal?: string;
  summary?: string;
  suspected_root_cause?: string;
  root_cause_confidence?: string;
  /** Stable surrogate FK linking a model_call timeline event to its model_call_log row (S6). */
  call_id?: string;
  /** index signature so callers can cast to Record<string, unknown> */
  [key: string]: unknown;
}

export function initTaskTimelineSchema(store: Store): void {
  store.run(`
    CREATE TABLE IF NOT EXISTS task_timeline_event (
      event_id          TEXT    NOT NULL PRIMARY KEY,
      task_id           TEXT    NOT NULL,
      attempt           INTEGER NOT NULL,
      session_id        TEXT,
      correlation_id    TEXT    NOT NULL,
      kind              TEXT    NOT NULL,
      ts                INTEGER NOT NULL,
      observed_failure_signal TEXT,
      summary           TEXT,
      suspected_root_cause    TEXT,
      root_cause_confidence   TEXT,
      call_id           TEXT
    )
  `);
  store.run(
    "CREATE INDEX IF NOT EXISTS idx_tte_task_event ON task_timeline_event (task_id, event_id)",
  );
  // PRAGMA guards for tables created before these columns existed
  const cols = store.all(
    "PRAGMA table_info(task_timeline_event)",
  ) as { name: string }[];
  if (!cols.some((c) => c.name === "suspected_root_cause")) {
    store.run(
      "ALTER TABLE task_timeline_event ADD COLUMN suspected_root_cause TEXT",
    );
  }
  if (!cols.some((c) => c.name === "root_cause_confidence")) {
    store.run(
      "ALTER TABLE task_timeline_event ADD COLUMN root_cause_confidence TEXT",
    );
  }
  if (!cols.some((c) => c.name === "call_id")) {
    store.run(
      "ALTER TABLE task_timeline_event ADD COLUMN call_id TEXT",
    );
  }
}

export function appendTimelineEvent(
  store: Store,
  opts: Omit<TimelineEvent, "event_id">,
): void {
  const event_id = newId(ID_PREFIX.event);
  store.run(
    `INSERT INTO task_timeline_event
      (event_id, task_id, attempt, session_id, correlation_id, kind, ts,
       observed_failure_signal, summary, suspected_root_cause, root_cause_confidence,
       call_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event_id,
    opts.task_id,
    opts.attempt,
    opts.session_id ?? null,
    opts.correlation_id,
    opts.kind,
    opts.ts,
    opts.observed_failure_signal ?? null,
    opts.summary ?? null,
    opts.suspected_root_cause ?? null,
    opts.root_cause_confidence ?? null,
    opts.call_id ?? null,
  );
}

export function readTimelineEvents(
  store: Store,
  task_id: string,
): TimelineEvent[] {
  return store.all<TimelineEvent>(
    `SELECT event_id, task_id, attempt, session_id, correlation_id, kind, ts,
            observed_failure_signal, summary, suspected_root_cause, root_cause_confidence,
            call_id
     FROM task_timeline_event
     WHERE task_id = ?
     ORDER BY ts ASC`,
    task_id,
  );
}
