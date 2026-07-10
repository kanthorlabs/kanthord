/**
 * Termination decision function (Epic 019.3, Story 003 T2).
 *
 * `postSessionDecision` is the central verdict gate called once per
 * completed session.  It:
 *  1. Always increments the durable attempt ledger (per-dispatch counting).
 *  2. Records gate-failure evidence before returning the verdict.
 *  3. Returns a typed `Verdict` that the run-loop uses to route the task:
 *     - complete        → gate passed, mark task done
 *     - needs-human     → park + escalation inbox item
 *     - retry-intent    → reset to pending, spawn again
 *     - attempts-exhausted → park + attempts-exhausted inbox item
 *
 * The grant-one flag is consumed inside this module rather than exposed
 * as a separate export, keeping the flag-lifecycle atomic with the verdict.
 */

import type { Store } from "../foundations/sqlite-store.ts";
import type { GateResult } from "../workflow/workflow.ts";
import { incrementAttempt, readGrantOne } from "./attempt-ledger.ts";
import { recordEvidence } from "./attempt-evidence.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Verdict =
  | { kind: "complete" }
  | { kind: "needs-human" }
  | { kind: "attempts-exhausted"; attemptCount: number }
  | { kind: "retry-intent" };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Clears the grant-one flag without touching dispatch_count.
 * Called internally when the extra attempt granted by the operator is consumed.
 */
function clearGrantOne(store: Store, taskId: string): void {
  store.run(
    `UPDATE attempt_ledger SET grant_one = 0 WHERE task_id = ?`,
    taskId,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates the post-session outcome and returns the routing verdict.
 *
 * Call order (debate finding 2026-07-10):
 *  1. Increment ledger (always) — first-try pass reads 1, not 0.
 *  2. Record evidence (fail only) — durable before any verdict.
 *  3. Apply max-attempts ceiling (grant-one check consumes the flag if active).
 *  4. Return verdict.
 */
export function postSessionDecision(
  store: Store,
  opts: {
    taskId: string;
    phase: string;
    gateResult: GateResult;
    maxAttempts: number;
  },
): Verdict {
  const { taskId, phase, gateResult, maxAttempts } = opts;

  // Step 1: always increment — per-dispatch counting
  const attemptCount = incrementAttempt(store, taskId);

  if (gateResult.outcome === "pass") {
    return { kind: "complete" };
  }

  if (gateResult.outcome === "needs_human") {
    return { kind: "needs-human" };
  }

  // outcome === "fail"
  // Step 2: record evidence before any verdict (debate finding 2026-07-10)
  recordEvidence(store, {
    taskId,
    attempt: attemptCount,
    phase,
    summary: gateResult.summary ?? "",
  });

  // Step 3: ceiling check — grant-one overrides max if active
  if (attemptCount >= maxAttempts) {
    if (readGrantOne(store, taskId)) {
      // Consume the extra attempt the operator granted; allow one more retry
      clearGrantOne(store, taskId);
      return { kind: "retry-intent" };
    }
    return { kind: "attempts-exhausted", attemptCount };
  }

  return { kind: "retry-intent" };
}

