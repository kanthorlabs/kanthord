import type { Store } from "../foundations/sqlite-store.ts";
import type { LeaseManager, Capability } from "./leases.ts";
import { setTaskStatus, markExitGatePassed } from "./dispatch.ts";
import { dispatchableForGeneration, pinGeneration } from "./generation.ts";
import type { HandlerMap } from "../deploy/chain.ts";
import { runDeployNode } from "../deploy/chain.ts";
import type { Clock } from "../foundations/clock.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DispatchedTask = { taskId: string; outcome?: "pass" | "halt" };

/**
 * DeployOpts — optional 6th parameter to pollOnce that enables scheduler-driven
 * deploy-stage execution. When present, any dispatched node whose plan_node.kind
 * is 'deploy-stage' is executed through runDeployNode; on pass its exit gate is
 * marked and a notify_human event is emitted; on halt, escalation is recorded
 * without marking the gate (downstream deploy nodes remain blocked).
 */
export type DeployOpts = {
  handlers: HandlerMap;
  clock: Clock;
  onEvent: (event: string, ctx: Record<string, unknown>) => void;
};

// ---------------------------------------------------------------------------
// dispatchStep — shared steps 2-4 for both pollOnce paths:
//   2. lm.acquire: atomic lease acquisition — returns false if any capability held.
//   3. setTaskStatus("running"): pins the task as in-progress.
//   4. pinGeneration: stamps the task's dispatched generation exactly once.
// Returns true when the task was successfully leased and transitioned to running.
// ---------------------------------------------------------------------------

function dispatchStep(
  store: Store,
  taskId: string,
  caps: Capability[],
  lm: LeaseManager,
): boolean {
  if (!lm.acquire(taskId, caps)) {
    return false;
  }
  setTaskStatus(store, taskId, "running");
  pinGeneration(store, taskId);
  return true;
}

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
//   5. (deploy-stage only, when deployOpts provided) runDeployNode: invokes
//      the per-node deploy executor; on pass marks exit gate + emits
//      notify_human; on halt records escalation without passing the gate.
//
// Overloaded: returns DispatchedTask[] synchronously when deployOpts is absent;
// returns Promise<DispatchedTask[]> when deployOpts is present so the async
// deploy executor can be awaited. Existing callers without deployOpts continue
// to work synchronously.
// ---------------------------------------------------------------------------

export function pollOnce(
  store: Store,
  featureId: string,
  liveHash: string,
  lm: LeaseManager,
  taskCapabilities: Map<string, Capability[]>,
): DispatchedTask[];
export function pollOnce(
  store: Store,
  featureId: string,
  liveHash: string,
  lm: LeaseManager,
  taskCapabilities: Map<string, Capability[]>,
  deployOpts: DeployOpts,
): Promise<DispatchedTask[]>;
export function pollOnce(
  store: Store,
  featureId: string,
  liveHash: string,
  lm: LeaseManager,
  taskCapabilities: Map<string, Capability[]>,
  deployOpts?: DeployOpts,
): DispatchedTask[] | Promise<DispatchedTask[]> {
  // Step 1: filter by gates + generation-permit + park exclusion.
  const candidates = dispatchableForGeneration(store, featureId, liveHash);

  if (deployOpts === undefined) {
    // Synchronous path — no deploy-stage execution; backward-compatible.
    const dispatched: DispatchedTask[] = [];

    for (const task of candidates) {
      const caps = taskCapabilities.get(task.id) ?? [];

      // Steps 2-4: lease → running → pin generation.
      if (!dispatchStep(store, task.id, caps, lm)) {
        continue;
      }

      dispatched.push({ taskId: task.id });
    }

    return dispatched;
  }

  // Async path — deploy-stage execution through the real lifecycle.
  const opts = deployOpts;
  return (async (): Promise<DispatchedTask[]> => {
    const dispatched: DispatchedTask[] = [];

    for (const task of candidates) {
      const caps = taskCapabilities.get(task.id) ?? [];

      // Steps 2-4: lease → running → pin generation.
      if (!dispatchStep(store, task.id, caps, lm)) {
        continue;
      }

      // Step 5: deploy-stage execution.
      const kindRow = store.get<{ kind: string }>(
        "SELECT kind FROM plan_node WHERE id = ?",
        task.id,
      );
      if (kindRow?.kind === "deploy-stage") {
        const result = await runDeployNode(store, task.id, opts.handlers, opts.clock);
        if (result.result === "pass") {
          markExitGatePassed(store, task.id);
          opts.onEvent("notify_human", { stageId: task.id });
          dispatched.push({ taskId: task.id, outcome: "pass" });
        } else {
          // halt_and_escalate: gate is NOT marked; downstream stages remain blocked.
          opts.onEvent("halt_and_escalate", { stageId: task.id, evidence: result.evidence });
          dispatched.push({ taskId: task.id, outcome: "halt" });
        }
      } else {
        dispatched.push({ taskId: task.id });
      }
    }

    return dispatched;
  })();
}
