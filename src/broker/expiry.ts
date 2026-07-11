import { newId, ID_PREFIX } from "../foundations/id.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import { submit } from "./submit.ts";

/** Raw row shape returned from `broker_pending`. */
interface PendingRow {
  op_id: string;
  verb: string;
  idempotency_key: string;
  pending_at: number;
  status: string;
}

/**
 * Create a pending op record. The op exists (idempotency reserved) but has
 * NOT been submitted to the remote yet. Expiry applies while in this state:
 * a stale pending op must never fire (PRD §5). Returns the new `op_id`.
 *
 * Idempotent on `(verb, idempotency_key)`: a second call with the same pair
 * returns the existing `op_id` without creating a second row — consistent
 * with the `broker_in_flight` dedup pattern (S4).
 */
export function createPendingOp(
  entry: VerbRegistryEntry,
  idempotencyKey: string,
  store: Store,
  clock: Clock,
): string {
  // S4: dedup on (verb, idempotency_key) — return existing op_id if present.
  const existing = store.get<{ op_id: string }>(
    "SELECT op_id FROM broker_pending WHERE verb = ? AND idempotency_key = ?",
    entry.verb,
    idempotencyKey,
  );
  if (existing !== undefined) {
    return existing.op_id;
  }

  const opId = newId(ID_PREFIX.op);
  store.run(
    `INSERT INTO broker_pending (op_id, verb, idempotency_key, pending_at, status)
     VALUES (?, ?, ?, ?, ?)`,
    opId,
    entry.verb,
    idempotencyKey,
    clock.now(),
    "pending",
  );
  return opId;
}

/**
 * Attempt to transition a pending op to `in_flight` by submitting it.
 *
 * If the op is past its per-verb `pending_expiry_ms` window (measured from
 * `pending_at` to `clock.now()`), the op is marked `expired` in the pending
 * table and `"expired"` is returned — `adapter.submit` is never called.
 *
 * If within the window, `submit` is called and `"in_flight"` is returned.
 */
export async function releasePendingOp(
  opId: string,
  entry: VerbRegistryEntry,
  adapter: AsyncVerbAdapter,
  payload: unknown,
  store: Store,
  clock: Clock,
): Promise<"in_flight" | "expired"> {
  const row = store.get<PendingRow>(
    `SELECT op_id, verb, idempotency_key, pending_at, status
     FROM broker_pending WHERE op_id = ?`,
    opId,
  );
  if (row === undefined) {
    throw new Error(`releasePendingOp: op_id "${opId}" not found in broker_pending`);
  }

  const expiryMs = entry.pending_expiry_ms;
  if (expiryMs !== undefined && clock.now() - row.pending_at >= expiryMs) {
    // Past expiry — mark expired; must never submit.
    store.run(`UPDATE broker_pending SET status = ? WHERE op_id = ?`, "expired", opId);
    return "expired";
  }

  // Within the window — submit and move to in_flight.
  await submit(entry, adapter, payload, row.idempotency_key, store);
  return "in_flight";
}
