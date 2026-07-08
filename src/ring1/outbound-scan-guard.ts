import { scanPayload } from "./secret-scan.ts";
import type { PatternRegistry, ScanMatch } from "./secret-scan.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * An escalation event emitted whenever an outbound payload is blocked.
 * The secret value is never included — only the pattern class that triggered
 * the block.
 */
export interface ScanEscalationEvent {
  readonly tag: "scan-blocked" | "scan-failed" | "scan-unavailable";
  readonly verb: string;
  readonly taskId: string;
  readonly patternClass?: string;
}

/**
 * Options for constructing an `OutboundScanGuard`.
 */
export interface OutboundScanGuardOpts {
  /**
   * The loaded pattern registry. Pass `null` if the registry failed to load
   * (daemon will stay running but all submits are blocked with
   * `scan-unavailable`).
   */
  readonly registry: PatternRegistry | null;
  /** Called for every blocked or failed scan. */
  readonly onEscalate: (e: ScanEscalationEvent) => void;
  /**
   * Overridable scan function; defaults to `scanPayload` from `secret-scan.ts`.
   * Injected for testing scanner-error paths.
   */
  readonly scanFn?: (payload: string, registry: PatternRegistry) => ScanMatch[];
}

/**
 * Options passed to `guardedSubmit` on each call.
 */
export interface GuardedSubmitOpts {
  readonly verb: string;
  readonly taskId: string;
  /**
   * The final serialized form of the payload (post-templating). The scan runs
   * on this string, not on the raw params, so secrets introduced by
   * serialization are caught.
   */
  readonly serializedPayload: string;
  readonly submit: (payload: unknown) => Promise<unknown>;
}

/**
 * Options passed to `guardedRunbookAppend` on each call.
 */
export interface GuardedRunbookAppendOpts {
  readonly taskId: string;
  readonly body: string;
  /** Called only when the scan passes — suppressed on block (choke-point). */
  readonly append: (body: string) => Promise<unknown>;
}

/**
 * Result returned by both guarded methods.
 */
export interface GuardResult {
  readonly status: "ok" | "blocked";
}

/**
 * The shared choke-point guard that wraps every outbound broker submit and
 * every `runbook.append` path.
 */
export interface OutboundScanGuard {
  guardedSubmit(opts: GuardedSubmitOpts): Promise<GuardResult>;
  guardedRunbookAppend(opts: GuardedRunbookAppendOpts): Promise<GuardResult>;
}

// ---------------------------------------------------------------------------
// makeOutboundScanGuard
// ---------------------------------------------------------------------------

/**
 * Build an `OutboundScanGuard`.
 *
 * - `registry: null`  → every call blocks with `scan-unavailable` (fail-closed).
 * - Scanner throws     → blocks with `scan-failed` (fail-closed).
 * - Match found        → blocks with `scan-blocked`; `patternClass` named; value
 *                        never surfaced.
 * - No match           → `{ status: "ok" }` and the supplied `submit` is called.
 */
export function makeOutboundScanGuard(opts: OutboundScanGuardOpts): OutboundScanGuard {
  const { registry, onEscalate } = opts;
  const scan = opts.scanFn ?? scanPayload;

  async function runScan(
    verb: string,
    taskId: string,
    payload: string,
  ): Promise<GuardResult> {
    // Fail-closed: registry unavailable
    if (registry === null) {
      onEscalate({ tag: "scan-unavailable", verb, taskId });
      return { status: "blocked" };
    }

    // Fail-closed: scanner error
    let matches: ScanMatch[];
    try {
      matches = scan(payload, registry);
    } catch {
      onEscalate({ tag: "scan-failed", verb, taskId });
      return { status: "blocked" };
    }

    // Fail-closed: pattern match — emit only patternClass, never the value
    const firstMatch = matches[0];
    if (firstMatch !== undefined) {
      onEscalate({ tag: "scan-blocked", verb, taskId, patternClass: firstMatch.patternClass });
      return { status: "blocked" };
    }

    return { status: "ok" };
  }

  return {
    async guardedSubmit(submitOpts: GuardedSubmitOpts): Promise<GuardResult> {
      const result = await runScan(
        submitOpts.verb,
        submitOpts.taskId,
        submitOpts.serializedPayload,
      );
      if (result.status === "ok") {
        await submitOpts.submit(submitOpts.serializedPayload);
      }
      return result;
    },

    async guardedRunbookAppend(appendOpts: GuardedRunbookAppendOpts): Promise<GuardResult> {
      const result = await runScan("runbook.append", appendOpts.taskId, appendOpts.body);
      if (result.status === "ok") {
        await appendOpts.append(appendOpts.body);
      }
      return result;
    },
  };
}
