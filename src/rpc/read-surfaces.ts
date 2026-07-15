/**
 * src/rpc/read-surfaces.ts
 *
 * Story 001 – Read Surfaces · Task T1.
 * Exports listFeatures, getFeature, listBrokerOperations, listBrokerVerbs.
 * All store-accessing methods use only store.get / store.all (zero writes).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "../foundations/sqlite-store.ts";
import type { LeafLogger } from "../foundations/log.ts";
import { queryTaskTimeline, type EnrichedTimelineEvent } from "../metrics/timeline-query.ts";

// ---------------------------------------------------------------------------
// Public deps contracts
// ---------------------------------------------------------------------------

export interface ReadSurfacesDeps {
  store: Store;
  featureDataRoot: string;
  nowMs: number;
  verbRegistry: Array<{ verb: string; tier: string; pending_expiry_ms?: number }>;
  logger?: LeafLogger;
}

/** Extended deps for Task T2 surfaces (slots, budgets, daemon-ops). */
export interface ExtendedReadSurfacesDeps extends ReadSurfacesDeps {
  slotRegistry: Array<{
    name: string;
    repo: string;
    strategy: string;
    heldLeases: string[];
    activeSessions: string[];
  }>;
  getBudgetCeiling: (taskId: string) => number;
  daemonVersion: string;
  uptimeFn: () => number;
  verifyFn: () => Promise<{ outcome: string; reportJson: string }>;
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

type EpicRow = { id: string; feature_id: string; slug: string | null };
type StoryRow = { id: string; feature_id: string };
type TaskRow = { id: string; feature_id: string };
type SchedulerTaskRow = {
  node_id: string;
  feature_id: string;
  status: string;
  exit_gate_passed: number;
};
type PlanEdgeRow = { from_node_id: string; to_node_id: string };
type BrokerInFlightRow = {
  op_id: string;
  verb: string;
  idempotency_key: string;
  payload_json: string | null;
  status: string;
};
type BrokerPendingRow = {
  op_id: string;
  verb: string;
  idempotency_key: string;
  pending_at: number;
  status: string;
};

// ---------------------------------------------------------------------------
// Expiry threshold — ops within this many ms of their deadline are "expiring"
// ---------------------------------------------------------------------------

const EXPIRY_THRESHOLD_MS = 30_000;

// ---------------------------------------------------------------------------
// listFeatures
// ---------------------------------------------------------------------------

export function listFeatures(deps: ReadSurfacesDeps): {
  features: Array<{
    featureId: string;
    name: string;
    status: string;
    phase: string;
    progressSummary: string;
  }>;
} {
  const { store } = deps;

  const epics = store.all<EpicRow>(
    "SELECT id, feature_id, slug FROM plan_node WHERE kind = 'epic'",
  );

  const features = epics.map((epic) => {
    const tasks = store.all<SchedulerTaskRow>(
      "SELECT node_id, feature_id, status, exit_gate_passed FROM scheduler_task WHERE feature_id = ?",
      epic.feature_id,
    );

    const totalTasks = tasks.length;
    const satisfiedTasks = tasks.filter((t) => t.exit_gate_passed === 1).length;
    const hasPendingTasks = tasks.some((t) => t.status === "pending");

    return {
      featureId: epic.feature_id,
      // N1: use slug when stored, fall back to feature_id (epic nodes always have NULL slug in the compiler)
      name: epic.slug !== null ? epic.slug : epic.feature_id,
      status: hasPendingTasks ? "in_progress" : "done",
      phase: hasPendingTasks ? "coding" : "done",
      progressSummary: `${satisfiedTasks}/${totalTasks} tasks satisfied`,
    };
  });

  return { features };
}

// ---------------------------------------------------------------------------
// getFeature
// ---------------------------------------------------------------------------

export async function getFeature(
  featureId: string,
  deps: ReadSurfacesDeps,
): Promise<{
  featureId: string;
  status: string;
  phase: string;
  stories: Array<{
    storyId: string;
    tasks: Array<{ taskId: string; status: string; exitGatePassed: boolean }>;
  }>;
  dag: {
    totalNodes: number;
    satisfiedNodes: number;
    totalEdges: number;
    satisfiedEdges: number;
  };
  inFlightOps: Array<{
    opId: string;
    verb: string;
    state: string;
    correlation: string;
  }>;
  stateView: string;
  journalView: string;
}> {
  const { store, featureDataRoot } = deps;

  // Story and task nodes for this feature.
  const storyNodes = store.all<StoryRow>(
    "SELECT id, feature_id FROM plan_node WHERE kind = 'story' AND feature_id = ?",
    featureId,
  );
  const taskNodes = store.all<TaskRow>(
    "SELECT id, feature_id FROM plan_node WHERE kind = 'task' AND feature_id = ?",
    featureId,
  );

  // Scheduler task status for this feature.
  const schedulerTasks = store.all<SchedulerTaskRow>(
    "SELECT node_id, feature_id, status, exit_gate_passed FROM scheduler_task WHERE feature_id = ?",
    featureId,
  );
  const taskStatusMap = new Map<string, SchedulerTaskRow>(
    schedulerTasks.map((st) => [st.node_id, st]),
  );

  // Set of task node IDs for edge filtering.
  const taskIdSet = new Set(taskNodes.map((t) => t.id));

  // Group tasks under stories by id prefix (task.id starts with story.id + "/").
  const stories = storyNodes.map((story) => {
    const storyTasks = taskNodes
      .filter((t) => t.id.startsWith(`${story.id}/`))
      .map((t) => {
        const st = taskStatusMap.get(t.id);
        return {
          taskId: t.id,
          status: st?.status ?? "pending",
          exitGatePassed: (st?.exit_gate_passed ?? 0) === 1,
        };
      });
    return { storyId: story.id, tasks: storyTasks };
  });

  // DAG edges within this feature (task-to-task edges only).
  const allEdges = store.all<PlanEdgeRow>(
    `SELECT from_node_id, to_node_id FROM plan_edge
     WHERE from_node_id IN (SELECT id FROM plan_node WHERE feature_id = ?)
        OR to_node_id   IN (SELECT id FROM plan_node WHERE feature_id = ?)`,
    featureId,
    featureId,
  );
  const featureEdges = allEdges.filter(
    (e) => taskIdSet.has(e.from_node_id) && taskIdSet.has(e.to_node_id),
  );

  const satisfiedNodes = schedulerTasks.filter((t) => t.exit_gate_passed === 1).length;
  const satisfiedEdges = featureEdges.filter((e) => {
    const fromTask = taskStatusMap.get(e.from_node_id);
    return fromTask !== undefined && fromTask.exit_gate_passed === 1;
  }).length;

  const hasPendingTasks = schedulerTasks.some((t) => t.status === "pending");

  // In-flight broker ops for this feature (feature_id encoded in payload_json).
  const allInflight = store.all<BrokerInFlightRow>(
    "SELECT op_id, verb, idempotency_key, payload_json, status FROM broker_in_flight",
  );
  const inFlightOps = allInflight
    .filter((op) => {
      if (op.payload_json === null) return false;
      try {
        const payload = JSON.parse(op.payload_json) as { feature_id?: string };
        return payload.feature_id === featureId;
      } catch (err) {
        deps.logger?.warn("broker.payload.parse-error", { opId: op.op_id, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
    })
    .map((op) => ({
      opId: op.op_id,
      verb: op.verb,
      state: op.status,
      correlation: op.idempotency_key,
    }));

  // Filesystem content views.
  const featureDir = join(featureDataRoot, featureId);
  const stateView = await readFile(join(featureDir, "STATE.md"), "utf8");
  const journalView = await readFile(join(featureDir, "JOURNAL.md"), "utf8");

  return {
    featureId,
    status: hasPendingTasks ? "in_progress" : "done",
    phase: hasPendingTasks ? "coding" : "done",
    stories,
    dag: {
      totalNodes: taskNodes.length,
      satisfiedNodes,
      totalEdges: featureEdges.length,
      satisfiedEdges,
    },
    inFlightOps,
    stateView,
    journalView,
  };
}

// ---------------------------------------------------------------------------
// listBrokerOperations
// ---------------------------------------------------------------------------

export function listBrokerOperations(deps: ReadSurfacesDeps): {
  operations: Array<{
    opId: string;
    verb: string;
    state: string;
    correlation: string;
    featureId?: string;
    expiresAt?: number;
    expiring: boolean;
    reconciliationStatus: string;
  }>;
} {
  const { store, nowMs, verbRegistry } = deps;

  // Build verb → pending_expiry_ms lookup from registry.
  const verbExpiryMap = new Map<string, number>();
  for (const entry of verbRegistry) {
    if (entry.pending_expiry_ms !== undefined) {
      verbExpiryMap.set(entry.verb, entry.pending_expiry_ms);
    }
  }

  // In-flight ops.
  const inflightRows = store.all<BrokerInFlightRow>(
    "SELECT op_id, verb, idempotency_key, payload_json, status FROM broker_in_flight",
  );
  const inflightOps = inflightRows.map((op) => {
    let featureId: string | undefined;
    if (op.payload_json !== null) {
      try {
        const payload = JSON.parse(op.payload_json) as { feature_id?: string };
        featureId = payload.feature_id;
      } catch (err) {
        deps.logger?.warn("broker.payload.parse-error", { opId: op.op_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return {
      opId: op.op_id,
      verb: op.verb,
      state: op.status,
      correlation: op.idempotency_key,
      featureId,
      expiring: false,
      // N5: surface reconciliation status when the op is in needs_reconciliation state
      reconciliationStatus: op.status === "needs_reconciliation" ? "needs_reconciliation" : "",
    };
  });

  // Pending ops.
  const pendingRows = store.all<BrokerPendingRow>(
    "SELECT op_id, verb, idempotency_key, pending_at, status FROM broker_pending",
  );
  const pendingOps = pendingRows.map((op) => {
    const expiryMs = verbExpiryMap.get(op.verb);
    let expiring = false;
    let expiresAt: number | undefined;
    if (expiryMs !== undefined) {
      expiresAt = op.pending_at + expiryMs;
      const timeToDeadline = expiresAt - nowMs;
      expiring = timeToDeadline < EXPIRY_THRESHOLD_MS;
    }
    return {
      opId: op.op_id,
      verb: op.verb,
      state: op.status,
      correlation: op.idempotency_key,
      expiresAt,
      expiring,
      // N5: pending ops carry no reconciliation state
      reconciliationStatus: "",
    };
  });

  return { operations: [...inflightOps, ...pendingOps] };
}

// ---------------------------------------------------------------------------
// listBrokerVerbs
// ---------------------------------------------------------------------------

export function listBrokerVerbs(deps: ReadSurfacesDeps): {
  verbs: Array<{ verb: string; tier: string }>;
} {
  return {
    verbs: deps.verbRegistry.map((v) => ({ verb: v.verb, tier: v.tier })),
  };
}

// ---------------------------------------------------------------------------
// listSlots — pure projection of deps.slotRegistry; zero writes
// ---------------------------------------------------------------------------

export function listSlots(deps: ExtendedReadSurfacesDeps): {
  slots: Array<{
    name: string;
    repo: string;
    strategy: string;
    heldLeases: string[];
    activeSessions: string[];
  }>;
} {
  return {
    slots: deps.slotRegistry.map((s) => ({
      name: s.name,
      repo: s.repo,
      strategy: s.strategy,
      heldLeases: s.heldLeases,
      activeSessions: s.activeSessions,
    })),
  };
}

// ---------------------------------------------------------------------------
// getBudget — reads budget_ledger, computes spent/ceiling/breakerState/override
// Zero writes.
// ---------------------------------------------------------------------------

interface BudgetLedgerRow {
  ledger: string;
}

type LedgerEntry =
  | { kind: "reservation"; reservationId: string; conservativeCharge: number }
  | { kind: "reconcile"; reservationId: string; finalActual: number }
  | { kind: "override"; amount: number; reason: string; actor: string };

function computeSpent(entries: LedgerEntry[]): number {
  const reconciled = new Map<string, number>();
  for (const e of entries) {
    if (e.kind === "reconcile") {
      reconciled.set(e.reservationId, e.finalActual);
    }
  }
  let total = 0;
  for (const e of entries) {
    if (e.kind === "reservation") {
      const finalActual = reconciled.get(e.reservationId);
      total += finalActual !== undefined ? finalActual : e.conservativeCharge;
    }
  }
  return total;
}

export async function getBudget(
  taskId: string,
  deps: ExtendedReadSurfacesDeps,
): Promise<{
  taskId: string;
  spent: number;
  ceiling: number;
  breakerState: "closed" | "open";
  override: { present: boolean; amount?: number; reason?: string; actor?: string };
}> {
  const { store, getBudgetCeiling } = deps;
  const row = store.get<BudgetLedgerRow>(
    "SELECT ledger FROM budget_ledger WHERE task_id = ?",
    taskId,
  );

  const entries: LedgerEntry[] = row !== undefined
    ? (JSON.parse(row.ledger) as LedgerEntry[])
    : [];

  const spent = computeSpent(entries);
  const ceiling = getBudgetCeiling(taskId);
  const breakerState: "closed" | "open" = spent < ceiling ? "closed" : "open";

  const overrideEntry = entries.find((e): e is Extract<LedgerEntry, { kind: "override" }> =>
    e.kind === "override",
  );

  const override: { present: boolean; amount?: number; reason?: string; actor?: string } =
    overrideEntry !== undefined
      ? { present: true, amount: overrideEntry.amount, reason: overrideEntry.reason, actor: overrideEntry.actor }
      : { present: false };

  return { taskId, spent, ceiling, breakerState, override };
}

// ---------------------------------------------------------------------------
// getDaemonStatus — version, uptime, lastPing, lastVerify; zero writes
// ---------------------------------------------------------------------------

interface VerifyReportRow {
  outcome: string;
  report_json: string;
  ran_at: number;
}

export async function getDaemonStatus(deps: ExtendedReadSurfacesDeps): Promise<{
  version: string;
  uptimeSeconds: number;
  lastPing: { present: boolean };
  lastVerify: { present: boolean; outcome?: string; reportJson?: string; ranAt?: number };
}> {
  const { store, daemonVersion, uptimeFn } = deps;

  // dead_man_ping: return present: false when table is empty (Epic 029 not yet active).
  const pingRow = store.get<{ pinged_at: number }>(
    "SELECT pinged_at FROM dead_man_ping WHERE id = 'singleton'",
  );

  // verify_report: return present: false when no report stored.
  const verifyRow = store.get<VerifyReportRow>(
    "SELECT outcome, report_json, ran_at FROM verify_report WHERE id = 'singleton'",
  );

  return {
    version: daemonVersion,
    uptimeSeconds: uptimeFn(),
    lastPing: { present: pingRow !== undefined },
    lastVerify:
      verifyRow !== undefined
        ? {
            present: true,
            outcome: verifyRow.outcome,
            reportJson: verifyRow.report_json,
            ranAt: verifyRow.ran_at,
          }
        : { present: false },
  };
}

// ---------------------------------------------------------------------------
// triggerVerify — calls the injected verify engine, writes exactly one report
// record, returns the report.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getTaskTimeline — thin wiring over 019.5's queryTaskTimeline; zero writes
// ---------------------------------------------------------------------------

export function getTaskTimeline(
  taskId: string,
  deps: ReadSurfacesDeps,
  opts?: { failuresOnly?: boolean; limit?: number; before?: string; order?: "asc" | "desc" },
): EnrichedTimelineEvent[] {
  return queryTaskTimeline(deps.store, taskId, opts);
}

export async function triggerVerify(deps: ExtendedReadSurfacesDeps): Promise<{
  report: { present: boolean; outcome: string; reportJson: string; ranAt: number };
}> {
  const { store, verifyFn } = deps;

  const { outcome, reportJson } = await verifyFn();
  const ranAt = Date.now();

  // Single declared write: upsert the singleton report row.
  store.run(
    "INSERT OR REPLACE INTO verify_report (id, outcome, report_json, ran_at) VALUES ('singleton', ?, ?, ?)",
    outcome,
    reportJson,
    ranAt,
  );

  return { report: { present: true, outcome, reportJson, ranAt } };
}
