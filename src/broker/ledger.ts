import type { FeatureStore } from "../store/feature-store.ts";

/**
 * Durable operation-identity ledger entry (PRD §5, §6.1).
 *
 * Stored in the task's markdown journal via the Epic 003 single-writer store.
 * `request_id` is deliberately absent — it is ephemeral and never synced.
 */
export interface LedgerEntry {
  op_id: string;
  verb: string;
  idempotency_key: string;
  correlation: string;
  desired_effect_hash: string;
  status:
    | "pending"
    | "in_flight"
    | "done"
    | "failed"
    | "expired"
    | "needs_reconciliation";
}

/**
 * Read raw ledger entries from the task journal without applying any status
 * remapping.  Used internally by both `writeLedgerEntry` and
 * `recoverFromLedger`.
 */
async function readRawLedgerEntries(
  store: FeatureStore,
  storyId: string,
  taskStem: string,
): Promise<LedgerEntry[]> {
  const raw = await store.readJournal(storyId, taskStem);
  return raw.map((r) => r as LedgerEntry);
}

/**
 * Write a durable ledger entry to the task markdown via the Epic 003 store.
 *
 * Idempotent on `(verb, idempotency_key)`: a second call with the same pair
 * returns the original `op_id` and does NOT append a second entry.
 * Returns the `op_id` (existing or newly written).
 */
export async function writeLedgerEntry(
  store: FeatureStore,
  storyId: string,
  taskStem: string,
  entry: LedgerEntry,
): Promise<string> {
  const existing = await readRawLedgerEntries(store, storyId, taskStem);
  const dup = existing.find(
    (e) =>
      e.verb === entry.verb && e.idempotency_key === entry.idempotency_key,
  );
  if (dup !== undefined) {
    return dup.op_id;
  }
  await store.appendJournal(storyId, taskStem, entry);
  return entry.op_id;
}

/**
 * Recover durable operation identities from the task's markdown ledger.
 *
 * Any `in_flight` op that has no completion row (i.e. was interrupted) is
 * returned with status `"needs_reconciliation"` — the old `request_id` is
 * never included (PRD §5, §6.1 — request ids are ephemeral).
 */
export async function recoverFromLedger(
  store: FeatureStore,
  storyId: string,
  taskStem: string,
): Promise<LedgerEntry[]> {
  const entries = await readRawLedgerEntries(store, storyId, taskStem);
  return entries.map((e) => ({
    op_id: e.op_id,
    verb: e.verb,
    idempotency_key: e.idempotency_key,
    correlation: e.correlation,
    desired_effect_hash: e.desired_effect_hash,
    status: e.status === "in_flight" ? "needs_reconciliation" : e.status,
  }));
}
