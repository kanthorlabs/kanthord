import type { Store } from "../foundations/sqlite-store.ts";

export interface InteractionLogReader {
  readAll(): Promise<unknown[]>;
}

type ConfirmedType =
  | "approval"
  | "clarification"
  | "correction"
  | "rework"
  | "takeover"
  | "external";

type FeatureSummary = {
  featureId: string;
  headline: number;
  byConfirmedType: Record<ConfirmedType, number>;
  excluded: number;
  netCost: number;
};

const confirmedTypes: ReadonlySet<string> = new Set<ConfirmedType>([
  "approval",
  "clarification",
  "correction",
  "rework",
  "takeover",
  "external",
]);

export async function getFeatureSummary(
  featureId: string,
  deps: { interactionLog: InteractionLogReader; store: Store },
): Promise<FeatureSummary> {
  const byConfirmedType: Record<ConfirmedType, number> = {
    approval: 0,
    clarification: 0,
    correction: 0,
    rework: 0,
    takeover: 0,
    external: 0,
  };
  let headline = 0;
  let excluded = 0;

  for (const event of await deps.interactionLog.readAll()) {
    if (typeof event !== "object" || event === null) continue;
    const record = event as Record<string, unknown>;
    if (record["feature_id"] !== featureId) continue;
    if (record["excluded_from_automation_metric"] === true) {
      excluded++;
      continue;
    }
    headline++;
    const category = record["confirmed_category"];
    if (typeof category === "string" && confirmedTypes.has(category)) {
      byConfirmedType[category as ConfirmedType]++;
    }
  }

  const taskRows = deps.store.all<{ node_id: string }>(
    "SELECT node_id FROM scheduler_task WHERE feature_id = ?",
    featureId,
  );
  let netCost = 0;
  for (const task of taskRows) {
    const spend = deps.store.get<{ ledger: string }>(
      "SELECT ledger FROM budget_ledger WHERE task_id = ?",
      `spend:${task.node_id}`,
    );
    if (spend !== undefined) {
      const liveCost = Number(spend.ledger);
      if (Number.isFinite(liveCost)) netCost += liveCost;
      continue;
    }

    const ledger = deps.store.get<{ ledger: string }>(
      "SELECT ledger FROM budget_ledger WHERE task_id = ?",
      task.node_id,
    );
    if (ledger !== undefined) netCost += netLedgerCost(ledger.ledger);
  }

  return { featureId, headline, byConfirmedType, excluded, netCost };
}

function netLedgerCost(serialized: string): number {
  const entries = JSON.parse(serialized) as unknown;
  if (!Array.isArray(entries)) return 0;

  const reconciled = new Map<string, number>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      record["kind"] === "reconcile" &&
      typeof record["reservationId"] === "string" &&
      typeof record["finalActual"] === "number"
    ) {
      reconciled.set(record["reservationId"], record["finalActual"]);
    }
  }

  let total = 0;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      record["kind"] === "reservation" &&
      typeof record["reservationId"] === "string" &&
      typeof record["conservativeCharge"] === "number"
    ) {
      total += reconciled.get(record["reservationId"]) ?? record["conservativeCharge"];
    }
  }
  return total;
}
