/**
 * src/broker/verbs/git-local — AsyncVerbAdapters for git.branch and git.commit
 * (Story 001 / Task T1)
 *
 * Both adapters use the src/git/exec.ts seam (runGit) and hold per-submit
 * state in an in-memory Map keyed by request_id (UUID).  Local git ops are
 * synchronous in effect: submit executes the git command and poll_status
 * immediately returns the stored outcome.
 */

import { randomUUID } from "node:crypto";
import { runGit, validateRef } from "../../git/exec.ts";
import type { AsyncVerbAdapter } from "../registry.ts";
import type { VerifyReport } from "../../git/verify-setup.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GitLocalAdapterOpts = {
  gitBin: string;
  verifySetup?: () => Promise<VerifyReport>;
};

export type GitBranchInput = {
  cwd: string;
  branch: string;
  startPoint: string;
};

export type GitCommitInput = {
  cwd: string;
  message: string;
  name?: string;
  email?: string;
};

export type GitCloneInput = {
  remote: string;
  cwd: string;
};

export type GitFetchInput = {
  cwd: string;
};

export type GitAddInput = {
  cwd: string;
};

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

type BranchState =
  | { status: "done"; input: GitBranchInput }
  | { status: "failed"; error: { stderr: string }; input: GitBranchInput };

type CommitState =
  | { status: "done" }
  | { status: "failed"; error: { stderr: string } };

// ---------------------------------------------------------------------------
// git.branch adapter
// ---------------------------------------------------------------------------

/**
 * Adapter for the `git.branch` verb.
 * submit:       runs `git branch <branch> <startPoint>` synchronously.
 * poll_status:  returns the stored outcome immediately (local op; effect is
 *               synchronous with submit).
 * reconcile:    checks whether the named ref exists at the expected sha.
 */
export function makeBranchAdapter(
  opts: GitLocalAdapterOpts,
): AsyncVerbAdapter {
  const states = new Map<string, BranchState>();

  const submit = async (input: unknown): Promise<unknown> => {
    const i = input as GitBranchInput;
    const requestId = randomUUID();

    if (opts.verifySetup === undefined) {
      return { status: "blocked-needs-setup", inboxItems: [] };
    }
    const report = await opts.verifySetup();
    if (report.ok === false) {
      return { status: "blocked-needs-setup", inboxItems: report.inboxItems };
    }

    try {
      validateRef(i.branch);
    } catch (err) {
      return { status: "failed", error: { message: (err as Error).message } };
    }

    const result = await runGit(
      ["branch", i.branch, i.startPoint],
      { cwd: i.cwd, gitBin: opts.gitBin },
    );

    if (result.kind === "success" || result.kind === "noop") {
      states.set(requestId, { status: "done", input: i });
    } else {
      states.set(requestId, {
        status: "failed",
        error: { stderr: result.stderr },
        input: i,
      });
    }

    return requestId;
  };

  const poll_status = async (requestId: unknown): Promise<unknown> => {
    const state = states.get(requestId as string);
    if (state === undefined) {
      return { status: "failed", error: { stderr: "unknown request_id" } };
    }
    if (state.status === "done") {
      return { status: "done" };
    }
    return { status: "failed", error: state.error };
  };

  const reconcile = async (ledger: unknown): Promise<unknown> => {
    const l = ledger as { input?: GitBranchInput; requestId?: string; desiredSha?: string };
    // If we have the input in-state, verify the ref exists at the right sha.
    const input = l.input;
    if (input === undefined) {
      // Cannot verify without input; request resubmit.
      return { status: "resubmit" };
    }

    // Check whether the branch ref exists (and read its current sha)
    const result = await runGit(
      ["rev-parse", "--verify", input.branch],
      { cwd: input.cwd },
    );

    if (result.kind !== "success" && result.kind !== "noop") {
      return { status: "resubmit" };
    }

    // When desiredSha is provided, compare it to the actual branch sha.
    if (l.desiredSha !== undefined) {
      const actualSha = result.stdout.trim();
      if (actualSha === l.desiredSha) {
        return { status: "done" };
      }
      return { status: "resubmit" };
    }

    // desiredSha absent: existence check is sufficient (backward compat).
    return { status: "done" };
  };

  return { submit, poll_status, reconcile };
}

// ---------------------------------------------------------------------------
// git.commit adapter
// ---------------------------------------------------------------------------

/**
 * Adapter for the `git.commit` verb.
 * submit:       runs `git commit -m <message>`; classifies noop (nothing staged)
 *               as a `failed` state carrying the git stderr summary.
 * poll_status:  returns the stored outcome immediately.
 * reconcile:    compares the current branch HEAD tree hash to the desired-effect
 *               tree hash stored at submit time.
 */
