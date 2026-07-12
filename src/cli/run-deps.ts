/**
 * src/cli/run-deps.ts
 *
 * Testable deps-assembly factory for the kanthord run daemon (Epic 019.2).
 *
 * `buildRealDeps` constructs the RunDaemonDeps for the live path from a store +
 * featureDir. An injectable `agentFactory` seam lets tests capture AgentOptions
 * without making a real model call (RB1).
 *
 * Decisions (recorded — live-path-enforcement-gaps.md):
 *   patternRegistry : null  — fail-closed MVP; no patterns file wired yet
 *                             (Gap 2: missing registry must block, not skip).
 *   tickIntervalMs  : 5_000 — positive, drives the auto-tick loop (RB2).
 *   toolGuidance    : default per-tool snippets for PI_DEFAULT_ALLOWED_MANIFEST
 *                     (GAP5 — kanthord bypasses pi-coding-agent buildSystemPrompt;
 *                      per-tool guidance injected as the 6th system-prompt block).
 *                     AGENTS.md is the only walk-up source (no CLAUDE.md).
 */

import { Agent, estimateContextTokens } from "@earendil-works/pi-agent-core";
import type { AgentOptions } from "@earendil-works/pi-agent-core";
import { makeAgentOpts } from "../agent/pi-agent-adapter.ts";
import type { AgentAdapterOpts } from "../agent/pi-agent-adapter.ts";
import { PI_DEFAULT_ALLOWED_MANIFEST } from "../agent/pi-tools.ts";
import { createStatusServer } from "../daemon/status-server.ts";
import type { PiSurface, RunDaemonDeps, StatusServerFactory } from "../daemon/run-loop.ts";
import type { Clock } from "../foundations/clock.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Logger } from "../daemon/boot.ts";
import { loadIdentity, IdentityLoadError } from "../git/keyring.ts";
import { makeBranchAdapter, makeCommitAdapter } from "../broker/verbs/git-local.ts";
import { makePushAdapter } from "../broker/verbs/git-push.ts";
import { makeGithubHttpSeam } from "../broker/verbs/github-http.ts";
import { makeCreatePrAdapter } from "../broker/verbs/github-create-pr.ts";
import { makeOutboundScanGuard } from "../ring1/outbound-scan-guard.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "../broker/registry.ts";
import type { PatternRegistry } from "../ring1/secret-scan.ts";

// ---------------------------------------------------------------------------
// Default tool guidance (GAP5)
// ---------------------------------------------------------------------------

/**
 * Minimal per-tool usage guidance for PI_DEFAULT_ALLOWED_MANIFEST.
 * These defaults are a decision-recorded placeholder; operators may supply
 * richer guidance via the feature RUNBOOK or task body.
 */
