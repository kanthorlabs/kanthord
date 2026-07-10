import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import type { InFlightOp } from "./submit.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Clock } from "../foundations/clock.ts";

/** Raw shape returned by a `poll_status` adapter call. */
interface PollResult {
  status: string;
  result?: unknown;
  error?: unknown;
}

function writeCompletion(
  store: Store,
  opId: string,
  pollResult: PollResult,
  now: number,
): void {
  const resultJson =
    pollResult.result !== undefined ? JSON.stringify(pollResult.result) : null;
  const errorJson =
    pollResult.error !== undefined ? JSON.stringify(pollResult.error) : null;
  store.run(
    `INSERT OR REPLACE INTO broker_completion (op_id, status, result_json, error_json, at)
     VALUES (?, ?, ?, ?, ?)`,
    opId,
    pollResult.status,
    resultJson,
    errorJson,
    now,
  );
}

/**
 * Schedule recurring poll ticks for an in-flight operation.
 *
 * Each tick fires after `delayMs` ms on the injected `clock` (first tick
 * always uses `entry.poll_interval`).  When `poll_status` returns a status
 * included in `entry.terminal_states`, a completion row is written to
 * `broker_completion` via `INSERT OR REPLACE` (idempotent — concurrent ticks
 * for the same op_id yield exactly one row).
 *
 * Extended behaviours driven by `VerbRegistryEntry`:
 * - **Timeout → escalation_needed**: tracks elapsed time since `startPolling`;
 *   when a non-terminal response arrives and `clock.now() - startMs >=
 *   entry.timeout`, writes a `broker_completion` row with
 *   `status = "escalation_needed"` and stops scheduling further ticks.
 * - **Exponential backoff**: a non-terminal response whose `error` field is
 *   present (retryable error) and `entry.retry.backoff === "exponential"`
 *   schedules the next tick at `poll_interval * 2^retryCount` ms.
 * - **Rate-limit deferral**: a `rate_limited` response schedules the next tick
 *   at `Math.ceil(60000 / entry.rate_limit.requests_per_minute)` ms.
 * - **Regression handling** (`entry.observed_state_can_regress === true`): on
 *   a first terminal response the completion row is withheld; one more poll is
 *   scheduled.  If the re-poll is also terminal, the completion is written; if
 *   it regresses to non-terminal, the first terminal result is discarded and
 *   polling continues.
 *
 * PRD §5 — completion detection is poll-only; terminality is declared
 * per-verb via `terminal_states`, not hardcoded.
 */
export function startPolling(
  op: InFlightOp,
  entry: VerbRegistryEntry,
  adapter: AsyncVerbAdapter,
  store: Store,
  clock: Clock,
): void {
  const startMs = clock.now();
  let retryCount = 0;
  let pendingTerminalResult: PollResult | null = null;

  function scheduleNext(delayMs: number): void {
    clock.setTimer(delayMs, () => {
      void (async () => {
        const pollResult = (await adapter.poll_status(op.request_id)) as PollResult;

        // ── Rate-limit deferral ─────────────────────────────────────────────
        // Checked before terminal_states to avoid misclassifying the status.
        if (pollResult.status === "rate_limited") {
          const deferMs = Math.ceil(60000 / entry.rate_limit.requests_per_minute);
          retryCount = 0;
          scheduleNext(deferMs);
          return;
        }

        // ── Terminal result ─────────────────────────────────────────────────
        if (entry.terminal_states.includes(pollResult.status)) {
          if (!entry.observed_state_can_regress) {
            // Stable terminal — write immediately.
            writeCompletion(store, op.op_id, pollResult, clock.now());
            return;
          }
          if (pendingTerminalResult !== null) {
            // Second consecutive terminal on a regress-capable verb — confirmed.
            writeCompletion(store, op.op_id, pollResult, clock.now());
            return;
          }
          // First terminal on a regress-capable verb — hold and verify.
          pendingTerminalResult = pollResult;
          retryCount = 0;
          scheduleNext(entry.poll_interval);
          return;
        }

        // ── Non-terminal result ─────────────────────────────────────────────
        if (pendingTerminalResult !== null) {
          // Regression: state reverted from terminal to non-terminal.
          pendingTerminalResult = null;
          // Fall through to continue regular polling.
        }

        // Timeout → escalation_needed
        const elapsed = clock.now() - startMs;
        if (elapsed >= entry.timeout) {
          writeCompletion(
            store,
            op.op_id,
            { status: "escalation_needed" },
            clock.now(),
          );
          return;
        }

        // Exponential backoff on retryable non-terminal error
        if (
          pollResult.error !== undefined &&
          entry.retry.backoff === "exponential"
        ) {
          retryCount += 1;
          const backoffMs = entry.poll_interval * Math.pow(2, retryCount);
          scheduleNext(backoffMs);
          return;
        }

        // Regular non-terminal: reset retry count, schedule at poll_interval.
        retryCount = 0;
        scheduleNext(entry.poll_interval);
      })();
    });
  }

  scheduleNext(entry.poll_interval);
}
