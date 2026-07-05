import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";
import { soakStage } from "./soak.ts";
import type { SoakStageNode, ObserverMap } from "./soak.ts";

/**
 * HandlerMap — maps observer name → handler function.
 * Unified with ObserverMap (soak.ts) — structurally identical; one canonical
 * definition lives in soak.ts and is re-exported here so chain.test.ts imports
 * continue to resolve (S1 type-unification).
 */
export type HandlerMap = ObserverMap;

/**
 * ObserverEvidence — captured detail when a handler or soak observer fails.
 * soakWindowHistory is present only when the failure came from the soak gate
 * (populated from SoakEvidence); absent on handler-gate failures.
 */
export type ObserverEvidence = {
  observer: string;
  value: unknown;
  clockInstant: number;
  stageId: string;
  soakWindowHistory?: Array<{
    clockInstant: number;
    results: Array<{ observer: string; healthy: boolean; value: unknown }>;
  }>;
};

/**
 * ChainOutcome — the resolved result of running the full deploy chain.
 * - "pass"              — every stage (handlers + soak) passed
 * - "halt_and_escalate" — a handler or soak observer failed; evidence attached
 */
export type ChainOutcome =
  | { result: "pass" }
  | { result: "halt_and_escalate"; evidence: ObserverEvidence };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export type StageResult =
  | { result: "pass" }
  | { result: "halt_and_escalate"; evidence: ObserverEvidence };

/**
 * parseSoakDurationMs — converts a human-readable duration string to ms.
 * Supported formats: "5m" → 300_000, "2m" → 120_000, "30s" → 30_000.
 * Returns 0 for unrecognised formats (soak is skipped).
 */
function parseSoakDurationMs(raw: string): number {
  const mMatch = /^(\d+)m$/.exec(raw);
  if (mMatch !== null) return parseInt(mMatch[1]!, 10) * 60_000;
  const sMatch = /^(\d+)s$/.exec(raw);
  if (sMatch !== null) return parseInt(sMatch[1]!, 10) * 1_000;
  return 0;
}

/** Default poll interval used when the plan does not specify one. */
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/**
 * runStage — invoke each declared handler in order (Phase 1 of stage lifecycle).
 * Returns "pass" if every handler is healthy, "halt_and_escalate" with
 * evidence on the first failing handler.
 */
async function runStage(
  stageId: string,
  handlersJson: string,
  handlerMap: HandlerMap,
  clock: Clock,
): Promise<StageResult> {
  const handlerDefs = JSON.parse(handlersJson) as Array<Record<string, string>>;

  for (const def of handlerDefs) {
    const observerName = def["observer"];
    if (observerName === undefined) continue;

    const handler = handlerMap.get(observerName);
    if (handler === undefined) continue;

    const outcome = await handler(stageId, clock);
    if (!outcome.healthy) {
      return {
        result: "halt_and_escalate",
        evidence: {
          observer: observerName,
          value: outcome.value,
          clockInstant: clock.now(),
          stageId,
        },
      };
    }
  }

  return { result: "pass" };
}

// ---------------------------------------------------------------------------
// runDeployNode — per-node deploy primitive (exported; shared by pollOnce + runChain)
//
// Loads stage metadata for a single deploy-stage node, drives the handler
// phase (runStage), then the soak phase if the plan declares a soak duration.
// Returns StageResult — "pass" or "halt_and_escalate" with evidence.
// ---------------------------------------------------------------------------

