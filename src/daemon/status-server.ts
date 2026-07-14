/**
 * Status server — Epic 009 Story 002 · T1.
 *
 * Serves two surfaces on a single node:http server bound to loopback only:
 *   - GET /healthz  — plain HTTP route returning 200 ok (PRD §3.1).
 *   - /* (fallthrough) — Connect RPC adapter serving the read-only DaemonService.
 *
 * Loopback bind (127.0.0.1, never 0.0.0.0) is enforced at the listen call
 * (PRD §9 never-0.0.0.0 principle; SU4 spike confirmed the approach).
 */

import { createServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { Code, ConnectError } from "@connectrpc/connect";
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
} from "../metrics/interaction-capture.ts";

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

      const rpcHandler = connectNodeAdapter({
        routes(router) {
          router.service(DaemonService, {
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
              const items = domainItems.map((item) => ({
                id: item.id,
                kind: item.kind,
                featureId: "",
                summary: "",
              }));
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
