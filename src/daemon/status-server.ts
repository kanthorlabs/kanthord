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
import { DaemonService } from "../generated/kanthord/v1/daemon_pb.js";
import type { Store } from "../foundations/sqlite-store.ts";

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
}): StatusServer {
  const { version = "0.0.0" } = opts;

  let server: ReturnType<typeof createServer> | undefined;
  let startedAt = 0;

  return {
    async start(): Promise<{ host: string; port: number }> {
      startedAt = Date.now();

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
        server!.listen(0, "127.0.0.1", () => {
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