export async function runDeployNode(
  store: Store,
  nodeId: string,
  handlers: HandlerMap,
  clock: Clock,
): Promise<StageResult> {
  const stageData = store.get<{ handlers: string; soak_duration: string | null }>(
    "SELECT handlers, soak_duration FROM plan_deploy_stage WHERE node_id = ?",
    nodeId,
  );

  if (stageData === undefined) {
    throw new Error(
      `runDeployNode: no plan_deploy_stage row found for nodeId "${nodeId}"`,
    );
  }

  // Phase 1: handler gate.
  const handlerResult = await runStage(nodeId, stageData.handlers, handlers, clock);
  if (handlerResult.result === "halt_and_escalate") {
    return handlerResult;
  }

  // Phase 2: soak gate (skipped when soak_duration is 0 or absent).
  const soakDurationMs =
    stageData.soak_duration !== null
      ? parseSoakDurationMs(stageData.soak_duration)
      : 0;

  if (soakDurationMs > 0) {
    const handlerDefs = JSON.parse(stageData.handlers) as Array<{ observer: string }>;
    const stageNode: SoakStageNode = {
      nodeId,
      handlers: handlerDefs,
      soakDurationMs,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    };
    const soakResult = await soakStage(stageNode, handlers, clock);
    if (soakResult.result === "on_fail") {
      return {
        result: "halt_and_escalate",
        evidence: {
          observer: soakResult.evidence.observer,
          value: soakResult.evidence.value,
          clockInstant: soakResult.evidence.clockInstant,
          stageId: soakResult.evidence.stageId,
          soakWindowHistory: soakResult.evidence.soakWindowHistory,
        },
      };
    }
  }

  return { result: "pass" };
}

// ---------------------------------------------------------------------------
// runChain — public entry point (scheduler continuation seam)
// ---------------------------------------------------------------------------

/**
 * runChain — reads deploy-stage DAG nodes for `featureId` from the compiled
 * store, traverses them in DAG order (edge-driven, not index-driven), and for
 * each stage drives the unified stage lifecycle:
 *   1. handlers — invoke every declared handler in order (AND criteria)
 *   2. soak     — poll all handlers across the plan-declared soak window on the
 *                 injected fake clock (soakStage from Story 002)
 *   3. resolve  — continue to the next stage on full pass; halt on any failure
 *
 * The chain resolves:
 *   - "pass"              — every stage (handlers + soak) passed
 *   - "halt_and_escalate" — a handler or soak observer failed; chain stops
 */
export async function runChain(
  store: Store,
  featureId: string,
  handlers: HandlerMap,
  clock: Clock,
): Promise<ChainOutcome> {
  // 1. Load all deploy-stage nodes for this feature from the compiled store.
  const stageNodes = store.all<{ id: string }>(
    "SELECT id FROM plan_node WHERE feature_id = ? AND kind = 'deploy-stage'",
    featureId,
  );

  if (stageNodes.length === 0) {
    return { result: "pass" };
  }

  const stageIdArray = stageNodes.map((n) => n.id);
  const stageIdSet = new Set(stageIdArray);
  const placeholders = stageIdArray.map(() => "?").join(",");

  // 2. Load inter-stage edges (edges where both endpoints are deploy-stage nodes).
  const edges = store.all<{ from_node_id: string; to_node_id: string }>(
    `SELECT from_node_id, to_node_id FROM plan_edge WHERE from_node_id IN (${placeholders}) AND to_node_id IN (${placeholders})`,
    ...stageIdArray,
    ...stageIdArray,
  );

  // 3. Determine DAG order via incoming-edge counts across deploy-stage nodes.
  const nextMap = new Map<string, string>();
  const incomingCount = new Map<string, number>();
  for (const id of stageIdSet) {
    incomingCount.set(id, 0);
  }
  for (const edge of edges) {
    nextMap.set(edge.from_node_id, edge.to_node_id);
    const prior = incomingCount.get(edge.to_node_id) ?? 0;
    incomingCount.set(edge.to_node_id, prior + 1);
  }

  // 4. Find the root stage (no incoming edges from other deploy-stage nodes).
  let firstId: string | undefined;
  for (const [id, count] of incomingCount) {
    if (count === 0) {
      firstId = id;
      break;
    }
  }

  // 5. Walk the chain: delegate each stage to the per-node primitive.
  let current: string | undefined = firstId;
  while (current !== undefined && stageIdSet.has(current)) {
    const stageId = current;
    const stageResult = await runDeployNode(store, stageId, handlers, clock);
    if (stageResult.result === "halt_and_escalate") {
      return { result: "halt_and_escalate", evidence: stageResult.evidence };
    }
    current = nextMap.get(stageId);
  }

  return { result: "pass" };
}
