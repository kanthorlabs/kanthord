import type { Store } from "../foundations/sqlite-store.ts";
import type { LeaseManager, Capability } from "./leases.ts";
import { setTaskStatus } from "./dispatch.ts";
import { dispatchableForGeneration, pinGeneration } from "./generation.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DispatchedTask = { taskId: string };

// ---------------------------------------------------------------------------
// pollOnce — one persisted-state dispatch pass composing all four conditions:
//
//   1. dispatchableForGeneration: exit-gate check (gates) + generation/dirty
//      guard + park exclusion (blocked_on IS NULL inside dispatchable).
//   2. lm.acquire: atomic lease acquisition — all-or-nothing per task;
//      skips the task when any required capability is held by another holder.
//   3. setTaskStatus("running"): pins the task as in-progress so subsequent
//      polls do not return it as a fresh dispatch candidate.
//   4. pinGeneration: stamps the task's dispatched generation exactly once.
//
// Returns the subset of candidates that actually passed all four conditions
// and were dispatched in this pass.
// ---------------------------------------------------------------------------

export function pollOnce(
  store: Store,
  featureId: string,
  liveHash: string,
  lm: LeaseManager,
  taskCapabilities: Map<string, Capability[]>,
): DispatchedTask[] {
  // Step 1: filter by gates + generation-permit + park exclusion.
  const candidates = dispatchableForGeneration(store, featureId, liveHash);

  const dispatched: DispatchedTask[] = [];

  for (const task of candidates) {
    const caps = taskCapabilities.get(task.id) ?? [];

    // Step 2: atomic lease acquisition — skip if any capability is held.
    if (!lm.acquire(task.id, caps)) {
      continue;
    }

    // Step 3: mark running so the task leaves the pending pool.
    setTaskStatus(store, task.id, "running");

    // Step 4: stamp the start generation (idempotent, first-dispatch only).
    pinGeneration(store, task.id);

    dispatched.push({ taskId: task.id });
  }

  return dispatched;
}
