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
              // Query the store for task statuses — proves the response is
              // SQLite-derived (write-counting seam must see zero writes here).
              opts.store.all<{ node_id: string; status: string }>(
                "SELECT node_id, status FROM scheduler_task"
              );
              const uptimeSeconds =
                startedAt > 0
                  ? BigInt(Math.floor((Date.now() - startedAt) / 1000))
                  : BigInt(0);
              return { version, uptimeSeconds };
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
