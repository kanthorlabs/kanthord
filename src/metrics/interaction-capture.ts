import type { JsonlLog } from "../foundations/jsonl.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { initTaskTimelineSchema, appendTimelineEvent } from "./task-timeline.ts";

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

export async function recordInteraction(opts: RecordInteractionOpts): Promise<void> {
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
    log,
    tags,
    store,
    correlation_id,
    attempt,
  } = opts;

  if (confirmed_category === "") {
    throw new MissingCategoryError();
  }
  if (!VOCABULARY.has(confirmed_category)) {
    throw new InvalidCategoryError(confirmed_category);
  }

  const proposed_type: InteractionCategory | undefined = SIGNAL_MAP[signal];
  const classification_mode: "accept" | "override" =
    confirmed_category === proposed_type ? "accept" : "override";

  const excluded_from_automation_metric =
    Array.isArray(tags) && tags.includes("unclassified-artifact-change")
      ? true
      : undefined;

  await log.append({
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
  });

  if (store !== undefined && correlation_id !== undefined) {
    initTaskTimelineSchema(store);
    appendTimelineEvent(store, {
      task_id,
      attempt: attempt ?? 1,
      correlation_id,
      kind: "interaction",
      ts: timestamp,
      summary: signal,
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
