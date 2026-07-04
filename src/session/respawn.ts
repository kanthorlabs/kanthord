import { respawnSession } from "./agent-session.ts";
import type { SpawnCtx, AgentSession } from "./agent-session.ts";

export type RespawnTrigger = "threshold" | "task-boundary" | "crash";

export interface ModelConfig {
  windowTokens: number;
  compactionRatio: number;
}

export interface Checkpointable {
  checkpoint(): Promise<void>;
}

export interface SchedulerView {
  pendingTaskIds(featureId: string): string[];
}

export interface LeaseView {
  heldBy(taskId: string): string[];
}

export interface RespawnRequest {
  ctx: SpawnCtx;
  currentSession: AgentSession;
  featureId: string;
  taskId: string;
  schedulerView: SchedulerView;
  leaseView: LeaseView;
  trigger?: RespawnTrigger;
  workflow?: Checkpointable;
}

export interface RespawnResult {
  session: AgentSession;
  currentPhase: string;
  pendingTaskIds: string[];
  heldCapabilityKeys: string[];
}

function parseCurrentPhase(stateContent: string): string {
  const match = /current_phase:\s*(\S+)/.exec(stateContent);
  return match?.[1] ?? "";
}

/**
 * Returns true when `reportedSize` exceeds the compaction threshold for
 * the given model (windowTokens * compactionRatio).
 */
export function shouldTriggerThreshold(
  reportedSize: number,
  config: ModelConfig,
): boolean {
  return reportedSize > config.windowTokens * config.compactionRatio;
}

/**
 * Single respawn coordinator — the sole authority for tearing down and
 * recreating a session (PRD §3.2 one code path; §7.7 respawn-equivalence).
 *
 * Steps (threshold): checkpoint → teardown → reconstruct from disk STATE +
 * durable inputs → snapshot scheduler + lease views → parse current phase.
 * Steps (task-boundary / crash): teardown (no checkpoint) → same remainder.
 */
export async function respawnCoordinator(
  req: RespawnRequest,
): Promise<RespawnResult> {
  if (req.trigger === "threshold" && req.workflow !== undefined) {
    await req.workflow.checkpoint();
  }
  req.currentSession.teardown();
  const session = await respawnSession(req.ctx);
  const pendingTaskIds = req.schedulerView.pendingTaskIds(req.featureId);
  const heldCapabilityKeys = req.leaseView.heldBy(req.taskId);
  const currentPhase = parseCurrentPhase(session.brief.state);
  return { session, currentPhase, pendingTaskIds, heldCapabilityKeys };
}
