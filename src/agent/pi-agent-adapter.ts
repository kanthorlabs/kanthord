/**
 * src/agent/pi-agent-adapter.ts
 *
 * Maps the pi tool manifest (allowed string names) to the real pi Agent
 * constructor shape required by @earendil-works/pi-agent-core.
 *
 * B1 review fix — 019.2-kanthord-run-launcher:
 *   - `initialState.tools`: one stub AgentTool per non-exec tool name.
 *     PI_EXEC_TOOLS (bash) are filtered out so the model never sees exec tools.
 *   - `beforeToolCall`: the ring-1 hook passed through unchanged.
 */

import type { AgentOptions, AgentTool } from "@earendil-works/pi-agent-core";
import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { PI_EXEC_TOOLS } from "./pi-tools.ts";

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface AgentAdapterOpts {
  /** Allowed pi tool names (sourced from PI_DEFAULT_ALLOWED_MANIFEST). */
  tools: string[];
  /**
   * Ring-1 hook to bind as Agent.beforeToolCall.
   * Compatible with makeRing1HookAdapter's return signature.
   */
  beforeToolCall: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  /**
   * The pi/LLM model to use for this Agent session.
   * Env-sourced by the caller; never logged.
   */
  model?: Model<any>;
  /**
   * Provider API key resolver — env-sourced, never logged.
   * Compatible with AgentOptions.getApiKey signature.
   */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Build the AgentOptions for `new Agent(makeAgentOpts(opts))`.
 *
 * Each non-exec name in `opts.tools` becomes a minimal stub AgentTool whose
 * `execute` body is never invoked in production (pi dispatches built-in tools
 * internally); it satisfies the AgentTool interface shape only.
 *
 * `PI_EXEC_TOOLS` names (bash) are filtered out even if present in opts.tools,
 * so exec/shell tools are never exposed to the model regardless of the caller's
 * manifest — this is the "exclude bash by construction" invariant.
 *
 * `beforeToolCall` is passed through unchanged so the ring-1 hook reference is
 * preserved (test assertions use reference equality).
 */
export function makeAgentOpts(opts: AgentAdapterOpts): AgentOptions {
  const tools: AgentTool<any>[] = opts.tools
    .filter((name) => !PI_EXEC_TOOLS.has(name))
    .map((name): AgentTool<any> => {
      // Minimal stub: satisfies the AgentTool interface with name/label/
      // description/parameters/execute.  The cast via unknown is needed because
      // TParameters is constrained to TSchema (typebox) and we supply a plain {}
      // (valid structurally since TSchema is an empty interface).
      const stub = {
        name,
        label: name,
        description: `pi built-in: ${name}`,
        // TSchema is an empty interface; {} satisfies it structurally.
        parameters: {} as Record<string, never>,
        execute: async (): Promise<{ content: never[]; details: undefined }> => ({
          content: [],
          details: undefined,
        }),
      };
      return stub as unknown as AgentTool<any>;
    });

  const result: AgentOptions = {
    initialState: { tools },
    beforeToolCall: opts.beforeToolCall,
  };
  if (opts.model !== undefined) {
    // AgentState.model is not in the Omit exclusion list so it is allowed
    // in initialState.  Cast via unknown to satisfy the Partial<Omit<…>>
    // constraint without importing AgentState directly.
    (result.initialState as Record<string, unknown>)["model"] = opts.model;
  }
  if (opts.getApiKey !== undefined) {
    result.getApiKey = opts.getApiKey;
  }
  return result;
}
