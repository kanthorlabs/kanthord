/**
 * Status server — Epic 009 Story 002 · T1.
 *
 * Serves two surfaces on a single node:http server bound to loopback only:
 *   - GET /healthz  — plain HTTP route returning 200 ok (PRD §3.1).
 *   - /* (fallthrough) — Connect RPC adapter serving the read-only DaemonService.
 *
 * Loopback bind (127.0.0.1, never 0.0.0.0) is enforced at the listen call
 * (PRD §9 never-0.0.0.0 principle; SU4 spike confirmed the approach).
 *
 * WIRE-1 (2026-07-15): all 17 Epic-026 methods wired as thin adapters over
 * read-surfaces / control-verbs functions; D1 Connect auth interceptor added
 * (rejects when credentials configured, no-op in dev/test).
 */

import { createServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { DaemonService } from "../generated/kanthord/v1/daemon_pb.js";
import type { Store } from "../foundations/sqlite-store.ts";
import type { JsonlLog } from "../foundations/jsonl.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import type { InteractionEvent } from "../metrics/interaction-capture.ts";
import { listOpenInboxItems } from "../rpc/inbox-list.ts";
import { resumeEscalationItem, haltEscalationItem } from "../rpc/inbox-respond.ts";
import { approveItem, denyItem } from "../inbox/respond.ts";
import {
  buildInteractionEvent,
  InvalidCategoryError,
  InteractionIntentConflictError,
  MissingCategoryError,
  persistInteractionIntent,
  projectPendingInteractionIntents,
  validateConfirmedCategory,
  SIGNAL_MAP,
} from "../metrics/interaction-capture.ts";
import {
  listFeatures,
  getFeature,
  listBrokerOperations,
  listBrokerVerbs,
  listSlots,
  getBudget,
  getDaemonStatus,
  triggerVerify,
  getTaskTimeline,
} from "../rpc/read-surfaces.ts";
import type { ReadSurfacesDeps, ExtendedReadSurfacesDeps } from "../rpc/read-surfaces.ts";
import {
  signOffPlan,
  haltTask,
  haltFeature,
  approveReplan,
  budgetOverride,
  HaltConflictError,
  HaltFeatureConflictError,
  PathViolationError,
  GenerationConflictError,
  OverrideRateLimitError,
  OverrideDayCapError,
  OverrideAlreadyAppliedError,
  DuplicateEditTargetError,
} from "../rpc/control-verbs.ts";
import type { ControlVerbsDeps, BudgetOverrideDeps, ReplanDiff } from "../rpc/control-verbs.ts";
import { checkCredentials, AUTH_FAILURE_TABLE } from "../rpc/auth.ts";
import { newId } from "../foundations/id.ts";
import { log, errMessage } from "../foundations/log.ts";

type SchedulerStatusRow = {
  node_id: string;
  feature_id: string;
  status: string;
  exit_gate_passed: number;
};

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface StatusServer {
  /** Start the HTTP server; resolves with the actual bound { host, port }. */
  start(): Promise<{ host: string; port: number }>;
  /** Gracefully close the server. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createStatusServer(opts: {
  store: Store;
  version?: string;
  logger?: { info(record: Record<string, unknown>): void };
  port?: number;
  /** Bind address for the HTTP listener; defaults to '127.0.0.1' (loopback-only).
   *  Control methods (respondToEscalation, respondToApproval) refuse requests
   *  when bind is not a loopback address — 2A safety gate (debate finding). */
  bind?: string;
  /** Provides the context needed to dispatch an approval op through the broker.
   *  Required for respondToApproval to approve (not needed for deny). */
  getApprovalContext?: (
    op_id: string,
  ) => { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter; payload: unknown } | undefined;
  /** Append-only interaction capture for control-plane responses. */
  interactionLog?: JsonlLog;
  // --- Epic-026 WIRE-1 deps (all optional; devtest defaults apply when absent) ---
  featureDataRoot?: string;
  nowMs?: number;
  verbRegistry?: Array<{ verb: string; tier: string; pending_expiry_ms?: number }>;
  slotRegistry?: Array<{
    name: string;
    repo: string;
    strategy: string;
    heldLeases: string[];
    activeSessions: string[];
  }>;
  getBudgetCeiling?: (taskId: string) => number;
  daemonVersion?: string;
  uptimeFn?: () => number;
  verifyFn?: () => Promise<{ outcome: string; reportJson: string }>;
  featureDirFn?: (featureId: string) => string;
  overrideRateLimitFn?: (taskId: string) => { allowed: boolean };
  overrideDayCapFn?: (taskId: string) => { allowed: boolean };
  /** When non-empty, the Connect interceptor rejects requests with missing or
   *  invalid Basic auth credentials (Code.Unauthenticated). When absent/empty,
   *  auth is not enforced (dev/test mode). */
  credentials?: Array<{ username: string; password: string }>;
}): StatusServer {
  const { version = "0.0.0", bind = "127.0.0.1", port = 0 } = opts;

  let server: ReturnType<typeof createServer> | undefined;
  let startedAt = 0;
  let interactionControlTail: Promise<void> = Promise.resolve();

  const serializeInteractionControl = <T>(work: () => Promise<T>): Promise<T> => {
    const result = interactionControlTail.then(work, work);
    interactionControlTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    async start(): Promise<{ host: string; port: number }> {
      startedAt = Date.now();
      if (opts.interactionLog !== undefined) {
        await projectPendingInteractionIntents(opts.store, opts.interactionLog, Date.now());
      }

      // --- Build Epic-026 RPC deps ---
      const extDeps: ExtendedReadSurfacesDeps = {
        store: opts.store,
        featureDataRoot: opts.featureDataRoot ?? "",
        nowMs: opts.nowMs ?? Date.now(),
        verbRegistry: opts.verbRegistry ?? [],
        slotRegistry: opts.slotRegistry ?? [],
        getBudgetCeiling: opts.getBudgetCeiling ?? (() => 0),
        daemonVersion: opts.daemonVersion ?? version,
        uptimeFn:
          opts.uptimeFn ??
          (() => (startedAt > 0 ? Math.floor((Date.now() - startedAt) / 1000) : 0)),
        verifyFn:
          opts.verifyFn ??
          (async () => ({ outcome: "unavailable", reportJson: "{}" })),
      };
      // ReadSurfacesDeps-typed reference (ExtendedReadSurfacesDeps is a structural superset).
      const baseDeps: ReadSurfacesDeps = extDeps;

      const cvDeps: ControlVerbsDeps = {
        store: opts.store,
        featureDirFn: opts.featureDirFn ?? ((fid: string) => fid),
      };

      const budgetDeps: BudgetOverrideDeps = {
        store: opts.store,
        overrideRateLimitFn: opts.overrideRateLimitFn ?? (() => ({ allowed: false })),
        overrideDayCapFn: opts.overrideDayCapFn ?? (() => ({ allowed: false })),
        nowMs: opts.nowMs ?? Date.now(),
      };

      // --- D1 auth interceptor ---
      // No-op when credentials is absent/empty (dev/test mode).
      const configuredCredentials = opts.credentials ?? [];
      const authInterceptor: Interceptor = (next) => async (req) => {
        if (configuredCredentials.length === 0) return next(req);
        const authHeader = req.header.get("authorization");
        const parsed = parseBasicAuthHeader(authHeader);
        if (parsed === null || !checkCredentials(parsed, configuredCredentials)) {
          // Journal the failure; never log credential values.
          opts.store.run(
            `INSERT INTO ${AUTH_FAILURE_TABLE} (id, source, failed_at) VALUES (?, ?, ?)`,
            newId("af"),
            "connect-rpc",
            Date.now(),
          );
          throw new ConnectError("invalid or missing credentials", Code.Unauthenticated);
        }
        return next(req);
      };

      const rpcHandler = connectNodeAdapter({
        interceptors: [authInterceptor],
        routes(router) {
          router.service(DaemonService, {
            // ─── Existing Phase-1 / Phase-2A handlers ────────────────────────
            getStatus() {
              const features = readFeatureStatuses(opts.store);
              const uptimeSeconds =
                startedAt > 0
                  ? BigInt(Math.floor((Date.now() - startedAt) / 1000))
                  : BigInt(0);
              return { version, uptimeSeconds, features };
            },
            listInboxItems() {
              const domainItems = listOpenInboxItems(opts.store);
              const items = domainItems.map((item) => {
                const evidence = item.evidence;
                const taskId = typeof evidence["task_id"] === "string" ? evidence["task_id"] : "";
                const reason = typeof evidence["reason"] === "string" ? evidence["reason"] : "";
                // N2: featureId via scheduler_task lookup; suggestedCategory via SIGNAL_MAP
                const featureId = featureIdForTask(opts.store, taskId);
                const suggestedCategory = SIGNAL_MAP[reason] ?? "";
                return {
                  id: item.id,
                  kind: item.kind,
                  featureId,
                  summary: "",
                  type: reason,
                  severity: "",
                  suggestedCategory,
                  status: item.status,
                  expiresAt: 0n,
                  expired: false,
                  brokerOpId: "",
                };
              });
              return { items };
            },
            async respondToEscalation(req) {
              // 2A safety gate: control methods only served from loopback binds.
              if (bind !== "127.0.0.1" && bind !== "::1") {
                throw new ConnectError(
                  "respondToEscalation is restricted to loopback binds in phase 2A",
                  Code.PermissionDenied,
                );
              }
              if (req.response !== "resume" && req.response !== "halt") {
                throw new ConnectError(
                  `unsupported escalation response: ${req.response}`,
                  Code.InvalidArgument,
                );
              }
              validateInteractionCategory(req.confirmedCategory);
              const interactionLog = requireInteractionCapture(opts.interactionLog);
              return serializeInteractionControl(async () => {
                await projectPendingInteractionIntents(opts.store, interactionLog, Date.now());
                const row = opts.store.get<{ evidence: string; kind: string; status: string }>(
                  "SELECT evidence, kind, status FROM inbox_items WHERE id = ?",
                  req.id,
                );
                if (row === undefined) {
                  throw new ConnectError(`inbox item not found: ${req.id}`, Code.NotFound);
                }
                if (row.kind !== "escalation") {
                  throw new ConnectError(
                    `item ${req.id} is not an escalation item`,
                    Code.InvalidArgument,
                  );
                }
                const evidence = JSON.parse(row.evidence) as Record<string, unknown>;
                const taskId =
                  typeof evidence["task_id"] === "string" ? evidence["task_id"] : "";
                const featureId = featureIdForTask(opts.store, taskId);
                const cost = interactionCost(opts.store, taskId);
                const interaction = buildInteractionEvent({
                  item_id: req.id,
                  task_id: taskId,
                  feature_id: featureId,
                  signal: typeof evidence["reason"] === "string" ? evidence["reason"] : "",
                  confirmed_category: req.confirmedCategory,
                  actor: "operator",
                  timestamp: Date.now(),
                  cost_to_date: cost.cost_to_date,
                  no_ledger: cost.no_ledger,
                });
                persistResponseIntent(
                  opts.store,
                  req.id,
                  interaction,
                  req.response,
                  req.confirmedCategory,
                );
                if (row.status === "resolved") {
                  await projectPendingInteractionIntents(opts.store, interactionLog, Date.now());
                  return { status: "resolved" };
                }
                const serverClock = {
                  now: () => Date.now(),
                  setTimer: (_d: number, _cb: () => void): void => { /* no real timers needed */ },
                };
                if (req.response === "resume") {
                  resumeEscalationItem({
                    item_id: req.id,
                    task_id: taskId,
                    actor: "operator",
                    store: opts.store,
                    clock: serverClock,
                  });
                } else {
                  haltEscalationItem({
                    item_id: req.id,
                    task_id: taskId,
                    actor: "operator",
                    store: opts.store,
                    clock: serverClock,
                  });
                }
                await projectPendingInteractionIntents(opts.store, interactionLog, Date.now());
                return { status: "resolved" };
              });
            },
            async respondToApproval(req) {
              // 2A safety gate: control methods only served from loopback binds.
              if (bind !== "127.0.0.1" && bind !== "::1") {
                throw new ConnectError(
                  "respondToApproval is restricted to loopback binds in phase 2A",
                  Code.PermissionDenied,
                );
              }
              validateInteractionCategory(req.confirmedCategory);
              const interactionLog = requireInteractionCapture(opts.interactionLog);
              return serializeInteractionControl(async () => {
                await projectPendingInteractionIntents(opts.store, interactionLog, Date.now());
                const row = opts.store.get<{ evidence: string; kind: string; status: string }>(
                  "SELECT evidence, kind, status FROM inbox_items WHERE id = ?",
                  req.id,
                );
                if (row === undefined) {
                  throw new ConnectError(`inbox item not found: ${req.id}`, Code.NotFound);
                }
                if (row.kind !== "approval") {
                  throw new ConnectError(
                    `item ${req.id} is not an approval item`,
                    Code.InvalidArgument,
                  );
                }
                const evidence = JSON.parse(row.evidence) as Record<string, unknown>;
                const opId =
                  typeof evidence["op_id"] === "string" ? evidence["op_id"] : "";
                const taskId = taskIdForApproval(opts.store, opId);
                const featureId = featureIdForTask(opts.store, taskId);
                const cost = interactionCost(opts.store, taskId);
                const interaction = buildInteractionEvent({
                  item_id: req.id,
                  task_id: taskId,
                  feature_id: featureId,
                  signal: "approval-tier-verb",
                  confirmed_category: req.confirmedCategory,
                  actor: "operator",
                  timestamp: Date.now(),
                  cost_to_date: cost.cost_to_date,
                  no_ledger: cost.no_ledger,
                });
                persistResponseIntent(
                  opts.store,
                  req.id,
                  interaction,
                  req.approve ? "approve" : "deny",
                  req.confirmedCategory,
                );
                if (row.status === "resolved") {
                  await projectPendingInteractionIntents(opts.store, interactionLog, Date.now());
                  return { status: "resolved" };
                }
                const approvalContext = req.approve ? opts.getApprovalContext?.(opId) : undefined;
                if (req.approve && approvalContext === undefined) {
                  throw new ConnectError(
                    `no approval context available for op "${opId}"`,
                    Code.FailedPrecondition,
                  );
                }
                const serverClock = {
                  now: () => Date.now(),
                  setTimer: (_d: number, _cb: () => void): void => { /* no real timers needed */ },
                };
                if (req.approve) {
                  await approveItem({
                    item_id: req.id,
                    actor: "operator",
                    op_id: opId,
                    entry: approvalContext!.entry,
                    adapter: approvalContext!.adapter,
                    payload: approvalContext!.payload,
                    store: opts.store,
                    clock: serverClock,
                  });
                } else {
                  await denyItem({
                    item_id: req.id,
                    actor: "operator",
                    op_id: opId,
                    store: opts.store,
                    clock: serverClock,
                  });
                }
                await projectPendingInteractionIntents(opts.store, interactionLog, Date.now());
                return { status: "resolved" };
              });
            },

            // ─── Phase-2B read surfaces (Epic-026 WIRE-1) ────────────────────

            listFeatures() {
              const result = listFeatures(baseDeps);
              return {
                features: result.features.map((f) => ({
                  featureId: f.featureId,
                  // N1: propagate the name computed in listFeatures (slug ?? feature_id)
                  name: f.name,
                  status: f.status,
                  phase: f.phase,
                  progressSummary: f.progressSummary,
                })),
              };
            },

            async getFeature(req) {
              const result = await getFeature(req.featureId, baseDeps);
              return {
                featureId: result.featureId,
                status: result.status,
                phase: result.phase,
                stories: result.stories.map((s) => ({
                  storyId: s.storyId,
                  status: "",
                  tasks: s.tasks.map((t) => ({
                    taskId: t.taskId,
                    status: t.status,
                    exitGatePassed: t.exitGatePassed,
                    attempt: 0n,
                  })),
                })),
                dag: {
                  totalNodes: BigInt(result.dag.totalNodes),
                  satisfiedNodes: BigInt(result.dag.satisfiedNodes),
                  totalEdges: BigInt(result.dag.totalEdges),
                  satisfiedEdges: BigInt(result.dag.satisfiedEdges),
                },
                inFlightOps: result.inFlightOps.map((op) => ({
                  opId: op.opId,
                  verb: op.verb,
                  state: op.state,
                  correlation: op.correlation,
                  featureId: "",
                  expiresAt: 0n,
                  expiring: false,
                  reconciliationStatus: "",
                })),
                stateView: result.stateView,
                journalView: result.journalView,
              };
            },

            listBrokerOperations() {
              const result = listBrokerOperations(baseDeps);
              return {
                operations: result.operations.map((op) => ({
                  opId: op.opId,
                  verb: op.verb,
                  state: op.state,
                  correlation: op.correlation,
                  featureId: op.featureId ?? "",
                  expiresAt: op.expiresAt !== undefined ? BigInt(op.expiresAt) : 0n,
                  expiring: op.expiring,
                  // N5: propagate reconciliationStatus from the function result
                  reconciliationStatus: op.reconciliationStatus,
                })),
              };
            },

            listBrokerVerbs() {
              const result = listBrokerVerbs(baseDeps);
              return { verbs: result.verbs };
            },

            listSlots() {
              const result = listSlots(extDeps);
              return { slots: result.slots };
            },

            async getBudget(req) {
              const result = await getBudget(req.taskId, extDeps);
              return {
                taskId: result.taskId,
                spent: result.spent,
                ceiling: result.ceiling,
                breakerState: result.breakerState,
                override: {
                  present: result.override.present,
                  amount: result.override.amount ?? 0,
                  reason: result.override.reason ?? "",
                  actor: result.override.actor ?? "",
                },
              };
            },

            async listBudgets() {
              const rows = opts.store.all<{ task_id: string }>(
                "SELECT task_id FROM budget_ledger",
              );
              const budgets = await Promise.all(
                rows.map((row) => getBudget(row.task_id, extDeps)),
              );
              return {
                budgets: budgets.map((b) => ({
                  taskId: b.taskId,
                  spent: b.spent,
                  ceiling: b.ceiling,
                  breakerState: b.breakerState,
                  override: {
                    present: b.override.present,
                    amount: b.override.amount ?? 0,
                    reason: b.override.reason ?? "",
                    actor: b.override.actor ?? "",
                  },
                })),
              };
            },

            async getDaemonStatus() {
              const result = await getDaemonStatus(extDeps);
              return {
                version: result.version,
                uptimeSeconds: BigInt(result.uptimeSeconds),
                lastPing: {
                  present: result.lastPing.present,
                  sentAt: 0n,
                  tasksProcessed: 0n,
                },
                lastVerify: {
                  present: result.lastVerify.present,
                  outcome: result.lastVerify.outcome ?? "",
                  ranAt:
                    result.lastVerify.ranAt !== undefined
                      ? BigInt(result.lastVerify.ranAt)
                      : 0n,
                  reportJson: result.lastVerify.reportJson ?? "",
                },
              };
            },

            getTaskTimeline(req) {
              // req.attempt is accepted by the handler but not yet forwarded to
              // queryTaskTimeline — the 019.5 seam has no attempt filter yet.
              // Wire the filter when 019.5 adds the attempt-filter parameter.
              const events = getTaskTimeline(req.taskId, baseDeps);
              return {
                events: events.map((e) => ({
                  eventType: e.kind,
                  at: BigInt(e.ts),
                  observedFailureSignal:
                    typeof e.observed_failure_signal === "string"
                      ? e.observed_failure_signal
                      : "",
                  accountId:
                    typeof e.account_id === "string" ? e.account_id : "",
                  model:
                    typeof e.model === "string" ? e.model : "",
                  detailJson: "",
                })),
              };
            },

            async triggerVerify() {
              const result = await triggerVerify(extDeps);
              return {
                report: {
                  present: result.report.present,
                  outcome: result.report.outcome,
                  ranAt: BigInt(result.report.ranAt),
                  reportJson: result.report.reportJson,
                },
              };
            },

            // ─── Phase-2B control verbs (Epic-026 WIRE-1) ────────────────────

            async signOffPlan(req) {
              const result = await signOffPlan(req.featureId, req.actor, cvDeps);
              if (!result.valid) {
                return {
                  valid: false,
                  diagnostics: result.diagnostics,
                  generation: 0n,
                };
              }
              return {
                valid: true,
                diagnostics: [],
                generation: BigInt(result.generation),
              };
            },

            async haltTask(req) {
              try {
                haltTask(req.taskId, req.actor, cvDeps);
              } catch (err) {
                throw mapControlError(err);
              }
              return { status: "halted" };
            },

            async haltFeature(req) {
              try {
                haltFeature(req.featureId, req.actor, cvDeps);
              } catch (err) {
                throw mapControlError(err);
              }
              return { status: "halted" };
            },

            async approveReplan(req) {
              const diff: ReplanDiff = {
                featureId: req.featureId,
                baseGeneration: Number(req.baseGeneration),
                edits: req.edits.map((e) => ({
                  path: e.path,
                  newContent: e.newContent,
                })),
              };
              let result: { generation: number };
              try {
                result = await approveReplan(diff, req.actor, cvDeps);
              } catch (err) {
                throw mapControlError(err);
              }
              return {
                newGeneration: BigInt(result.generation),
                reopenedTaskIds: [],
              };
            },

            async overrideBudget(req) {
              // Best-effort: look up featureId for the interaction event journal.
              const taskRow = opts.store.get<{ feature_id: string }>(
                "SELECT feature_id FROM scheduler_task WHERE node_id = ?",
                req.taskId,
              );
              const featureId = taskRow?.feature_id ?? "";
              try {
                await budgetOverride(
                  {
                    taskId: req.taskId,
                    featureId,
                    amount: req.amount,
                    reason: req.reason,
                    actor: req.actor,
                  },
                  budgetDeps,
                );
              } catch (err) {
                throw mapControlError(err);
              }
              // New ceiling = previous ceiling + override amount (one-shot raise).
              const newCeiling = (opts.getBudgetCeiling?.(req.taskId) ?? 0) + req.amount;
              return { newCeiling };
            },

            // ─── Phase-2B inbox deep-link (Epic-026 N2) ──────────────────────

            getInboxItem(req) {
              const row = opts.store.get<{
                id: string;
                kind: string;
                status: string;
                evidence: string;
              }>(
                "SELECT id, kind, status, evidence FROM inbox_items WHERE id = ?",
                req.id,
              );
              if (row === undefined) {
                throw new ConnectError(
                  `inbox item not found: ${req.id}`,
                  Code.NotFound,
                );
              }

              // Parse evidence JSON for field population
              let evidenceData: Record<string, unknown> = {};
              try {
                evidenceData = JSON.parse(row.evidence) as Record<string, unknown>;
              } catch (err) {
                opts.logger?.info({ event: "inbox.evidence.parse-error", id: req.id, error: err instanceof Error ? err.message : String(err) });
                // Always log via the global sink so parse errors are never silently
                // dropped when opts.logger is absent (AGENTS.md never-swallow rule).
                log.warn("getInboxItem.evidence-parse-error", { id: req.id, error: errMessage(err) });
              }

              const taskId = typeof evidenceData["task_id"] === "string" ? evidenceData["task_id"] : "";
              const reason = typeof evidenceData["reason"] === "string" ? evidenceData["reason"] : "";
              // N2: featureId via scheduler_task; suggestedCategory via SIGNAL_MAP
              const featureId = featureIdForTask(opts.store, taskId);
              const suggestedCategory = SIGNAL_MAP[reason] ?? "";
              // N3: brokerOpId from evidence.op_id for approval items
              const brokerOpId = row.kind === "approval" && typeof evidenceData["op_id"] === "string"
                ? evidenceData["op_id"]
                : "";

              // N2: build Evidence oneof — diff or text; absent for other types
              const evType = typeof evidenceData["type"] === "string" ? evidenceData["type"] : "";
              type EvidenceInit = {
                type: string;
                text: string;
                diff?: {
                  files: Array<{ path: string; lines: Array<{ kind: string; content: string }> }>;
                };
              };
              let evidenceField: EvidenceInit | undefined;

              if (evType === "diff") {
                const rawFiles = Array.isArray(evidenceData["files"])
                  ? (evidenceData["files"] as unknown[])
                  : [];
                evidenceField = {
                  type: "diff",
                  text: "",
                  diff: {
                    files: rawFiles.map((f) => {
                      const file = typeof f === "object" && f !== null
                        ? (f as Record<string, unknown>)
                        : {};
                      const rawLines = Array.isArray(file["lines"])
                        ? (file["lines"] as unknown[])
                        : [];
                      return {
                        path: typeof file["path"] === "string" ? file["path"] : "",
                        lines: rawLines.map((l) => {
                          const line = typeof l === "object" && l !== null
                            ? (l as Record<string, unknown>)
                            : {};
                          return {
                            kind: typeof line["kind"] === "string" ? line["kind"] : "",
                            content: typeof line["content"] === "string" ? line["content"] : "",
                          };
                        }),
                      };
                    }),
                  },
                };
              } else if (evType === "text") {
                evidenceField = {
                  type: "text",
                  text: typeof evidenceData["text"] === "string" ? evidenceData["text"] : "",
                };
              }

              return {
                item: {
                  id: row.id,
                  kind: row.kind,
                  status: row.status,
                  featureId,
                  summary: "",
                  type: reason,
                  severity: "",
                  suggestedCategory,
                  expiresAt: 0n,
                  expired: false,
                  brokerOpId,
                  evidence: evidenceField,
                },
              };
            },

            // subscribeSessionEvents — server-streaming; underlying 019.5 seam
            // not yet wired for live streaming. Left unregistered (returns
            // Code.Unimplemented by default). OPEN: wire when 019.5 stream
            // seam is available.
          });
        },
      });

      server = createServer((req, res) => {
        if (req.url === "/healthz") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
          return;
        }
        rpcHandler(req, res);
      });

      return new Promise<{ host: string; port: number }>((resolve, reject) => {
        server!.listen(port, bind, () => {
          const addr = server!.address();
          if (addr === null || typeof addr === "string") {
            reject(new Error("unexpected server address type"));
            return;
          }
          const host = addr.address;
          const port = addr.port;
          opts.logger?.info({ event: "server-listen", host, port });
          resolve({ host, port });
        });
        server!.on("error", reject);
      });
    },

    async stop(): Promise<void> {
      if (server === undefined) return;
      return new Promise<void>((resolve, reject) => {
        server!.close((err?: Error) => {
          if (err != null) reject(err);
          else resolve();
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Parse an HTTP Basic Authorization header value.
 * Returns null when the header is absent, malformed, or not Basic-scheme.
 * Credential values are never logged.
 */
function parseBasicAuthHeader(
  headerValue: string | null | undefined,
): { username: string; password: string } | null {
  if (!headerValue || !headerValue.startsWith("Basic ")) return null;
  const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;
  return {
    username: decoded.slice(0, colonIdx),
    password: decoded.slice(colonIdx + 1),
  };
}

/**
 * Map typed domain errors from control-verb functions to ConnectError codes.
 * Unknown errors map to Code.Internal.
 */
function mapControlError(err: unknown): ConnectError {
  if (err instanceof GenerationConflictError) {
    return new ConnectError(err.message, Code.FailedPrecondition);
  }
  if (err instanceof PathViolationError || err instanceof DuplicateEditTargetError) {
    return new ConnectError(err.message, Code.InvalidArgument);
  }
  if (
    err instanceof HaltConflictError ||
    err instanceof HaltFeatureConflictError ||
    err instanceof OverrideAlreadyAppliedError
  ) {
    return new ConnectError(err.message, Code.AlreadyExists);
  }
  if (err instanceof OverrideRateLimitError || err instanceof OverrideDayCapError) {
    return new ConnectError(err.message, Code.ResourceExhausted);
  }
  if (err instanceof ConnectError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new ConnectError(msg, Code.Internal);
}

function validateInteractionCategory(category: string): void {
  try {
    validateConfirmedCategory(category);
  } catch (error) {
    if (error instanceof MissingCategoryError || error instanceof InvalidCategoryError) {
      throw new ConnectError(error.message, Code.InvalidArgument);
    }
    throw error;
  }
}

function requireInteractionCapture(log: JsonlLog | undefined): JsonlLog {
  if (log === undefined) {
    throw new ConnectError(
      "interaction capture is not configured for control responses",
      Code.FailedPrecondition,
    );
  }
  return log;
}

function persistResponseIntent(
  store: Store,
  itemId: string,
  interaction: InteractionEvent,
  action: string,
  confirmedCategory: string,
): void {
  try {
    validateConfirmedCategory(confirmedCategory);
    persistInteractionIntent(store, itemId, interaction, {
      action,
      confirmed_category: confirmedCategory,
    });
  } catch (error) {
    if (error instanceof InteractionIntentConflictError) {
      throw new ConnectError(error.message, Code.AlreadyExists);
    }
    throw error;
  }
}

function featureIdForTask(store: Store, taskId: string): string {
  const row = store.get<{ feature_id: string }>(
    "SELECT feature_id FROM scheduler_task WHERE node_id = ?",
    taskId,
  );
  return row?.feature_id ?? "";
}

function taskIdForApproval(store: Store, opId: string): string {
  const pending = store.get<{ idempotency_key: string }>(
    "SELECT idempotency_key FROM broker_pending WHERE op_id = ?",
    opId,
  );
  const inFlight = pending === undefined
    ? store.get<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM broker_in_flight WHERE op_id = ?",
      opId,
    )
    : undefined;
  const key = pending?.idempotency_key ?? inFlight?.idempotency_key;
  if (key === undefined) return "";
  const separator = key.indexOf(":");
  return separator === -1 ? "" : key.slice(separator + 1);
}

function interactionCost(
  store: Store,
  taskId: string,
): { cost_to_date: number; no_ledger: boolean } {
  const spend = store.get<{ ledger: string }>(
    "SELECT ledger FROM budget_ledger WHERE task_id = ?",
    `spend:${taskId}`,
  );
  const legacyLedger = spend === undefined
    ? store.get<{ ledger: string }>(
      "SELECT ledger FROM budget_ledger WHERE task_id = ?",
      taskId,
    )
    : undefined;
  const ledger = spend ?? legacyLedger;
  if (ledger === undefined) return { cost_to_date: 0, no_ledger: true };
  const directCost = Number(ledger.ledger);
  if (Number.isFinite(directCost)) return { cost_to_date: directCost, no_ledger: false };
  return { cost_to_date: reconcileLedgerCost(ledger.ledger), no_ledger: false };
}

function reconcileLedgerCost(serialized: string): number {
  let entries: unknown;
  try {
    entries = JSON.parse(serialized) as unknown;
  } catch (error) {
    return 0;
  }
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

function readFeatureStatuses(store: Store): Array<{
  featureId: string;
  status: string;
  tasks: Array<{ taskId: string; status: string; exitGatePassed: boolean }>;
}> {
  const schedulerColumns = store.all<{ name: string }>(
    "PRAGMA table_info(scheduler_task)",
  );
  if (schedulerColumns.length === 0) return [];

  const rows = store.all<SchedulerStatusRow>(
    `SELECT node_id, feature_id, status, exit_gate_passed
     FROM scheduler_task
     ORDER BY feature_id, node_id`,
  );

  const byFeature = new Map<string, SchedulerStatusRow[]>();
  for (const row of rows) {
    const featureRows = byFeature.get(row.feature_id) ?? [];
    featureRows.push(row);
    byFeature.set(row.feature_id, featureRows);
  }

  return [...byFeature.entries()].map(([featureId, featureRows]) => ({
    featureId,
    status: deriveFeatureStatus(featureRows),
    tasks: featureRows.map((row) => ({
      taskId: row.node_id,
      status: row.status,
      exitGatePassed: row.exit_gate_passed === 1,
    })),
  }));
}

function deriveFeatureStatus(rows: SchedulerStatusRow[]): string {
  if (rows.length === 0) return "unknown";
  if (rows.every((row) => row.status === "done" || row.status === "complete")) {
    return "complete";
  }
  if (rows.some((row) => row.status === "failed")) return "failed";
  if (rows.some((row) => row.status === "running")) return "running";
  if (rows.some((row) => row.status !== "pending")) return "in_progress";
  return "pending";
}
