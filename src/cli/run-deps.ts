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
import { access, lstat, readFile, readlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { AgentOptions, PrepareNextTurnContext } from "@earendil-works/pi-agent-core";
import { makeAgentOpts } from "../agent/pi-agent-adapter.ts";
import type { AgentAdapterOpts } from "../agent/pi-agent-adapter.ts";
import { PI_DEFAULT_ALLOWED_MANIFEST } from "../agent/pi-tools.ts";
import { createStatusServer } from "../daemon/status-server.ts";
import type { PiSurface, RunDaemonDeps, StatusServerFactory } from "../daemon/run-loop.ts";
import type { Clock } from "../foundations/clock.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import type { Logger } from "../daemon/boot.ts";
import { createRecordLogger } from "../foundations/log.ts";
import { JsonlLog } from "../foundations/jsonl.ts";
import { loadIdentity, IdentityLoadError } from "../git/keyring.ts";
import { makeBranchAdapter, makeCommitAdapter, makeAddAdapter } from "../broker/verbs/git-local.ts";
import { makeDeliveryVerifySetup } from "../git/delivery-preflight.ts";
import { makePushAdapter } from "../broker/verbs/git-push.ts";
import { makeGithubHttpSeam } from "../broker/verbs/github-http.ts";
import { makeCreatePrAdapter } from "../broker/verbs/github-create-pr.ts";
import { makeOutboundScanGuard } from "../ring1/outbound-scan-guard.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "../broker/registry.ts";
import type { PatternRegistry } from "../ring1/secret-scan.ts";
import { appendModelCallRecord } from "../metrics/model-call-log.ts";
import { runGit } from "../git/exec.ts";

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
  /**
   * Account ID for model-call log rows (Epic 019.13 S002).
   * Resolved at boot time from the active provider account.
   */
  accountId?: string;
  /**
   * Root directory of the local checkout (exists after clone).
   * When provided, the delivery preflight runs its git probe in this directory
   * instead of `featureDir` (which may not exist yet at preflight time).
   */
  checkoutDir?: string;
}

