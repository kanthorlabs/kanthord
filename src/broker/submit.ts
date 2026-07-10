import { randomUUID } from "node:crypto";
import type { Store } from "../foundations/sqlite-store.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import type { HoldPoint } from "./hold-point.ts";

/** A broker operation that has been submitted to the remote adapter. */
export interface InFlightOp {
  op_id: string;
  verb: string;
  request_id: string;
  status: "in_flight";
}

/** Raw row shape as returned from SQLite. */
interface InFlightRow {
  op_id: string;
  verb: string;
  request_id: string;
  status: string;
}

/**
 * Submit an async verb operation. Generates a unique `op_id`, calls the
 * adapter's `submit` to obtain a `request_id`, persists the in-flight op to
 * the SQLite broker table (creating it idempotently if absent), and returns
 * the `op_id` (PRD §5 — every call returns a request id, always async).
 *
 * Idempotency: when `entry.idempotency.window_ms > 0`, an empty key is
 * rejected. A second call with the same `(verb, idempotencyKey)` returns the
 * existing `op_id` without re-invoking the adapter.
 */
export async function submit(
  entry: VerbRegistryEntry,
  adapter: AsyncVerbAdapter,
  payload: unknown,
  idempotencyKey: string,
  store: Store,
  options?: { holdPoint?: HoldPoint },
): Promise<string> {
  // Guard: key is required when the verb declares a non-zero idempotency window.
  if (entry.idempotency.window_ms > 0 && idempotencyKey === "") {
    throw new Error(
      `idempotency key is required for verb "${entry.verb}" (window_ms=${entry.idempotency.window_ms})`,
    );
  }

  // Dedup: return the existing op_id if this (verb, idempotencyKey) is already in flight.
  const existing = store.get<{ op_id: string }>(
    `SELECT op_id FROM broker_in_flight WHERE verb = ? AND idempotency_key = ?`,
    entry.verb,
    idempotencyKey,
  );
  if (existing !== undefined) {
    return existing.op_id;
  }

  // Hold-point gate: if a pre-submit hold is configured for this verb, record
  // the op as "held" and do NOT invoke the adapter.
  const holdPoint = options?.holdPoint;
  if (holdPoint?.shouldHold(entry.verb, "pre-submit")) {
    const opId = randomUUID();
    store.run(
      `INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, status)
       VALUES (?, ?, ?, ?, ?)`,
      opId,
      entry.verb,
      "",
      idempotencyKey,
      "held",
    );
    holdPoint.hold(opId);
    return opId;
  }

  const opId = randomUUID();
  const requestId = (await adapter.submit(payload)) as string;
  store.run(
    `INSERT INTO broker_in_flight (op_id, verb, request_id, idempotency_key, status)
     VALUES (?, ?, ?, ?, ?)`,
    opId,
    entry.verb,
    requestId,
    idempotencyKey,
    "in_flight",
  );
  return opId;
}

/**
 * Retrieve the in-flight op record for `opId`, or `undefined` if not found.
 */
export function getInFlightOp(
  opId: string,
  store: Store,
): InFlightOp | undefined {
  const row = store.get<InFlightRow>(
    `SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?`,
    opId,
  );
  if (row === undefined) return undefined;
  return {
    op_id: row.op_id,
    verb: row.verb,
    request_id: row.request_id,
    status: "in_flight",
  };
}
