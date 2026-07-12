/**
 * src/cli/bootstrap-live-run — Live-run dependency assembler (Epic 019.8 S004 T1)
 *
 * Orchestrates:
 *  1. Reads the identity token from dataRoot/<slot.identity> via loadIdentity
 *  2. Clones slot.repo into dataRoot/checkout via bootstrapLocalCheckout
 *  3. Opens a SQLite store under the checkout .kanthord dir + inits schema
 *  4. Assembles RunDaemonDeps via buildRealDeps (async identity path)
 *  5. Wires commitsAhead from the checkout
 *  6. Adds worktreeSlot pointing at checkout/worktrees
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { loadIdentity } from "../git/keyring.ts";
import { bootstrapLocalCheckout } from "../slots/local-checkout.ts";
import { makeCommitsAhead } from "../daemon/commits-ahead.ts";
import { dispatchWorktree } from "../slots/worktree.ts";
import type { WorktreeDispatchOpts } from "../slots/worktree.ts";
import { buildRealDeps } from "./run-deps.ts";
import type { BuildRealDepsOpts } from "./run-deps.ts";
import type { RunDaemonDeps } from "../daemon/run-loop.ts";
import type { RepoSlot, RunGitFn } from "../slots/repo-slot.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../broker/registry.ts";
import type { PatternRegistry } from "../ring1/secret-scan.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse "owner/name" from a full HTTPS clone URL.
 * e.g. https://github.com/OWNER/NAME.git → "OWNER/NAME"
 * Falls back to the original string on malformed input.
 */
function repoUrlToSlug(url: string): string {
  try {
    const { pathname } = new URL(url);
    return pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal agent handle shape (mirrors the private interface in run-deps.ts). */
interface AgentHandle {
  abort(): void;
  waitForIdle(): Promise<void>;
  reset(): void;
}

export interface BootstrapLiveRunOpts {
  slot: RepoSlot;
  dataRoot: string;
  providerModel?: unknown;
  providerStreamFn?: unknown;
  runGit: RunGitFn;
  agentFactory?: (opts: unknown) => AgentHandle;
}

export type LiveRunDeps = RunDaemonDeps & {
  verbAdapters?: Record<string, { entry: VerbRegistryEntry; adapter: AsyncVerbAdapter }>;
};

// ---------------------------------------------------------------------------
// bootstrapLiveRun
// ---------------------------------------------------------------------------

/**
 * Assemble RunDaemonDeps for the live kanthord run path from a repo slot.
 *
 * Clones the slot's remote repo into a local checkout under `dataRoot`,
 * opens the daemon store within that checkout, and wires commitsAhead +
 * worktreeSlot so the run-loop can dispatch worktrees for each task.
 */
export async function bootstrapLiveRun(
  opts: BootstrapLiveRunOpts,
): Promise<LiveRunDeps> {
  const { slot, dataRoot, providerModel, providerStreamFn, runGit, agentFactory } = opts;

  // 1. Resolve identity file path + load the PAT token
  const identityFile = join(dataRoot, slot.identity);
  const identity = await loadIdentity({ name: slot.identity, file: identityFile });
  const identityToken = identity.token;

  // 2. Derive paths: checkoutDir lives under dataRoot, featureDir + db under it
  const checkoutDir = join(dataRoot, "checkout");
  const kanthordDir = join(checkoutDir, ".kanthord");
  const featureDir = join(kanthordDir, "features");
  const dbPath = join(kanthordDir, "db.sqlite");

  // 3. Clone (or no-op if already cloned) with auth header in local config
  await bootstrapLocalCheckout({
    repoUrl: slot.repo,
    identityToken,
    checkoutDir,
    runGit,
  });

  // 4. Ensure .kanthord dir exists, open store, initialise schema
  await mkdir(kanthordDir, { recursive: true });
  const store = openStore(dbPath, { busyTimeout: 5000 });
  initSchema(store);

  // 5. Assemble RunDaemonDeps via the async identity overload of buildRealDeps.
  //    patternRegistry: empty-patterns (allows all pushes; operator wires a
  //    real patterns file to block actual secrets — not null which would
  //    fail-close every push).
  //    repo: parse owner/name slug from the full HTTPS clone URL so
  //    makeCreatePrAdapter receives the correct slug (not the full URL).
  const patternRegistry: PatternRegistry = { version: "1.0", patterns: [] };
  const realDeps = await buildRealDeps({
    store,
    featureDir,
    agentFactory: agentFactory as BuildRealDepsOpts["agentFactory"],
    providerModel: providerModel as BuildRealDepsOpts["providerModel"],
    providerStreamFn: providerStreamFn as BuildRealDepsOpts["providerStreamFn"],
    identity: slot.identity,
    identityFile,
    repo: repoUrlToSlug(slot.repo),
    patternRegistry,
  });

  // 6. commitsAhead: count commits on a branch vs base in the local checkout
  const commitsAhead = makeCommitsAhead({ cwd: checkoutDir, runGit });

  // 7. worktreeSlot: dispatch creates per-task worktrees under the checkout
  const worktreesBase = join(checkoutDir, "worktrees");
  const worktreeSlot = {
    worktreesBase,
    repoPath: checkoutDir,
    dispatch: (dispatchOpts: WorktreeDispatchOpts) => dispatchWorktree(dispatchOpts),
  };

  return {
    ...realDeps,
    commitsAhead,
    worktreeSlot,
  };
}
