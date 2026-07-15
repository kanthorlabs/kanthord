/**
 * src/rpc/auth.ts
 *
 * Story 003 — Auth & No-Bypass.
 * Task T1: TLS + Basic auth + bind policy.
 *
 * - BindPolicyError:       thrown by validateBindAddress for forbidden configurations.
 * - validateBindAddress:   enforces VPN-only (production) or loopback-ok (devtest) policy.
 * - AUTH_FAILURE_TABLE:    table name constant for the auth failure journal.
 * - createAuthServer:      node:https TLS server with Basic-auth middleware and
 *                          timing-safe credential comparison; journals auth failures.
 */

import https from "node:https";
import { timingSafeEqual, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Store } from "../foundations/sqlite-store.ts";
import { newId } from "../foundations/id.ts";

// ---------------------------------------------------------------------------
// Bind policy
// ---------------------------------------------------------------------------

/** Thrown by validateBindAddress when the requested bind is forbidden. */
export class BindPolicyError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = "BindPolicyError";
    this.code = "forbidden-bind";
  }
}

/** Addresses that are unconditionally forbidden (wildcard / empty). */
const ALWAYS_FORBIDDEN = new Set(["0.0.0.0", "::", "::0", ""]);

/** Loopback addresses: permitted in devtest mode, forbidden in production. */
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

/**
 * Asserts that `addr` is a permitted bind address.
 *
 * Rules (applied in order):
 *   1. `0.0.0.0`, `::`, `::0`, `""` — forbidden in all modes.
 *   2. Loopback (`127.0.0.1`, `::1`) — forbidden in production, allowed in devtest.
 *   3. In production with `vpnAddress`: `addr` must exactly equal `vpnAddress`.
 *
 * @throws {BindPolicyError}
 */