export function makeCommitAdapter(
  opts: GitLocalAdapterOpts,
): AsyncVerbAdapter {
  const states = new Map<string, CommitState>();
  const treeHashes = new Map<string, string>(); // requestId → tree hash at commit time

  const submit = async (input: unknown): Promise<unknown> => {
    const i = input as GitCommitInput;
    const requestId = randomUUID();

    if (opts.verifySetup === undefined) {
      return { status: "blocked-needs-setup", inboxItems: [] };
    }
    const report = await opts.verifySetup();
    if (report.ok === false) {
      return { status: "blocked-needs-setup", inboxItems: report.inboxItems };
    }

    const identityArgs: string[] =
      i.name !== undefined && i.email !== undefined
        ? ["-c", `user.name=${i.name}`, "-c", `user.email=${i.email}`]
        : [];
    const result = await runGit(
      [...identityArgs, "commit", "-m", i.message],
      { cwd: i.cwd, gitBin: opts.gitBin },
    );

    if (result.kind === "noop") {
      // nothing staged → classified as failed with git's stderr/stdout
      const stderr =
        result.stderr.trim() ||
        result.stdout.trim() ||
        "nothing to commit";
      states.set(requestId, {
        status: "failed",
        error: { stderr },
      });
      return requestId;
    }

    if (result.kind === "success") {
      // Capture the tree hash for reconcile
      const treeResult = await runGit(
        ["rev-parse", "HEAD^{tree}"],
        { cwd: i.cwd, gitBin: opts.gitBin },
      );
      if (treeResult.kind === "success") {
        treeHashes.set(requestId, treeResult.stdout.trim());
      }
      states.set(requestId, { status: "done" });
      return requestId;
    }

    // Any other failure (terminal/retryable/timeout)
    states.set(requestId, {
      status: "failed",
      error: { stderr: result.stderr.trim() || result.stdout.trim() },
    });
    return requestId;
  };

  const poll_status = async (requestId: unknown): Promise<unknown> => {
    const state = states.get(requestId as string);
    if (state === undefined) {
      return { status: "failed", error: { stderr: "unknown request_id" } };
    }
    if (state.status === "done") {
      return { status: "done" };
    }
    return { status: "failed", error: state.error };
  };

  const reconcile = async (ledger: unknown): Promise<unknown> => {
    const l = ledger as { requestId?: string; input?: GitCommitInput; desiredTreeHash?: string };
    const requestId = l.requestId;
    const input = l.input;

    if (requestId === undefined || input === undefined) {
      return { status: "resubmit" };
    }

    // External caller may supply desiredTreeHash; fall back to internally stored hash.
    const desiredTree = l.desiredTreeHash !== undefined
      ? l.desiredTreeHash
      : treeHashes.get(requestId);

    if (desiredTree === undefined) {
      return { status: "resubmit" };
    }

    // Compare HEAD tree hash to desired tree hash
    const result = await runGit(
      ["rev-parse", "HEAD^{tree}"],
      { cwd: input.cwd },
    );

    if (result.kind === "success" && result.stdout.trim() === desiredTree) {
      return { status: "done" };
    }
    return { status: "resubmit" };
  };

  return { submit, poll_status, reconcile };
}

// ---------------------------------------------------------------------------
// git.clone adapter
// ---------------------------------------------------------------------------

type CloneState =
  | { status: "done" }
  | { status: "failed"; error: { stderr: string } };

/**
 * Adapter for the `git.clone` verb.
 * submit:       runs `git clone <remote> <cwd>`.
 * poll_status:  returns stored outcome immediately.
 * reconcile:    re-run-safe — if the target dir exists as a git repo, done.
 */
export function makeCloneAdapter(
  opts: GitLocalAdapterOpts,
): AsyncVerbAdapter {
  const states = new Map<string, CloneState>();

  const submit = async (input: unknown): Promise<unknown> => {
    const i = input as GitCloneInput;
    const requestId = randomUUID();

    if (opts.verifySetup === undefined) {
      return { status: "blocked-needs-setup", inboxItems: [] };
    }
    const report = await opts.verifySetup();
    if (report.ok === false) {
      return { status: "blocked-needs-setup", inboxItems: report.inboxItems };
    }

    const result = await runGit(
      ["clone", i.remote, i.cwd],
      { cwd: process.cwd(), gitBin: opts.gitBin },
    );

    if (result.kind === "success" || result.kind === "noop") {
      states.set(requestId, { status: "done" });
    } else {
      states.set(requestId, {
        status: "failed",
        error: { stderr: result.stderr.trim() || result.stdout.trim() },
      });
    }

    return requestId;
  };

  const poll_status = async (requestId: unknown): Promise<unknown> => {
    const state = states.get(requestId as string);
    if (state === undefined) {
      return { status: "failed", error: { stderr: "unknown request_id" } };
    }
    if (state.status === "done") {
      return { status: "done" };
    }
    return { status: "failed", error: state.error };
  };

  const reconcile = async (ledger: unknown): Promise<unknown> => {
    const l = ledger as { input?: GitCloneInput };
    const input = l.input;
    if (input === undefined) {
      return { status: "resubmit" };
    }

    // Check if target dir exists as a git repo (re-run-safe)
    const result = await runGit(
      ["rev-parse", "--git-dir"],
      { cwd: input.cwd },
    );

    if (result.kind === "success" || result.kind === "noop") {
      return { status: "done" };
    }
    return { status: "resubmit" };
  };

  return { submit, poll_status, reconcile };
}

