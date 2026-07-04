import { readFile } from "node:fs/promises";
import type { FeatureStore } from "../store/feature-store.ts";

export interface ToolCall {
  name: string;
  args: unknown;
}

export type BeforeToolCallHook = (call: ToolCall) => "allow" | "block";

export interface SessionBrief {
  taskBody: string;
  epicBody: string;
  runbook: string;
  state: string;
  agentsMd: string;
}

export interface ScriptedAgent {
  steps: ToolCall[];
}

export interface AgentSession {
  readonly brief: SessionBrief;
  run(): Promise<void>;
  teardown(): void;
}

export interface SpawnCtx {
  store: FeatureStore;
  storyId: string;
  taskStem: string;
  agentsMdPath: string;
  agent: ScriptedAgent;
  beforeToolCall?: BeforeToolCallHook;
}

function defaultAllow(_call: ToolCall): "allow" {
  return "allow";
}

async function buildSession(ctx: SpawnCtx): Promise<AgentSession> {
  const { store, storyId, taskStem, agentsMdPath, agent, beforeToolCall } =
    ctx;

  // Read the feature doc to obtain epic body, runbook, and task body
  const featureDoc = await store.readFeature();
  const epicBody = featureDoc.epic.body;
  const runbook = featureDoc.runbook;

  // Locate the task body under the matching story
  const storyEntry = featureDoc.stories.find((s) => s.story.id === storyId);
  let taskBody = "";
  if (storyEntry !== undefined) {
    const taskFilename = `${taskStem}.md`;
    const task = storyEntry.tasks.find((t) => t.filename === taskFilename);
    if (task !== undefined) {
      taskBody = task.body;
    }
  }

  // Read STATE fresh from disk (empty string when absent)
  const state = await store.readState(storyId, taskStem);

  // Read AGENTS.md from the provided path
  const agentsMd = await readFile(agentsMdPath, "utf8");

  const brief: SessionBrief = { taskBody, epicBody, runbook, state, agentsMd };
  const hook = beforeToolCall ?? defaultAllow;

  const session: AgentSession = {
    brief,
    async run(): Promise<void> {
      for (const step of agent.steps) {
        const verdict = hook(step);
        if (verdict === "block") {
          throw new Error(`tool call blocked: ${step.name}`);
        }
      }
    },
    teardown(): void {
      // disposable session — nothing to clean up in the fake
    },
  };

  return session;
}

/** Spawn a fresh session, reading all inputs from disk. */
export async function spawnSession(ctx: SpawnCtx): Promise<AgentSession> {
  return buildSession(ctx);
}

/**
 * Respawn a session after teardown, reading STATE.md fresh from disk.
 * No in-memory state from the prior session is retained — the respawned
 * session reconstructs solely from the on-disk STATE.md and the durable
 * inputs (task body, epic body, runbook, AGENTS.md).
 */
export async function respawnSession(ctx: SpawnCtx): Promise<AgentSession> {
  return buildSession(ctx);
}
