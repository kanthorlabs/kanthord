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

import type { AgentOptions, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { PI_EXEC_TOOLS } from "./pi-tools.ts";
import { buildWorktreeTools } from "./worktree-tools.ts";

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
   * Ignored when streamFn is present (streamFn takes precedence).
   */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /**
   * Stream function from a resolved provider session (Epic 019.4).
   * When present, threads into AgentOptions.streamFn and suppresses getApiKey
   * so no api-key branch is active.
   */
  streamFn?: StreamFn;
  /**
   * Durable model-call gate invoked immediately before each provider stream.
   * A rejected gate prevents that provider invocation.
   */
  beforeModelCall?: () => Promise<void>;
  /**
   * Absolute path to the session's worktree directory.
   * When present, real file-operation tools are built via buildWorktreeTools(cwd)
   * instead of no-op stubs. bash remains excluded by construction (Epic 019.15).
   */
  worktreePath?: string;
}

interface GuardedAgentOptions extends AgentOptions {
  streamFn?: (...args: Parameters<StreamFn>) => Promise<Awaited<ReturnType<StreamFn>>>;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Build the AgentOptions for `new Agent(makeAgentOpts(opts))`.
 *
 * When `opts.worktreePath` is present, real pi coding-agent factory tools
 * (read/write/edit/grep/find/ls) are built via `buildWorktreeTools(cwd)` and
 * their `execute` bodies perform live file operations inside the worktree.
 * `bash` is excluded by construction inside `buildWorktreeTools` (Epic 019.15).
 *
 * When `opts.worktreePath` is absent (e.g. unit tests that do not exercise
 * file I/O), each non-exec name in `opts.tools` becomes a minimal stub
 * AgentTool whose `execute` body is a no-op placeholder.  `PI_EXEC_TOOLS`
 * names (bash) are filtered out of the stub path as well, so exec/shell tools
 * are never exposed to the model in either path — this is the "exclude bash by
 * construction" invariant.
 *
 * `beforeToolCall` is passed through unchanged so the ring-1 hook reference is
 * preserved (test assertions use reference equality).
 */
export function makeAgentOpts(opts: AgentAdapterOpts): GuardedAgentOptions {
  // When a worktree cwd is available, use real factory tools (read/write/edit/
  // grep/find/ls) bound to that directory. bash is excluded by construction in
  // buildWorktreeTools. Fall back to minimal stubs when no cwd is provided
  // (e.g. tests that do not exercise file I/O).
  const tools: AgentTool<any>[] =
    opts.worktreePath !== undefined
      ? (buildWorktreeTools(opts.worktreePath) as AgentTool<any>[]).filter((t) =>
          opts.tools.includes(t.name),
        )
      : opts.tools
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
              execute: async (): Promise<never> => {
                throw new Error(
                  `no workspace bound: tool "${name}" unavailable (no worktree cwd)`,
                );
              },
            };
            return stub as unknown as AgentTool<any>;
          });

  const result: GuardedAgentOptions = {
    initialState: { tools },
    beforeToolCall: opts.beforeToolCall,
  };
  if (opts.model !== undefined) {
    // AgentState.model is not in the Omit exclusion list so it is allowed
    // in initialState.  Cast via unknown to satisfy the Partial<Omit<…>>
    // constraint without importing AgentState directly.
    (result.initialState as Record<string, unknown>)["model"] = opts.model;
  }
  if (opts.streamFn !== undefined) {
    const providerStreamFn = opts.streamFn;
    result.streamFn = async (model, context, streamOptions) => {
      await opts.beforeModelCall?.();
      return providerStreamFn(model, context, streamOptions);
    };
    // When streamFn is provided, suppress getApiKey — the provider session
    // owns authentication via the stream function.
  } else if (opts.getApiKey !== undefined) {
    result.getApiKey = opts.getApiKey;
  }
  return result;
}
