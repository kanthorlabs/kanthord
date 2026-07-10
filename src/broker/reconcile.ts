import { submit } from "./submit.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";

/** Internal shape of the value returned by an adapter's `reconcile` call. */
interface ReconcileResult {
  /** Adapters' native contract — the single source of terminal status. */
  status?: "done" | "failed" | "resubmit" | "escalate";
  /** Present only when the adapter can hash-verify the desired effect (e.g. git verbs). */
  observed_hash?: string;
}

function writeCompletionRow(
  store: Store,
  opId: string,
  status: string,
  now: number,
): void {
  store.run(
    `INSERT OR REPLACE INTO broker_completion (op_id, status, result_json, error_json, at)
     VALUES (?, ?, NULL, NULL, ?)`,
    opId,
    status,
    now,
  );
}

/**
 * Drive a `needs_reconciliation` op to a terminal outcome by calling the
 * adapter's `reconcile` path with the op's durable identity from the ledger.
 *
 * Dispatch logic (PRD §5, crash-reconciliation state machine):
 * - `done` + `observed_hash` present + matches desired → write `done` completion row, return `"done"`.
 * - `done` + `observed_hash` present + mismatch → desired effect unverifiable; write
 *                                    `failed` completion row, return `"failed"`.
 * - `done` + no `observed_hash` (e.g. github.create_pr has no content hash) → write `done`.
 * - `failed`                       → write `failed` completion row, return `"failed"`.
 * - `resubmit`                     → idempotent resubmit via `submit` passing the
 *                                    original `payload` (dedup on the original
 *                                    idempotency key prevents double-effect),
 *                                    return `"resubmit"`.
 * - `escalate`                     → write `escalation_needed` completion row,
 *                                    return `"escalate"`.
 *
 * @param payload  The original operation payload forwarded to `adapter.submit`
 *                 on the `resubmit` branch.  Pass `undefined` when the payload
 *                 is not available at the call site.
 */
export async function reconcileOp(
  ledgerEntry: LedgerEntry,
  entry: VerbRegistryEntry,
  adapter: AsyncVerbAdapter,
  store: Store,
  clock: Clock,
  payload?: unknown,
): Promise<"done" | "failed" | "resubmit" | "escalate"> {
  const raw = await adapter.reconcile({
    correlation: ledgerEntry.correlation,
    desired_effect_hash: ledgerEntry.desired_effect_hash,
  });
  const result = raw as ReconcileResult;

  const terminalStatus = result.status;
  if (terminalStatus === undefined) {
    throw new Error("Adapter reconcile returned no status");
  }

  switch (terminalStatus) {
    case "done": {
      if (result.observed_hash !== undefined) {
        // Hash invariant: only enforced when the adapter supplies an observed_hash.
        if (result.observed_hash === ledgerEntry.desired_effect_hash) {
          writeCompletionRow(store, ledgerEntry.op_id, "done", clock.now());
          return "done";
        }
        // Hash mismatch: desired effect unverifiable — treat as failed.
        // S1: write a broker_completion row so the op is terminally recorded.
        writeCompletionRow(store, ledgerEntry.op_id, "failed", clock.now());
        return "failed";
      }
      // No observed_hash (e.g. github.create_pr has no content hash): accept done.
      writeCompletionRow(store, ledgerEntry.op_id, "done", clock.now());
      return "done";
    }
    case "failed": {
      writeCompletionRow(store, ledgerEntry.op_id, "failed", clock.now());
      return "failed";
    }
    case "resubmit": {
      // Re-use the original idempotency key: `submit` deduplicates on
      // (verb, idempotency_key) so a second reconcile call cannot double-submit.
      // S2: pass `payload` (original operation payload) — not `ledgerEntry`.
      await submit(entry, adapter, payload, ledgerEntry.idempotency_key, store);
      return "resubmit";
    }
    case "escalate": {
      writeCompletionRow(store, ledgerEntry.op_id, "escalation_needed", clock.now());
      return "escalate";
    }
    default: {
      const _exhaustive: never = terminalStatus;
      throw new Error(`Unknown reconcile status: ${String(_exhaustive)}`);
    }
  }
}
