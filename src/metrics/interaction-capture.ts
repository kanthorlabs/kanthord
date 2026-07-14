import type { JsonlLog } from "../foundations/jsonl.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { appendTimelineEvent } from "./task-timeline.ts";

export type InteractionCategory =
  | "approval"
  | "clarification"
  | "correction"
  | "rework"
  | "takeover"
  | "external";

const VOCABULARY: ReadonlySet<string> = new Set<InteractionCategory>([
  "approval",
  "clarification",
  "correction",
  "rework",
  "takeover",
  "external",
]);

export const SIGNAL_MAP: Record<string, InteractionCategory> = {
  "approval-tier-verb": "approval",
  "budget-breach": "correction",
  "scope-violation": "correction",
  "diff-review": "approval",
  "secret-scan": "correction",
  "verb-timeout": "rework",
  "verb-reconcile": "correction",
  "ring-2-verdict": "approval",
  "deploy-observer-fail": "external",
};

export class MissingCategoryError extends Error {
  constructor() {
    super("confirmed_category is required");
    this.name = "MissingCategoryError";
  }
}

export class InvalidCategoryError extends Error {
  constructor(category: string) {
    super(`confirmed_category '${category}' is not in the interaction vocabulary`);
    this.name = "InvalidCategoryError";
  }
}

export function validateConfirmedCategory(
  confirmedCategory: string,
): asserts confirmedCategory is InteractionCategory {
  if (confirmedCategory === "") {
    throw new MissingCategoryError();
  }
  if (!VOCABULARY.has(confirmedCategory)) {
    throw new InvalidCategoryError(confirmedCategory);
  }
}

export interface RecordInteractionOpts {
  item_id: string;
  task_id: string;
  feature_id: string;
  signal: string;
  confirmed_category: string;
  actor: string;
  timestamp: number;
  cost_to_date: number;
  no_ledger: boolean;
  log: JsonlLog;
  tags?: string[];
  store?: Store;
  correlation_id?: string;
  attempt?: number;
}

export type InteractionEvent = Record<string, unknown>;

export interface InteractionRequestFingerprint {
  action: string;
  confirmed_category: InteractionCategory;
}

export class InteractionIntentConflictError extends Error {
  constructor(itemId: string) {
    super(`interaction intent for inbox item "${itemId}" conflicts with its original response`);
    this.name = "InteractionIntentConflictError";
  }
}

const projectionQueues = new WeakMap<Store, Promise<void>>();

export function buildInteractionEvent(
  opts: Omit<RecordInteractionOpts, "log" | "store" | "correlation_id" | "attempt">,
): InteractionEvent {
  const {
    item_id,
    task_id,
    feature_id,
    signal,
    confirmed_category,
    actor,
    timestamp,
    cost_to_date,
    no_ledger,
    tags,
  } = opts;

  validateConfirmedCategory(confirmed_category);

  const proposed_type: InteractionCategory | undefined = SIGNAL_MAP[signal];
  const classification_mode: "accept" | "override" =
    confirmed_category === proposed_type ? "accept" : "override";

  const excluded_from_automation_metric =
    Array.isArray(tags) && tags.includes("unclassified-artifact-change")
      ? true
      : undefined;

  return {
    item_id,
    task_id,
    feature_id,
    signal,
    proposed_type: proposed_type ?? null,
    confirmed_category,
    classification_mode,
    actor,
    timestamp,
    cost_to_date,
    no_ledger,
    ...(excluded_from_automation_metric !== undefined
      ? { excluded_from_automation_metric }
      : {}),
  };
}