export function validateBindAddress(
  addr: string,
  mode: "production" | "devtest",
  vpnAddress?: string,
): void {
  if (ALWAYS_FORBIDDEN.has(addr)) {
    throw new BindPolicyError(
      `Bind address "${addr}" is forbidden in all modes (wildcard / empty)`,
    );
  }

  if (LOOPBACK.has(addr) && mode === "production") {
    throw new BindPolicyError(
      `Loopback address "${addr}" is forbidden in production mode`,
    );
  }

  if (mode === "production" && vpnAddress !== undefined && addr !== vpnAddress) {
    throw new BindPolicyError(
      `Address "${addr}" does not match the configured VPN interface address "${vpnAddress}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Auth failure log
// ---------------------------------------------------------------------------

/** Table name constant for the auth failure journal (must match initRpcSchema DDL). */
export const AUTH_FAILURE_TABLE = "auth_failure_log";

/**
 * Absolute paths to every RPC-layer production source file.
 *
 * Used by the module-boundary assertion (Story 003 T2-c) to confirm that no
 * RPC module imports ring-1 internal mutation surfaces.  Resolved at module
 * load time via import.meta.url (ESM, Node 24 — no __dirname).
 */
export const RPC_MODULE_PATHS: readonly string[] = [
  new URL("./auth.ts", import.meta.url).pathname,
  new URL("./control-verbs.ts", import.meta.url).pathname,
  new URL("./read-surfaces.ts", import.meta.url).pathname,
  new URL("./inbox-list.ts", import.meta.url).pathname,
  new URL("./inbox-respond.ts", import.meta.url).pathname,
  new URL("./schema.ts", import.meta.url).pathname,
];

// ---------------------------------------------------------------------------
// Basic-auth credential parsing + timing-safe comparison
// ---------------------------------------------------------------------------

interface ParsedCredentials {
  username: string;
  password: string;
}

function parseBasicAuth(
  authHeader: string | undefined,
): ParsedCredentials | null {
  if (authHeader === undefined || !authHeader.startsWith("Basic ")) return null;
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;
  return {
    username: decoded.slice(0, colonIdx),
    password: decoded.slice(colonIdx + 1),
  };
}

/** Maximum accepted password length — caps attacker-controlled SHA-256 input size. */
const MAX_PASSWORD_LENGTH = 1024;

/**
 * Compares `provided` credentials against the `stored` list.
 *
 * Password comparison uses SHA-256 digests (fixed 32-byte length) so
 * `crypto.timingSafeEqual` always runs on equal-length buffers — removing the
 * prior `lenMatch` length-comparison timing leak.
 *
 * Residual: SHA-256's own input-length dependence is a residual accepted as
 * low-severity behind the VPN perimeter (Epic 026 Non-Goals).
 *
 * Credential values are NEVER logged.  Username comparison is plain equality
 * because a timing leak on the username would require knowing valid usernames first.
 */
export function checkCredentials(
  provided: ParsedCredentials,
  stored: Array<{ username: string; password: string }>,
): boolean {
  // Reject oversized input early to bound attacker-controlled hashing cost.
  if (provided.password.length > MAX_PASSWORD_LENGTH) return false;

  // SHA-256-digest the provided password once outside the loop.
  const providedPassDigest = createHash("sha256").update(provided.password).digest();

  let matched = false;
  for (const cred of stored) {
    const userMatch = provided.username === cred.username;
    // SHA-256-digest the stored password; both digests are 32 bytes so
    // timingSafeEqual always runs without a length-branch guard.
    const storedPassDigest = createHash("sha256").update(cred.password).digest();
    const passMatch = timingSafeEqual(providedPassDigest, storedPassDigest);

    if (userMatch && passMatch) {
      matched = true;
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// createAuthServer
// ---------------------------------------------------------------------------

export interface AuthServerOpts {
  cert: string | Buffer;
  key: string | Buffer;
  credentials: Array<{ username: string; password: string }>;
  store: Store;
  port?: number;
  bind?: string;
  handler(req: IncomingMessage, res: ServerResponse): void;
}

export interface AuthServer {
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
}

/**
 * Creates a node:https TLS server that enforces HTTP Basic authentication on
 * every request before delegating to `opts.handler`.
 *
 * On authentication failure the server:
 *   - returns 401 Unauthorized (with WWW-Authenticate header),
 *   - does NOT call `opts.handler`,
 *   - writes one row to `AUTH_FAILURE_TABLE` with the remote address and timestamp.
 *
 * Credential values are NEVER included in log output.
 */
export function createAuthServer(opts: AuthServerOpts): AuthServer {
  const server = https.createServer(
    { cert: opts.cert, key: opts.key },
    (req: IncomingMessage, res: ServerResponse) => {
      const authHeader = req.headers["authorization"];
      const parsed = parseBasicAuth(
        typeof authHeader === "string" ? authHeader : undefined,
      );
      const authed =
        parsed !== null && checkCredentials(parsed, opts.credentials);

      if (!authed) {
        // Journal the failure — source is remote address, never a credential value.
        const source: string = req.socket.remoteAddress ?? "unknown";
        opts.store.run(
          `INSERT INTO ${AUTH_FAILURE_TABLE} (id, source, failed_at) VALUES (?, ?, ?)`,
          newId("af"),
          source,
          Date.now(),
        );

        res.writeHead(401, {
          "WWW-Authenticate": 'Basic realm="kanthord"',
          "Content-Type": "text/plain",
        });
        res.end("Unauthorized");
        return;
      }

      // Auth passed — delegate to the application handler.
      opts.handler(req, res);
    },
  );

  return {
    start(): Promise<{ host: string; port: number }> {
      return new Promise((resolve, reject) => {
        const bindAddr = opts.bind ?? "127.0.0.1";
        const bindPort = opts.port ?? 0;
        server.once("error", reject);
        server.listen(bindPort, bindAddr, () => {
          const addr = server.address();
          if (addr !== null && typeof addr === "object") {
            resolve({ host: addr.address, port: addr.port });
          } else {
            reject(new Error("Unexpected server.address() after listen"));
          }
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        // closeAllConnections forces keep-alive connections to close so that
        // server.close(cb) can resolve promptly in test teardown.
        server.closeAllConnections();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