const DEFAULT_TOOL_GUIDANCE: Record<string, string> = {
  read: "read — read the full contents of a file",
  grep: "grep — search file contents with a pattern (case-sensitive by default)",
  find: "find — locate files matching a glob or name pattern",
  ls: "ls — list directory contents",
  edit: "edit — apply a targeted string replacement to a file (preferred for patches)",
  write: "write — write complete file contents to disk (full overwrite)",
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal agent handle shape required from the injectable factory. */
interface AgentHandle {
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;
  prompt(input: string): Promise<void>;
}

/** Options accepted by buildRealDeps. */
export interface BuildRealDepsOpts {
  /** Opened SQLite store — lifetime managed by the caller. */
  store: Store;
  /** Path to the feature directory (slot-derived). */
  featureDir: string;
  /**
   * Injectable agent factory for testing.  Receives the full AgentOptions
   * produced by makeAgentOpts and returns a minimal handle.  When omitted,
   * `new Agent(agentOpts)` is used in the live path.
   */
  agentFactory?: (opts: AgentOptions) => AgentHandle;
  /**
   * Default model for spawned agents — resolved at boot time by
   * resolveDaemonProviderSession (Epic 019.6 T2).
   * Used as the spawn model when the caller does not supply one.
   */
  providerModel?: AgentAdapterOpts["model"];
  /**
   * Default stream function for spawned agents — resolved at boot time.
   * Used as the spawn streamFn when the caller does not supply one.
   */
  providerStreamFn?: AgentAdapterOpts["streamFn"];
  /** Optional named identity for broker PAT authentication (Story 002). */
  identity?: string;
  /** Path to the 0600 credential file for the named identity. */
  identityFile?: string;
  /** Repository "owner/name" for github.create_pr adapter (Story 003). */
  repo?: string;
  /**
   * Pattern registry for outbound secret scanning (Story 003).
   * Overrides the fail-closed null default when explicitly provided.
   */
  patternRegistry?: PatternRegistry | null;
}

// ---------------------------------------------------------------------------
// Minimal VerbRegistryEntry factory (Story 003 inline stubs)
// ---------------------------------------------------------------------------

function makeMinimalEntry(verb: string): VerbRegistryEntry {
  return {
    verb,
    tier: "auto",
    timeout: 60_000,
    idempotency: { window_ms: 0 },
    retry: { max: 3, backoff: "linear" },
    poll_interval: 1_000,
    terminal_states: ["done"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
}

// ---------------------------------------------------------------------------
// buildRealDeps
// ---------------------------------------------------------------------------

/**
 * Assemble RunDaemonDeps for the live kanthord run path.
 *
 * Returns a superset of RunDaemonDeps that includes `toolGuidance` (GAP5),
 * ready to be threaded into spawnPiSession by tick().
 */
export function buildRealDeps(
  opts: BuildRealDepsOpts & { identity: string; identityFile: string },
): Promise<RunDaemonDeps & { identityToken: string; toolGuidance: Record<string, string>; verbAdapters?: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }> }>;
export function buildRealDeps(
  opts: BuildRealDepsOpts,
): RunDaemonDeps & { toolGuidance: Record<string, string> };
export function buildRealDeps(
  opts: BuildRealDepsOpts,
): (RunDaemonDeps & { toolGuidance: Record<string, string> }) | Promise<RunDaemonDeps & { identityToken: string; toolGuidance: Record<string, string>; verbAdapters?: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }> }> {
  const { store, featureDir, agentFactory, providerModel, providerStreamFn, identity, identityFile, repo, patternRegistry } = opts;

  const clock: Clock = {
    now(): number {
      return Date.now();
    },
    setTimer(delayMs: number, cb: () => void): void {
      setTimeout(cb, delayMs);
    },
  };

  const logger: Logger = {
    info(record: Record<string, unknown>): void {
      process.stdout.write(JSON.stringify(record) + "\n");
    },
  };

  const statusServerFactory: StatusServerFactory = createStatusServer;

  const piSurface: PiSurface = {
    spawnAgent(rawOpts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      contextTokens: number;
    } {
      // rawOpts is typed as unknown at the PiSurface seam; extract the
      // fields makeAgentOpts needs (tools + beforeToolCall + model + streamFn).
      const spawnOpts = rawOpts as {
        tools?: string[];
        beforeToolCall?: AgentAdapterOpts["beforeToolCall"];
        model?: AgentAdapterOpts["model"];
        streamFn?: AgentAdapterOpts["streamFn"];
        systemPrompt?: string;
      };

      const agentOpts = makeAgentOpts({
        tools: spawnOpts.tools ?? [],
        // fallback: no-op hook (ring-1 chain always present in production;
        // this only fires when spawnAgent is called without beforeToolCall)
        beforeToolCall:
          spawnOpts.beforeToolCall ??
          (async () => undefined as ReturnType<AgentAdapterOpts["beforeToolCall"]> extends Promise<infer R> ? R : never),
        model: spawnOpts.model ?? providerModel,
        streamFn: spawnOpts.streamFn ?? providerStreamFn,
      });

      const systemPrompt = spawnOpts.systemPrompt;

      if (agentFactory !== undefined) {
        const handle = agentFactory(agentOpts);
        const runPromise: Promise<void> | undefined =
          typeof systemPrompt === "string" && systemPrompt.length > 0
            ? handle.prompt(systemPrompt)
            : undefined;
        return {
          abort: (): void => {
            handle.abort();
          },
          waitForIdle: async (): Promise<void> => {
            if (runPromise !== undefined) {
              await runPromise.catch((_err: unknown) => undefined);
            }
            await handle.waitForIdle();
          },
          reset: (): void => {
            handle.reset();
          },
          contextTokens: 0,
        };
      }

      // Live path: real Agent.
      const agent = new Agent(agentOpts);
      const runPromise: Promise<void> | undefined =
        typeof systemPrompt === "string" && systemPrompt.length > 0
          ? agent.prompt(systemPrompt)
          : undefined;
      return {
        abort: (): void => {
          agent.abort();
        },
        waitForIdle: async (): Promise<void> => {
          if (runPromise !== undefined) {
            await runPromise.catch((_err: unknown) => undefined);
          }
          await agent.waitForIdle();
        },
        reset: (): void => {
          agent.reset();
        },
        get contextTokens(): number {
          return estimateContextTokens(agent.state.messages).tokens;
        },
      };
    },
  };

  // Build toolGuidance for every allowed manifest entry (GAP5).
  // noUncheckedIndexedAccess: guard before use.
  const toolGuidance: Record<string, string> = {};
  for (const name of PI_DEFAULT_ALLOWED_MANIFEST) {
    const guidance = DEFAULT_TOOL_GUIDANCE[name];
    toolGuidance[name] = guidance !== undefined ? guidance : name;
  }

  const baseDeps = {
    store,
    featureDir,
    clock,
    logger,
    piSurface,
    statusServerFactory,
    tickIntervalMs: 5_000,
    patternRegistry: null, // fail-closed: no registry file path wired yet (Gap 2 MVP)
    toolGuidance,
  };

  if (identity !== undefined && identityFile !== undefined) {
    const iName = identity;
    const iFile = identityFile;
    return (async () => {
      let token: string;
      try {
        const id = await loadIdentity({ name: iName, file: iFile });
        token = id.token;
      } catch (err) {
        if (err instanceof IdentityLoadError) {
          throw new IdentityLoadError(
            err.code,
            `identity "${iName}" (file: "${iFile}"): ${err.message}`,
          );
        }
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(
          `failed to load identity "${iName}" from file "${iFile}": ${cause}`,
        );
      }
        // Build outbound scan guard from the (possibly caller-supplied) pattern registry.
      const scanGuard = makeOutboundScanGuard({
        registry: patternRegistry !== undefined ? patternRegistry : null,
        onEscalate: () => { /* escalation surfaced via logger at tick call site */ },
      });

      // Construct real adapters for the four standard broker verbs.
      const branchAdapter = makeBranchAdapter({ gitBin: "git" });
      const commitAdapter = makeCommitAdapter({ gitBin: "git" });
      const pushAdapter = makePushAdapter({ gitBin: "git", diffScanGuard: scanGuard });
      const repoSlug = repo ?? "";
      const http = makeGithubHttpSeam({ token });
      const createPrAdapter = makeCreatePrAdapter({ repo: repoSlug, token, http });

      const verbAdapters: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }> = {
        "git.branch": { entry: makeMinimalEntry("git.branch"), adapter: branchAdapter },
        "git.commit": { entry: makeMinimalEntry("git.commit"), adapter: commitAdapter },
        "git.push": { entry: makeMinimalEntry("git.push"), adapter: pushAdapter },
        "github.create_pr": { entry: makeMinimalEntry("github.create_pr"), adapter: createPrAdapter },
      };

      return { ...baseDeps, patternRegistry: patternRegistry ?? null, identityToken: token, verbAdapters };
    })();
  }

  return baseDeps;
}