// ---------------------------------------------------------------------------
// git.fetch adapter
// ---------------------------------------------------------------------------

type FetchState =
  | { status: "done" }
  | { status: "failed"; error: { stderr: string } };

/**
 * Adapter for the `git.fetch` verb.
 * submit:       runs `git fetch` in the cwd.
 * poll_status:  returns stored outcome immediately.
 * reconcile:    re-run-safe — fetch is idempotent; always returns done.
 */
export function makeFetchAdapter(
  opts: GitLocalAdapterOpts,
): AsyncVerbAdapter {
  const states = new Map<string, FetchState>();

  const submit = async (input: unknown): Promise<unknown> => {
    const i = input as GitFetchInput;
    const requestId = randomUUID();

    if (opts.verifySetup === undefined) {
      return { status: "blocked-needs-setup", inboxItems: [] };
    }
    const report = await opts.verifySetup();
    if (report.ok === false) {
      return { status: "blocked-needs-setup", inboxItems: report.inboxItems };
    }

    const result = await runGit(
      ["fetch"],
      { cwd: i.cwd, gitBin: opts.gitBin },
    );

    if (result.kind === "success" || result.kind === "noop") {
      states.set(requestId, { status: "done" });
    } else {
      states.set(requestId, {
        status: "failed",
        error: { stderr: result.stderr.trim() || result.stdout.trim() },
      });
    }

    return requestId;
  };

  const poll_status = async (requestId: unknown): Promise<unknown> => {
    const state = states.get(requestId as string);
    if (state === undefined) {
      return { status: "failed", error: { stderr: "unknown request_id" } };
    }
    if (state.status === "done") {
      return { status: "done" };
    }
    return { status: "failed", error: state.error };
  };

  const reconcile = async (_ledger: unknown): Promise<unknown> => {
    // git.fetch is re-run-safe and idempotent — always reconciles as done.
    return { status: "done" };
  };

  return { submit, poll_status, reconcile };
}

// ---------------------------------------------------------------------------
// git.add adapter
// ---------------------------------------------------------------------------

type AddState =
  | { status: "done" }
  | { status: "failed"; error: { stderr: string } };

/**
 * Adapter for the `git.add` verb.
 * submit:       runs `git add -A` in `input.cwd` — stages all changes including
 *               untracked files; gates on verifySetup.
 * poll_status:  returns stored outcome immediately (local op is synchronous).
 * reconcile:    staging is idempotent → always returns done (re-run-safe).
 */
export function makeAddAdapter(
  opts: GitLocalAdapterOpts,
): AsyncVerbAdapter {
  const states = new Map<string, AddState>();

  const submit = async (input: unknown): Promise<unknown> => {
    const i = input as GitAddInput;
    const requestId = randomUUID();

    if (opts.verifySetup === undefined) {
      return { status: "blocked-needs-setup", inboxItems: [] };
    }
    const report = await opts.verifySetup();
    if (report.ok === false) {
      return { status: "blocked-needs-setup", inboxItems: report.inboxItems };
    }

    const result = await runGit(
      ["add", "-A"],
      { cwd: i.cwd, gitBin: opts.gitBin },
    );

    if (result.kind === "success" || result.kind === "noop") {
      states.set(requestId, { status: "done" });
    } else {
      states.set(requestId, {
        status: "failed",
        error: { stderr: result.stderr.trim() || result.stdout.trim() },
      });
    }

    return requestId;
  };

  const poll_status = async (requestId: unknown): Promise<unknown> => {
    const state = states.get(requestId as string);
    if (state === undefined) {
      return { status: "failed", error: { stderr: "unknown request_id" } };
    }
    if (state.status === "done") {
      return { status: "done" };
    }
    return { status: "failed", error: state.error };
  };

  const reconcile = async (_ledger: unknown): Promise<unknown> => {
    // git add -A is idempotent; staging always reconciles as done.
    return { status: "done" };
  };

  return { submit, poll_status, reconcile };
}
