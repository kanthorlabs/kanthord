/**
 * src/cli/bootstrap-live-run — Live-run dependency assembler (Epic 019.8 S004 T1)
 *
 * Orchestrates:
 *  1. Reads the identity token from the shared dataRoot/credentials custody
 *     file (KEY=VALUE, key KANTHOR_IDENTITY_<NAME>_TOKEN) via loadIdentity
 *  2. Clones slot.repo into dataRoot/checkout via bootstrapLocalCheckout
 *  3. Opens a SQLite store under the checkout .kanthord dir + inits schema
 *  4. Assembles RunDaemonDeps via buildRealDeps (async identity path)
 *  5. Wires commitsAhead from the checkout
 *  6. Adds worktreeSlot pointing at checkout/worktrees
 */

import { join } from "node:path";
import { log, errMessage } from "../foundations/log.ts";
import { mkdir, access } from "node:fs/promises";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { compile, applyCompiledPlanMigration } from "../compiler/compile.ts";
import { loadIdentity } from "../git/keyring.ts";
import { bootstrapLocalCheckout } from "../slots/local-checkout.ts";
import { makeCommitsAhead } from "../daemon/commits-ahead.ts";
import { dispatchWorktree } from "../slots/worktree.ts";
import type { WorktreeDispatchOpts } from "../slots/worktree.ts";
import { buildRealDeps } from "./run-deps.ts";
import type { BuildRealDepsOpts } from "./run-deps.ts";
import type { RunDaemonDeps } from "../daemon/run-loop.ts";
import { loadCommitterIdentity } from "../config/committer-identity.ts";
import { loadPublicConfiguration } from "../config/public-configuration.ts";
import { UserReviewRouter } from "../review/review-router.ts";
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
  } catch (err) {
    log.debug("repo-url-parse-failed", { url, error: errMessage(err) });
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

  // 1. Resolve identity file path + load the PAT token.
  //    The shared custody file "<dataRoot>/credentials" (env-style KEY=VALUE)
  //    holds every identity keyed KANTHOR_IDENTITY_<NAME>_TOKEN.
  const identityFile = join(dataRoot, "credentials");
  let identity: Awaited<ReturnType<typeof loadIdentity>>;
  try {
    await access(identityFile);
    identity = await loadIdentity({ name: slot.identity, file: identityFile });
  } catch (loadErr) {
    if ((loadErr as NodeJS.ErrnoException).code !== "ENOENT") throw loadErr;
    identity = await loadIdentity({ name: slot.identity, env: true });
  }
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

  // 4b. Compile feature plan on boot (Epic 019.9 S001)
  //     Derive repoRegistry from HTTPS clone URL when parseable; skip when a
  //     local path is supplied (e.g. bare-repo test fixtures).
  let repoRegistry: string[] | undefined;
  try {
    const { pathname } = new URL(slot.repo);
    const slug = pathname.replace(/^\//, "").replace(/\.git$/, "");
    if (slug.length > 0) repoRegistry = [slug];
  } catch (err) {
    // local path or non-HTTPS — skip repo registry check
    log.debug("repo-registry-derive-skipped", { error: errMessage(err) });
  }
  let hasEpic = false;
  try {
    await access(join(featureDir, "epic.md"));
    hasEpic = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (hasEpic) {
    await compile(featureDir, store, { repoRegistry });
  } else {
    applyCompiledPlanMigration(store);
  }

  // 5. Assemble RunDaemonDeps via the async identity overload of buildRealDeps.
  //    patternRegistry: empty-patterns (allows all pushes; operator wires a
  //    real patterns file to block actual secrets — not null which would
  //    fail-close every push).
  //    repo: parse owner/name slug from the full HTTPS clone URL so
  //    makeCreatePrAdapter receives the correct slug (not the full URL).
  const patternRegistry: PatternRegistry = { version: "1.0", patterns: [] };
  const publicConfiguration = await loadPublicConfiguration();
  const realDeps = await buildRealDeps({
    store,
    featureDir,
    checkoutDir,
    agentFactory: agentFactory as BuildRealDepsOpts["agentFactory"],
    providerModel: providerModel as BuildRealDepsOpts["providerModel"],
    providerStreamFn: providerStreamFn as BuildRealDepsOpts["providerStreamFn"],
    identity: slot.identity,
    identityFile,
    repo: repoUrlToSlug(slot.repo),
    patternRegistry,
    publicConfiguration,
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

  // 8. resolveCommitterIdentity: slot.committer wins; fall back to global file
  const resolveCommitterIdentity = async (
    _taskId: string,
  ): Promise<{ name: string; email: string } | undefined> => {
    if (slot.committer !== undefined) return slot.committer;
    return loadCommitterIdentity(dataRoot);
  };

  return {
    ...realDeps,
    commitsAhead,
    worktreeSlot,
    resolveCommitterIdentity,
    reviewRouter: new UserReviewRouter({ store, clock: realDeps.clock }),
    prStateSeam: {
      async getPrState(_repo: string, prNumber: number): Promise<{ state: string; merged: boolean }> {
        const http = (realDeps.verbAdapters as Record<string, { adapter: unknown }> | undefined)?.["github.create_pr"];
        void http;
        const token = (realDeps as { identityToken?: string }).identityToken ?? identityToken;
        const gh = await import("../broker/verbs/github-http.ts");
        const seam = gh.makeGithubHttpSeam({ token: token });
        const pr = await seam.getPr(`/repos/${repoUrlToSlug(slot.repo)}/pulls/${prNumber}`, {},);
        if ("status" in pr) throw new Error(`GitHub rate limited PR poll; retry_after=${pr.retry_after}`);
        return { state: pr.state, merged: pr.merged };
      },
    },
    prStateRepo: repoUrlToSlug(slot.repo),
  };
}
