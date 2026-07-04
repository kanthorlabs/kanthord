import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default lease duration in milliseconds.  Used by both acquire and heartbeat. */
const LEASE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Capability =
  | { kind: "write_scope"; path: string }
  | { kind: "resource"; key: string };

// ---------------------------------------------------------------------------
// Write-scope normalization and overlap detection
//
// Paths are normalized by stripping the trailing `/**` glob suffix and any
// remaining trailing slashes, so `ios/**`, `ios/`, and `ios` all collapse to
// `"ios"`.  Two normalized scopes overlap when one is an exact match or a
// proper path-prefix of the other (boundary enforced by the `/` separator so
// that `ios` does NOT prefix `ios2`).
// ---------------------------------------------------------------------------

function normalizeScope(path: string): string {
  return path.replace(/\/\*\*$/, "").replace(/\/+$/, "");
}

function normalizedScopesOverlap(na: string, nb: string): boolean {
  return na === nb || nb.startsWith(na + "/") || na.startsWith(nb + "/");
}

// ---------------------------------------------------------------------------
// Canonical storage key for a capability
// ---------------------------------------------------------------------------

function capabilityKey(cap: Capability): string {
  if (cap.kind === "write_scope") {
    return "write_scope:" + normalizeScope(cap.path);
  }
  return "resource:" + cap.key;
}

// ---------------------------------------------------------------------------
// Scheduler-owned migration (idempotent DDL)
// ---------------------------------------------------------------------------

function applyLeaseMigration(store: Store): void {
  store.run(
    `CREATE TABLE IF NOT EXISTS scheduler_lease (
      capability_key TEXT NOT NULL PRIMARY KEY,
      holder         TEXT NOT NULL,
      acquired_at    INTEGER NOT NULL,
      expires_at     INTEGER NOT NULL,
      heartbeat_at   INTEGER NOT NULL
    )`,
  );
}

// ---------------------------------------------------------------------------
// LeaseManager
//
// Serializes task dispatch on shared capabilities (write-scope paths and
// resource keys).  Disjoint capabilities may be held concurrently.
// Acquisition is all-or-nothing: if any capability is already held by another
// task, no lease row is written for the requesting task.
// ---------------------------------------------------------------------------

export class LeaseManager {
  private store: Store;
  private clock: Clock;

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
    applyLeaseMigration(this.store);
  }

  /**
   * Attempt to acquire all listed capabilities for `taskId`.
   * Returns `true` when every capability was free and has been recorded;
   * returns `false` (and writes nothing) when any capability is currently
   * held by a different task.
   */
  acquire(taskId: string, capabilities: Capability[]): boolean {
    const now = this.clock.now();

    // Phase 1 — conflict check (no writes yet).
    // Leases whose expires_at < now are treated as absent (expired).
    for (const cap of capabilities) {
      if (cap.kind === "write_scope") {
        const ns = normalizeScope(cap.path);
        // Load all active (non-expired) write_scope leases held by other tasks.
        const held = this.store.all<{ capability_key: string }>(
          "SELECT capability_key FROM scheduler_lease WHERE capability_key LIKE 'write_scope:%' AND holder != ? AND expires_at >= ?",
          taskId,
          now,
        );
        for (const row of held) {
          const heldNs = row.capability_key.slice("write_scope:".length);
          if (normalizedScopesOverlap(ns, heldNs)) {
            return false;
          }
        }
      } else {
        // resource — exact canonical key only, no prefix matching.
        const key = capabilityKey(cap);
        const existing = this.store.get<{ holder: string }>(
          "SELECT holder FROM scheduler_lease WHERE capability_key = ? AND holder != ? AND expires_at >= ?",
          key,
          taskId,
          now,
        );
        if (existing !== undefined) {
          return false;
        }
      }
    }

    // Phase 2 — all capabilities are free; insert every lease.
    const expiresAt = now + LEASE_TTL_MS;
    for (const cap of capabilities) {
      const key = capabilityKey(cap);
      this.store.run(
        `INSERT OR REPLACE INTO scheduler_lease
           (capability_key, holder, acquired_at, expires_at, heartbeat_at)
         VALUES (?, ?, ?, ?, ?)`,
        key,
        taskId,
        now,
        expiresAt,
        now,
      );
    }
    return true;
  }

  /**
   * Renew the expiry of all leases held by `taskId`.  A heartbeat sent before
   * `expires_at` keeps the lease alive, preventing reclaimation by a waiter.
   * The expiry is extended by `LEASE_TTL_MS` from `clock.now()`.
   */
  heartbeat(taskId: string): void {
    const now = this.clock.now();
    this.store.run(
      "UPDATE scheduler_lease SET expires_at = ?, heartbeat_at = ? WHERE holder = ?",
      now + LEASE_TTL_MS,
      now,
      taskId,
    );
  }

  /**
   * Release all leases held by `taskId`.  The released capabilities become
   * available to the next `acquire` call in the same poll pass.
   */
  release(taskId: string): void {
    this.store.run(
      "DELETE FROM scheduler_lease WHERE holder = ?",
      taskId,
    );
  }
}
