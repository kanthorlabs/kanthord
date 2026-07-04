import { loadRegistryDir } from "../foundations/registry.ts";

/** Approval tiers from PRD §5. */
export type VerbTier = "auto" | "auto_with_audit" | "approval_required";

/** Full §5 declaration surface for one async verb. */
export interface VerbRegistryEntry {
  verb: string;
  tier: VerbTier;
  timeout: number;
  idempotency: { window_ms: number };
  retry: { max: number; backoff: string };
  poll_interval: number;
  terminal_states: string[];
  rate_limit: { requests_per_minute: number };
  observed_state_can_regress: boolean;
  /** Per-verb expiry window (ms) for ops in `pending` state. Optional; if
   *  absent, pending ops never expire automatically. */
  pending_expiry_ms?: number;
}

const REQUIRED_KEYS = [
  "verb",
  "tier",
  "timeout",
  "idempotency",
  "retry",
  "poll_interval",
  "terminal_states",
  "rate_limit",
  "observed_state_can_regress",
];

function toEntry(raw: Record<string, unknown>): VerbRegistryEntry {
  const idempotency = raw["idempotency"] as Record<string, unknown>;
  const retry = raw["retry"] as Record<string, unknown>;
  const rate_limit = raw["rate_limit"] as Record<string, unknown>;
  return {
    verb: raw["verb"] as string,
    tier: raw["tier"] as VerbTier,
    timeout: raw["timeout"] as number,
    idempotency: { window_ms: idempotency["window_ms"] as number },
    retry: {
      max: retry["max"] as number,
      backoff: retry["backoff"] as string,
    },
    poll_interval: raw["poll_interval"] as number,
    terminal_states: raw["terminal_states"] as string[],
    rate_limit: {
      requests_per_minute: rate_limit["requests_per_minute"] as number,
    },
    observed_state_can_regress: raw["observed_state_can_regress"] as boolean,
  };
}

/**
 * The three adapter methods every async verb must implement.
 * A verb with no `reconcile` path cannot be async (PRD §5).
 */
export interface AsyncVerbAdapter {
  submit: (input: unknown) => Promise<unknown>;
  poll_status: (requestId: unknown) => Promise<unknown>;
  reconcile: (ledger: unknown) => Promise<unknown>;
}

/**
 * Register an async verb adapter, validating that a `reconcile` path exists.
 * Throws an `Error` naming the verb when `reconcile` is absent or not a
 * function — a verb with no reconcile path cannot be async (PRD §5).
 */
export function registerVerb(
  entry: VerbRegistryEntry,
  adapter: AsyncVerbAdapter,
): void {
  if (typeof adapter.reconcile !== "function") {
    throw new Error(
      `Verb "${entry.verb}" has no reconcile adapter; a verb with no reconcile path cannot be async.`,
    );
  }
}

/**
 * Load all verb registry YAML files from `dir` and return a record keyed by
 * verb name.  Each entry exposes the full PRD §5 declaration surface.
 * Built on the Epic 001 `loadRegistryDir` loader (keyed by `"verb"`).
 */
export async function loadVerbRegistry(
  dir: string,
): Promise<Record<string, VerbRegistryEntry>> {
  const raw = await loadRegistryDir(dir, "verb", REQUIRED_KEYS);
  const result: Record<string, VerbRegistryEntry> = {};
  for (const [key, entry] of Object.entries(raw)) {
    result[key] = toEntry(entry);
  }
  return result;
}
