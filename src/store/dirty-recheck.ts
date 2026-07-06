import type { Store } from "../foundations/sqlite-store.ts";
import type { LeaseManager, Capability } from "../scheduler/leases.ts";
import type { DispatchedTask } from "../scheduler/poll.ts";
import { computeCompileHash } from "../compiler/compile.ts";
import { isPlanDirty } from "../scheduler/generation.ts";
import { pollOnce } from "../scheduler/poll.ts";

/**
 * recheckDirty — computes the current compile_hash of the covered file set
 * under `featureDir` and compares it to the stored hash for `featureId`.
 *
 * Returns `true` when the live hash differs from the stamped hash (plan is
 * dirty); `false` when they match (plan is clean).
 *
 * Excludes RUNBOOK.md, *.state.md, *.journal.jsonl from the hash (same
 * exclusions as computeCompileHash — operational files do not dirty the plan).
 */
export async function recheckDirty(
  featureDir: string,
  store: Store,
  featureId: string,
): Promise<boolean> {
  const liveHash = await computeCompileHash(featureDir);
  return isPlanDirty(store, featureId, liveHash);
}

/**
 * pollWithRecheck — convenience wrapper that computes the live compile_hash,
 * checks whether the plan is dirty, and delegates to pollOnce when clean.
 *
 * If the plan is dirty (out-of-band edit detected), returns [] immediately
 * without dispatching any tasks. Otherwise passes the live hash to pollOnce
 * and returns its result.
 *
 * Callers do not need to compute or pass the hash themselves.
 */
export async function pollWithRecheck(
  featureDir: string,
  store: Store,
  featureId: string,
  lm: LeaseManager,
  taskCapabilities: Map<string, Capability[]>,
): Promise<DispatchedTask[]> {
  const liveHash = await computeCompileHash(featureDir);
  if (isPlanDirty(store, featureId, liveHash)) {
    return [];
  }
  return pollOnce(store, featureId, liveHash, lm, taskCapabilities);
}