export function initInteractionCaptureSchema(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS interaction_outbox (
       item_id TEXT PRIMARY KEY,
       event_json TEXT NOT NULL,
       request_fingerprint TEXT,
       projected_at INTEGER
      )`,
  );

  const columns = store.all<{ name: string }>("PRAGMA table_info(interaction_outbox)");
  if (!columns.some((column) => column.name === "request_fingerprint")) {
    store.run("ALTER TABLE interaction_outbox ADD COLUMN request_fingerprint TEXT");
  }
  store.run(
    `UPDATE interaction_outbox
     SET request_fingerprint = 'legacy:' || item_id
     WHERE request_fingerprint IS NULL`,
  );
  store.run(
    `CREATE TRIGGER IF NOT EXISTS interaction_outbox_fingerprint_immutable
     BEFORE UPDATE OF request_fingerprint ON interaction_outbox
     WHEN OLD.request_fingerprint IS NOT NEW.request_fingerprint
     BEGIN SELECT RAISE(ABORT, 'interaction outbox request fingerprint is immutable'); END`,
  );
}

export function persistInteractionIntent(
  store: Store,
  itemId: string,
  event: InteractionEvent,
  fingerprint: InteractionRequestFingerprint,
): { created: boolean } {
  const requestFingerprint = JSON.stringify(fingerprint);
  const existing = store.get<{ request_fingerprint: string | null }>(
    "SELECT request_fingerprint FROM interaction_outbox WHERE item_id = ?",
    itemId,
  );
  if (existing !== undefined) {
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new InteractionIntentConflictError(itemId);
    }
    return { created: false };
  }

  store.run(
    `INSERT INTO interaction_outbox (item_id, event_json, request_fingerprint, projected_at)
     VALUES (?, ?, ?, NULL)`,
    itemId,
    JSON.stringify(event),
    requestFingerprint,
  );
  return { created: true };
}

export async function projectPendingInteractionIntents(
  store: Store,
  log: JsonlLog,
  projectedAt: number,
): Promise<void> {
  const prior = projectionQueues.get(store) ?? Promise.resolve();
  const projection = prior.then(() => projectPendingInteractionIntentsNow(store, log, projectedAt));
  projectionQueues.set(store, projection.catch(() => undefined));
  return projection;
}

async function projectPendingInteractionIntentsNow(
  store: Store,
  log: JsonlLog,
  projectedAt: number,
): Promise<void> {
  const pending = store.all<{ item_id: string; event_json: string }>(
    "SELECT item_id, event_json FROM interaction_outbox WHERE projected_at IS NULL ORDER BY item_id",
  );
  if (pending.length === 0) return;

  const presentItemIds = interactionItemIds(await log.readAll());
  for (const intent of pending) {
    if (!presentItemIds.has(intent.item_id)) {
      await log.append(JSON.parse(intent.event_json) as InteractionEvent);
      const confirmedItemIds = interactionItemIds(await log.readAll());
      if (!confirmedItemIds.has(intent.item_id)) {
        throw new Error(`interaction intent ${intent.item_id} was not found after JSONL append`);
      }
      presentItemIds.add(intent.item_id);
    }
    store.run(
      "UPDATE interaction_outbox SET projected_at = ? WHERE item_id = ? AND projected_at IS NULL",
      projectedAt,
      intent.item_id,
    );
  }
}

function interactionItemIds(records: unknown[]): Set<string> {
  const itemIds = new Set<string>();
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const itemId = (record as Record<string, unknown>)["item_id"];
    if (typeof itemId === "string") itemIds.add(itemId);
  }
  return itemIds;
}

export async function recordInteraction(opts: RecordInteractionOpts): Promise<void> {
  const { log, store, correlation_id, attempt } = opts;
  await log.append(buildInteractionEvent(opts));

  if (store !== undefined && correlation_id !== undefined) {
    appendTimelineEvent(store, {
      task_id: opts.task_id,
      attempt: attempt ?? 1,
      correlation_id,
      kind: "interaction",
      ts: opts.timestamp,
      summary: opts.signal,
    });
  }
}

export async function queryInteractionsByFeature(
  log: JsonlLog,
  feature_id: string,
): Promise<unknown[]> {
  const all = await log.readAll();
  return all.filter((record) => {
    if (typeof record !== "object" || record === null) return false;
    return (record as Record<string, unknown>)["feature_id"] === feature_id;
  });
}
