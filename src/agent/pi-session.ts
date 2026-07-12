/**
 * pi Session adapter — Story 016/002
 *
 * Spawns a pi session in a task worktree with the assembled brief, the ring-1
 * policy chain attached as `beforeToolCall`, and a filtered tool manifest.
 * Session events are appended to the task journal through the FeatureStore seam.
 */

import { readFile } from "node:fs/promises";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { FeatureStore } from "../store/feature-store.ts";
import type { AttemptEvidence } from "../scheduler/attempt-evidence.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A read-only session event emitted by the pi adapter and forwarded to the
 * daemon-side sink. Carries the correlation anchor (task_id, attempt,
 * session_id) so downstream stories can thread the timeline.
 * Additional fields depend on the event kind.
 */
export interface SessionEvent {
  kind: "tool_call" | "message" | "model_call" | "error";
  task_id: string;
  attempt: number;
  session_id: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Public error types
// ---------------------------------------------------------------------------

export class NoRing1ChainError extends Error {
  constructor() {
    super(
      "NoRing1ChainError: ring1Chain is required; spawning a pi session without the ring-1 policy chain is a security invariant violation",
    );
    this.name = "NoRing1ChainError";
  }
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PiSessionHandle {
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;
  contextTokens: number;
  /**
   * Session-end classification (Epic 019.3 Story 001 T2).
   * Absent (undefined) = clean completion; "aborted" | "error" = routes to
   * lifecycle/crash path without gate evaluation.
   */
  stopReason?: "aborted" | "error";
}

export interface FakePiSurface {
  spawnAgent(opts: {
    systemPrompt: string;
    tools: string[];
    beforeToolCall: unknown;
    env: Record<string, string>;
    worktreePath?: string;
    model?: Model<any>;
    streamFn?: StreamFn;
    /** Outbound, read-only event sink forwarded from PiSpawnOpts (Epic 019.5). */
    eventSink?: (e: SessionEvent) => void;
  }): PiSessionHandle;
}

export interface BudgetLedger {
  charge(taskId: string, tokens: number): void;
}

export interface PiSpawnOpts {
  store: FeatureStore;
  storyId: string;
  taskStem: string;
  agentsMdPath: string;
  ring1Chain: ((ctx: unknown, signal?: AbortSignal) => Promise<unknown>) | undefined;
  piSurface: FakePiSurface;
  allowedToolNames: string[];
  spawnEnv: Record<string, string>;
  safeEnvAllowlist?: string[];
  taskId?: string;
  budgetLedger?: BudgetLedger;
  scriptedTokenUsage?: number[];
  priorContext?: string;
  worktreePath?: string;
  /** Per-tool usage guidance keyed by tool name. Only entries whose key is in
   * allowedToolNames are included in the assembled prompt (6th block). */
  toolGuidance?: Record<string, string>;
  /**
   * Failure evidence from the most recent gate evaluation (Epic 019.3 Story 002).
   * When present and non-null, injected after AGENTS.md as the next prompt block.
   */
  evidence?: AttemptEvidence | null;
  /** Provider model for this session (Epic 019.4). When present, forwarded to piSurface.spawnAgent. */
  model?: Model<any>;
  /** Provider stream function for this session (Epic 019.4). When present, forwarded to piSurface.spawnAgent. */
  streamFn?: StreamFn;
  /**
   * Outbound, read-only event sink (Epic 019.5). When present, forwarded to
   * piSurface.spawnAgent so the real pi adapter can wire agent.subscribe to it.
   * Consumers receive events; they cannot inject or mutate the session through this sink.
   */
  eventSink?: (e: SessionEvent) => void;
}

export interface PiTeardownOpts {
  handle: PiSessionHandle;
  store: FeatureStore;
  storyId: string;
  taskStem: string;
  checkpointState: string;
  taskId?: string;
}

/** Same shape as PiSpawnOpts but priorContext is intentionally absent. */
export interface PiRespawnOpts {
  store: FeatureStore;
  storyId: string;
  taskStem: string;
  agentsMdPath: string;
  ring1Chain: ((ctx: unknown, signal?: AbortSignal) => Promise<unknown>) | undefined;
  piSurface: FakePiSurface;
  allowedToolNames: string[];
  spawnEnv: Record<string, string>;
  safeEnvAllowlist?: string[];
  taskId?: string;
  budgetLedger?: BudgetLedger;
  scriptedTokenUsage?: number[];
  worktreePath?: string;
  /** Per-tool usage guidance keyed by tool name. Only entries whose key is in
   * allowedToolNames are included in the assembled prompt (6th block). */
  toolGuidance?: Record<string, string>;
  /**
   * Failure evidence from the most recent gate evaluation (Epic 019.3 Story 002).
   * When present and non-null, injected after AGENTS.md as the next prompt block.
   */
  evidence?: AttemptEvidence | null;
  /** Provider model for this session (Epic 019.4). When present, forwarded to piSurface.spawnAgent. */
  model?: Model<any>;
  /** Provider stream function for this session (Epic 019.4). When present, forwarded to piSurface.spawnAgent. */
  streamFn?: StreamFn;
  /**
   * Outbound, read-only event sink (Epic 019.5). When present, forwarded to
   * piSurface.spawnAgent so the real pi adapter can wire agent.subscribe to it.
   * Mirrors PiSpawnOpts.eventSink — respawned sessions emit events through the same sink.
   */
  eventSink?: (e: SessionEvent) => void;
}

// ---------------------------------------------------------------------------
// Spawn implementation
// ---------------------------------------------------------------------------

/**
 * Spawn a pi session with the assembled brief in documented order:
 *   1. task body
 *   2. epic body
 *   3. RUNBOOK
 *   4. STATE (empty string if no checkpoint yet)
 *   5. AGENTS.md (tolerated if absent — journal event written)
 *
 * Throws `NoRing1ChainError` if `ring1Chain` is undefined (structural invariant).
 */
export async function spawnPiSession(opts: PiSpawnOpts): Promise<PiSessionHandle> {
  const {
    store,
    storyId,
    taskStem,
    agentsMdPath,
    ring1Chain,
    piSurface,
    allowedToolNames,
    spawnEnv,
    safeEnvAllowlist,
    taskId,
    budgetLedger,
    scriptedTokenUsage,
    worktreePath,
    toolGuidance,
    evidence,
    model,
    streamFn,
    eventSink,
  } = opts;

  // --- (b) structural ring-1 invariant ---
  if (ring1Chain === undefined) {
    throw new NoRing1ChainError();
  }

  // --- read feature doc for task body, epic body, runbook ---
  const featureDoc = await store.readFeature();

  // Locate the task body for storyId + taskStem
  let taskBody = "";
  for (const storyEntry of featureDoc.stories) {
    if (storyEntry.story.id === storyId) {
      for (const task of storyEntry.tasks) {
        // task filename is taskStem + ".md"
        if (task.filename === `${taskStem}.md`) {
          taskBody = task.body;
          break;
        }
      }
      break;
    }
  }

  const epicBody = featureDoc.epic.body;
  const runbook = featureDoc.runbook;

  // --- (c) missing STATE → empty-string default ---
  const state = await store.readState(storyId, taskStem);

  // --- (c) missing AGENTS.md → tolerated + journaled ---
  let agentsMd = "";
  try {
    agentsMd = await readFile(agentsMdPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Journal the missing AGENTS.md event
      await store.appendJournal(storyId, taskStem, {
        tag: "agents_md_missing",
        agentsMdPath,
        timestamp: new Date().toISOString(),
      });
    } else {
      throw err;
    }
  }

  // --- assemble system prompt in documented order ---
  // Intentional divergence: only AGENTS.md is loaded here (no CLAUDE.md, no walk-up).
  // kanthord embeds pi-agent-core directly; pi-coding-agent's buildSystemPrompt is
  // bypassed, so per-tool guidance must be injected explicitly as the 6th block.
  const guidanceParts: string[] = [];
  if (toolGuidance !== undefined) {
    for (const toolName of allowedToolNames) {
      const snippet = toolGuidance[toolName];
      if (snippet !== undefined) {
        guidanceParts.push(snippet);
      }
    }
  }
  const promptParts = [taskBody, epicBody, runbook, state, agentsMd];
  if (worktreePath !== undefined) {
    promptParts.push(
      `## Working directory\n\nYou are working in the repository at \`${worktreePath}\`. Create and edit files inside this directory (e.g. \`${worktreePath}/<file>\`).`,
    );
  }
  if (evidence !== undefined && evidence !== null) {
    promptParts.push(
      `## Prior Attempt Evidence (attempt ${evidence.attempt}, phase ${evidence.phase})\n\n${evidence.summary}`,
    );
  }
  if (guidanceParts.length > 0) {
    promptParts.push(guidanceParts.join("\n"));
  }
  const systemPrompt = promptParts.join("\n\n");

  // --- build sanitized spawn env ---
  const env: Record<string, string> = {};
  if (safeEnvAllowlist !== undefined) {
    for (const key of safeEnvAllowlist) {
      const val = spawnEnv[key];
      if (val !== undefined) {
        env[key] = val;
      }
    }
  }

  // --- spawn the session via the pi surface ---
  const handle = piSurface.spawnAgent({
    systemPrompt,
    tools: allowedToolNames,
    beforeToolCall: ring1Chain,
    env,
    worktreePath,
    model,
    streamFn,
    eventSink,
  });

  // --- (e) charge budget ledger for scripted token usage ---
  if (budgetLedger !== undefined && scriptedTokenUsage !== undefined) {
    const resolvedTaskId = taskId ?? taskStem;
    for (const tokens of scriptedTokenUsage) {
      budgetLedger.charge(resolvedTaskId, tokens);
    }
  }

  // --- (f) journal session_spawned event ---
  await store.appendJournal(storyId, taskStem, {
    tag: "session_spawned",
    taskId: taskId ?? taskStem,
    sessionId: `session-${Date.now()}`,
    timestamp: new Date().toISOString(),
  });

  return handle;
}

// ---------------------------------------------------------------------------
// Teardown implementation
// ---------------------------------------------------------------------------

/**
 * Checkpoint the current session state to disk, then abort the session handle.
 * Journals a `session_torn_down` event.
 */
export async function teardownPiSession(opts: PiTeardownOpts): Promise<void> {
  const { handle, store, storyId, taskStem, checkpointState, taskId } = opts;

  // Write checkpoint state to disk before aborting
  await store.writeState(storyId, taskStem, checkpointState);

  // Destroy the session
  handle.abort();

  // Journal the teardown event
  await store.appendJournal(storyId, taskStem, {
    tag: "session_torn_down",
    taskId: taskId ?? taskStem,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Respawn implementation
// ---------------------------------------------------------------------------

/**
 * Respawn a pi session reading fresh STATE from disk (no priorContext injected).
 * Durable inputs (task, epic, runbook, agentsMd) are preserved.
 * Journals a `session_respawned` event instead of `session_spawned`.
 */
export async function respawnPiSession(opts: PiRespawnOpts): Promise<PiSessionHandle> {
  const {
    store,
    storyId,
    taskStem,
    agentsMdPath,
    ring1Chain,
    piSurface,
    allowedToolNames,
    spawnEnv,
    safeEnvAllowlist,
    taskId,
    budgetLedger,
    scriptedTokenUsage,
    worktreePath,
    toolGuidance,
    evidence,
    model,
    streamFn,
    eventSink,
  } = opts;

  // --- structural ring-1 invariant ---
  if (ring1Chain === undefined) {
    throw new NoRing1ChainError();
  }

  // --- read feature doc for task body, epic body, runbook ---
  const featureDoc = await store.readFeature();

  // Locate the task body for storyId + taskStem
  let taskBody = "";
  for (const storyEntry of featureDoc.stories) {
    if (storyEntry.story.id === storyId) {
      for (const task of storyEntry.tasks) {
        if (task.filename === `${taskStem}.md`) {
          taskBody = task.body;
          break;
        }
      }
      break;
    }
  }

  const epicBody = featureDoc.epic.body;
  const runbook = featureDoc.runbook;

  // --- read fresh STATE from disk (not any prior session content) ---
  const state = await store.readState(storyId, taskStem);

  // --- tolerate missing AGENTS.md + journal event ---
  let agentsMd = "";
  try {
    agentsMd = await readFile(agentsMdPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await store.appendJournal(storyId, taskStem, {
        tag: "agents_md_missing",
        agentsMdPath,
        timestamp: new Date().toISOString(),
      });
    } else {
      throw err;
    }
  }

  // --- assemble system prompt in documented order (no priorContext) ---
  const guidanceParts: string[] = [];
  if (toolGuidance !== undefined) {
    for (const toolName of allowedToolNames) {
      const snippet = toolGuidance[toolName];
      if (snippet !== undefined) {
        guidanceParts.push(snippet);
      }
    }
  }
  const promptParts = [taskBody, epicBody, runbook, state, agentsMd];
  if (worktreePath !== undefined) {
    promptParts.push(
      `## Working directory\n\nYou are working in the repository at \`${worktreePath}\`. Create and edit files inside this directory (e.g. \`${worktreePath}/<file>\`).`,
    );
  }
  if (evidence !== undefined && evidence !== null) {
    promptParts.push(
      `## Prior Attempt Evidence (attempt ${evidence.attempt}, phase ${evidence.phase})\n\n${evidence.summary}`,
    );
  }
  if (guidanceParts.length > 0) {
    promptParts.push(guidanceParts.join("\n"));
  }
  const systemPrompt = promptParts.join("\n\n");

  // --- build sanitized spawn env ---
  const env: Record<string, string> = {};
  if (safeEnvAllowlist !== undefined) {
    for (const key of safeEnvAllowlist) {
      const val = spawnEnv[key];
      if (val !== undefined) {
        env[key] = val;
      }
    }
  }

  // --- spawn the new session ---
  const handle = piSurface.spawnAgent({
    systemPrompt,
    tools: allowedToolNames,
    beforeToolCall: ring1Chain,
    env,
    worktreePath,
    model,
    streamFn,
    eventSink,
  });

  // --- charge budget ledger for scripted token usage ---
  if (budgetLedger !== undefined && scriptedTokenUsage !== undefined) {
    const resolvedTaskId = taskId ?? taskStem;
    for (const tokens of scriptedTokenUsage) {
      budgetLedger.charge(resolvedTaskId, tokens);
    }
  }

  // --- journal session_respawned event ---
  await store.appendJournal(storyId, taskStem, {
    tag: "session_respawned",
    taskId: taskId ?? taskStem,
    sessionId: `session-${Date.now()}`,
    timestamp: new Date().toISOString(),
  });

  return handle;
}
