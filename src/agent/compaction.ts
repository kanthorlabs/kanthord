/**
 * Compaction threshold helpers for Story 016/003.
 *
 * Resolves per-model compaction config, checks whether the current
 * context-size signal strictly exceeds the configured threshold, and
 * journals a `compaction_triggered` event when triggered.
 */

import type { FeatureStore } from "../store/feature-store.ts";
import type { SpawnCtx, AgentSession } from "../session/agent-session.ts";
import {
  respawnCoordinator,
  type Checkpointable,
  type SchedulerView,
  type LeaseView,
  type RespawnResult,
} from "../session/respawn.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelCompactionConfig {
  window: number;
  compaction_threshold: number;
}

export interface CompactionModelRegistry {
  models: Record<string, ModelCompactionConfig>;
  default: ModelCompactionConfig;
}

export interface CompactionJournalOpts {
  store: FeatureStore;
  storyId: string;
  taskStem: string;
  taskId: string;
  model: string;
  signalValue: number;
  config: ModelCompactionConfig;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Returns the per-model config from the registry, or the system default
 * when the model key is absent.
 */
export function resolveModelConfig(
  model: string,
  registry: CompactionModelRegistry,
): ModelCompactionConfig {
  const perModel = registry.models[model];
  return perModel !== undefined ? perModel : registry.default;
}

/**
 * Returns true only when `signalValue` is STRICTLY greater than the computed
 * threshold (`config.window * config.compaction_threshold`). Equality does NOT
 * trigger compaction.
 */
export function exceedsCompactionThreshold(
  signalValue: number,
  config: ModelCompactionConfig,
): boolean {
  return signalValue > config.window * config.compaction_threshold;
}

/**
 * Appends a `compaction_triggered` journal event to the store, recording
 * the signal value, the computed threshold, the model name, and the taskId.
 */
export async function journalCompactionEvent(
  opts: CompactionJournalOpts,
): Promise<void> {
  const { store, storyId, taskStem, taskId, model, signalValue, config } = opts;
  const threshold = Math.round(config.window * config.compaction_threshold);
  await store.appendJournal(storyId, taskStem, {
    tag: "compaction_triggered",
    taskId,
    model,
    signalValue,
    threshold,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Task T2 — one respawn path + equivalence
// ---------------------------------------------------------------------------

export type CompactionTrigger = "threshold" | "task-boundary" | "crash";

export interface CompactionRunOpts {
  trigger: CompactionTrigger;
  ctx: SpawnCtx;
  currentSession: AgentSession;
  featureId: string;
  taskId: string;
  schedulerView: SchedulerView;
  leaseView: LeaseView;
  workflow?: Checkpointable;
  store: FeatureStore;
  storyId: string;
  taskStem: string;
  model: string;
  signalValue: number;
  config: ModelCompactionConfig;
}

/**
 * Runs compaction for the given trigger. For "threshold" triggers only,
 * journals the compaction event and passes the workflow to the respawn
 * coordinator so it can checkpoint before teardown. All three triggers
 * delegate to the single Epic 006 respawn coordinator (PRD §3.2 one
 * code path).
 */
export async function runCompaction(
  opts: CompactionRunOpts,
): Promise<RespawnResult> {
  const {
    trigger, ctx, currentSession, featureId, taskId,
    schedulerView, leaseView, workflow, store, storyId, taskStem,
    model, signalValue, config,
  } = opts;

  if (trigger === "threshold") {
    await journalCompactionEvent({ store, storyId, taskStem, taskId, model, signalValue, config });
  }

  return respawnCoordinator({
    trigger,
    ctx,
    currentSession,
    featureId,
    taskId,
    schedulerView,
    leaseView,
    workflow,
  });
}