async function loadIdentityFileOrEnv(name: string, file: string): Promise<string> {
  try {
    await access(file);
    const id = await loadIdentity({ name, file });
    return id.token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const id = await loadIdentity({ name, env: true });
    return id.token;
  }
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

function worktreePath(root: string, path: string): string {
  const candidate = resolve(root, path);
  const outsideRoot = relative(root, candidate).startsWith("..");
  if (outsideRoot) throw new Error("git status returned a path outside the worktree");
  return candidate;
}

function changedPaths(status: string): Array<{ status: string; path: string }> {
  const paths: Array<{ status: string; path: string }> = [];
  for (const record of status.split("\0")) {
    if (record.length < 4 || record[2] !== " ") continue;
    const code = record.slice(0, 2);
    if (!/^[ MADRCU?!]{2}$/.test(code)) continue;
    paths.push({ status: code, path: record.slice(3) });
  }
  return paths;
}

async function inspectWorktreeDiff(cwd: string): Promise<{ hash: string; summary: string } | undefined> {
  const status = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd });
  const unstaged = await runGit(["diff", "--binary", "--no-ext-diff", "--"], { cwd });
  const staged = await runGit(["diff", "--cached", "--binary", "--no-ext-diff", "--"], { cwd });
  if (status.kind !== "success" || unstaged.kind !== "success" || staged.kind !== "success") {
    throw new Error("git worktree inspection failed");
  }
  if (status.stdout.length === 0) return undefined;

  const hash = createHash("sha256");
  hash.update("status\0").update(status.stdout);
  hash.update("unstaged\0").update(unstaged.stdout);
  hash.update("staged\0").update(staged.stdout);
  const paths = changedPaths(status.stdout);
  for (const changed of paths) {
    if (changed.status !== "??") continue;
    const path = worktreePath(cwd, changed.path);
    const file = await lstat(path);
    hash.update("untracked\0").update(changed.path).update("\0");
    if (file.isSymbolicLink()) {
      hash.update("symlink\0").update(await readlink(path));
    } else if (file.isFile()) {
      hash.update("file\0").update(await readFile(path));
    } else {
      hash.update("other\0");
    }
  }

  const summary = paths
    .map((changed) => `${changed.status} ${changed.path.replace(/[\r\n\t]/g, "?")}`)
    .join("; ");
  return { hash: hash.digest("hex"), summary };
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
  opts: BuildRealDepsOpts,
): RunDaemonDeps & { toolGuidance: Record<string, string> };
export function buildRealDeps(
  opts: BuildRealDepsOpts & { identity: string; identityFile: string },
): Promise<RunDaemonDeps & { identityToken: string; toolGuidance: Record<string, string>; verbAdapters?: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }> }>;
export function buildRealDeps(
  opts: BuildRealDepsOpts,
): (RunDaemonDeps & { toolGuidance: Record<string, string> }) | Promise<RunDaemonDeps & { identityToken: string; toolGuidance: Record<string, string>; verbAdapters?: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }> }> {
  const { store, featureDir, agentFactory, providerModel, providerStreamFn, identity, identityFile, repo, patternRegistry, accountId } = opts;

  const clock: Clock = {
    now(): number {
      return Date.now();
    },
    setTimer(delayMs: number, cb: () => void): void {
      setTimeout(cb, delayMs);
    },
  };

  // Daemon operational log stream — pino-backed (foundations/log), so every
  // logger.info({ event, ... }) call routes through the shared logger instead
  // of a hand-rolled process.stdout.write.
  const logger: Logger = createRecordLogger();

  const interactionLog = new JsonlLog(join(featureDir, "interactions.jsonl"));
  const statusServerFactory: StatusServerFactory = (statusOpts) =>
    createStatusServer({ ...statusOpts, interactionLog });

  const piSurface: PiSurface = {
    spawnAgent(rawOpts: unknown): {
      abort(): void;
      waitForIdle(): Promise<void>;
      reset(): void;
      contextTokens: number;
      stopReason?: "aborted" | "error";
    } {
      // rawOpts is typed as unknown at the PiSurface seam; extract the
      // fields makeAgentOpts needs (tools + beforeToolCall + model + streamFn).
      const spawnOpts = rawOpts as {
        tools?: string[];
        beforeToolCall?: AgentAdapterOpts["beforeToolCall"];
        model?: AgentAdapterOpts["model"];
        streamFn?: AgentAdapterOpts["streamFn"];
        beforeModelCall?: AgentAdapterOpts["beforeModelCall"];
        systemPrompt?: string;
        task_id?: string;
        worktreePath?: string;
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
        beforeModelCall: spawnOpts.beforeModelCall,
        worktreePath: spawnOpts.worktreePath,
      });

      // Install a best-effort model-call logging hook (Epic 019.13 S002).
      // Captures token usage from each AssistantMessage and appends a row to
      // model_call_log. Any store error is swallowed so it never throws into
      // the agent loop.
      const hookTaskId = spawnOpts.task_id ?? "";
      const hookAccountId = accountId ?? "";
      agentOpts.prepareNextTurnWithContext = async (ctx: PrepareNextTurnContext): Promise<undefined> => {
        try {
          const msg = ctx.message;
          appendModelCallRecord(store, {
            task_id: hookTaskId,
            account_id: hookAccountId,
            model: msg.model,
            tokens_in: msg.usage.input,
            tokens_out: msg.usage.output,
            cost: msg.usage.cost.total,
            stop_reason: msg.stopReason,
            attempt: 0,
            session_id: "",
            latency_ms: 0,
            correlation_id: "",
          });
        } catch (err) {
          // best-effort observability — never propagate into the agent loop,
          // but report the failure so a broken model-call log is not invisible.
          logger.info({
            event: "model-call-log-failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return undefined;
      };

      const systemPrompt = spawnOpts.systemPrompt;

      if (agentFactory !== undefined) {
        const handle = agentFactory(agentOpts);
        let stopReason: "error" | undefined;
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
              await runPromise.catch((err: unknown) => {
                stopReason = "error";
                // Agent-loop errors surface via stopReason; still report the
                // run rejection so it is not an invisible swallow (AGENTS.md).
                logger.info({
                  event: "agent-run-error",
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            }
            await handle.waitForIdle();
          },
          reset: (): void => {
            handle.reset();
          },
          contextTokens: 0,
          get stopReason(): "error" | undefined {
            return stopReason;
          },
        };
      }

      // Live path: real Agent.
      const agent = new Agent(agentOpts);
      let stopReason: "error" | undefined;
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
              await runPromise.catch((err: unknown) => {
                stopReason = "error";
              // Agent-loop errors surface via stopReason; still report the
              // run rejection so it is not an invisible swallow (AGENTS.md).
              logger.info({
                event: "agent-run-error",
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
          await agent.waitForIdle();
        },
        reset: (): void => {
          agent.reset();
        },
        get contextTokens(): number {
          return estimateContextTokens(agent.state.messages).tokens;
        },
        get stopReason(): "error" | undefined {
          return stopReason;
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
    inspectWorktreeDiff,
    toolGuidance,
  };

  if (identity !== undefined && identityFile !== undefined) {
    const iName = identity;
    const iFile = identityFile;
    return (async () => {
      let token: string;
      try {
        token = await loadIdentityFileOrEnv(iName, iFile);
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

      // Build a shared delivery preflight that gates all delivery adapters
      // on git availability + a non-empty identity token.
      // Use checkoutDir when available (it exists post-clone); featureDir may
      // not exist yet, causing the git probe to fail with ENOENT.
      const preflightCwd = opts.checkoutDir ?? featureDir;
      const deliveryPreflight = makeDeliveryVerifySetup({ token, gitBin: "git", cwd: preflightCwd });

      // Construct real adapters for the four standard broker verbs.
      const branchAdapter = makeBranchAdapter({ gitBin: "git" });
      const commitAdapter = makeCommitAdapter({ gitBin: "git", verifySetup: deliveryPreflight });
      const addAdapter = makeAddAdapter({ gitBin: "git", verifySetup: deliveryPreflight });
      const pushAdapter = makePushAdapter({ gitBin: "git", diffScanGuard: scanGuard, verifySetup: deliveryPreflight });
      const repoSlug = repo ?? "";
      const http = makeGithubHttpSeam({ token });
      const createPrAdapter = makeCreatePrAdapter({ repo: repoSlug, token, http, verifySetup: deliveryPreflight });

      const verbAdapters: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }> = {
        "git.branch": { entry: makeMinimalEntry("git.branch"), adapter: branchAdapter },
        "git.commit": { entry: makeMinimalEntry("git.commit"), adapter: commitAdapter },
        "git.add": { entry: makeMinimalEntry("git.add"), adapter: addAdapter },
        "git.push": { entry: makeMinimalEntry("git.push"), adapter: pushAdapter },
        "github.create_pr": { entry: makeMinimalEntry("github.create_pr"), adapter: createPrAdapter },
      };

      return { ...baseDeps, patternRegistry: patternRegistry ?? null, identityToken: token, verbAdapters };
    })();
  }

  return baseDeps;
}
