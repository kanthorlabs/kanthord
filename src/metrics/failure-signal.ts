import type { ProviderErrorKind } from "./provider-error.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { appendTimelineEvent } from "./task-timeline.ts";

export type ObservedFailureSignal =
  | "rate_limited"
  | "quota_exhausted"
  | "auth_failed"
  | "tool_blocked"
  | "budget_breach"
  | "broker_failed"
  | "gate_failed";

export type FailureSource =
  | { kind: "ring1_block"; tool?: string }
  | { kind: "budget_halt" }
  | { kind: "broker_op_fail"; op?: string }
  | { kind: "gate_fail" }
  | { kind: "provider_error"; typed_error: ProviderErrorKind };

/**
 * Record a human/reviewer-confirmed root-cause attribution on the task timeline.
 * This is the ONLY writer of suspected_root_cause — machine code must never call it.
 */
export function setRootCauseAttribution(
  store: Store,
  opts: {
    task_id: string;
    attempt: number;
    correlation_id: string;
    suspected_root_cause: string;
    root_cause_confidence: string;
  },
): void {
  appendTimelineEvent(store, {
    task_id: opts.task_id,
    attempt: opts.attempt,
    correlation_id: opts.correlation_id,
    kind: "root_cause_attribution",
    ts: Date.now(),
    suspected_root_cause: opts.suspected_root_cause,
    root_cause_confidence: opts.root_cause_confidence,
  });
}

/**
 * Derive a machine-factual ObservedFailureSignal from a concrete FailureSource.
 * Returns a plain string — never an object carrying suspected_root_cause.
 * Machine code must never set suspected_root_cause; that is human/reviewer-confirmed.
 */
export function deriveFailureSignal(
  source: FailureSource,
): ObservedFailureSignal {
  switch (source.kind) {
    case "ring1_block":
      return "tool_blocked";
    case "budget_halt":
      return "budget_breach";
    case "broker_op_fail":
      return "broker_failed";
    case "gate_fail":
      return "gate_failed";
    case "provider_error": {
      switch (source.typed_error) {
        case "rate_limited":
          return "rate_limited";
        case "quota_exhausted":
          return "quota_exhausted";
        case "auth_failed":
          return "auth_failed";
        case "transient":
        case "fatal":
          return "broker_failed";
      }
    }
  }
}
