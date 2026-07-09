/**
 * src/broker/verbs/git-push — AsyncVerbAdapter for git.push
 * (Story 002 / Task T1)
 *
 * submit:      runs `git push <remote> <branch>` (no force-push).
 *              On success, captures HEAD sha + remote URL and stores
 *              PushCorrelation as the result.
 *              On non-fast-forward git exit/stderr, classifies as failed.
 * poll_status: returns the stored outcome immediately (effect is synchronous
 *              with submit for local-remote bare repos).
 * reconcile:   queries the remote ref via `git ls-remote <remote> refs/heads/<branch>`:
 *              ref at desired sha → done; missing ref → resubmit;
 *              ref at different sha → escalate.
 */

import { randomUUID } from "node:crypto";
import { runGit, validateRef } from "../../git/exec.ts";
import type { AsyncVerbAdapter } from "../registry.ts";
import type { OutboundScanGuard } from "../../ring1/outbound-scan-guard.ts";
import type { VerifyReport } from "../../git/verify-setup.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GitPushAdapterOpts = {
  gitBin: string;
  /**
   * Optional outbound scan guard for diff-content scanning.
   * When present, the diff of the branch vs the remote base is scanned
   * before the push is submitted. A blocked scan classifies the operation
   * as failed and prevents git-push from running.
   */
  diffScanGuard?: OutboundScanGuard;
  /**
   * Optional read-only preflight gate. When present, called before any git
   * command; if report.ok === false, submit returns blocked-needs-setup
   * immediately without running runGit or the diff scan.
   */
  verifySetup?: () => Promise<VerifyReport>;
};

export type GitPushInput = {
  cwd: string;
  branch: string;
  remote: string;
};

export type PushCorrelation = {
  remote_url: string;
  branch: string;
  sha: string;
};

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

type PushState =
  | { status: "done"; result: PushCorrelation }
  | { status: "failed"; error: { branch: string; stderr: string } };

// ---------------------------------------------------------------------------
// git.push adapter
// ---------------------------------------------------------------------------

/**
 * Adapter for the `git.push` verb.
 * submit:      runs `git push <remote> <branch>` (no force).
 *              When diffScanGuard is present, the diff of the branch vs
 *              the remote base is scanned before push; a blocked scan
 *              classifies the op as failed without running git-push.
 * poll_status: returns the stored outcome immediately.
 * reconcile:   queries remote via `git ls-remote`; classifies ref presence + sha.
 */
export function makePushAdapter(
  opts: GitPushAdapterOpts,
): AsyncVerbAdapter {
  const { diffScanGuard } = opts;
  const states = new Map<string, PushState>();

  const submit = async (input: unknown): Promise<unknown> => {
    const i = input as GitPushInput;
    const requestId = randomUUID();

    // Preflight: verify setup gate (unconditional — gate fires even when verifySetup is absent)
    if (opts.verifySetup === undefined) {
      return { status: "blocked-needs-setup", inboxItems: [] };
    }
    const report = await opts.verifySetup();
    if (report.ok === false) {
      return { status: "blocked-needs-setup", inboxItems: report.inboxItems };
    }

    // Ref validation before any git call
    try {
      validateRef(i.branch);
    } catch (err) {
      return { status: "failed", error: { message: (err as Error).message } };
    }

    // If a diff scan guard is present, scan the branch diff before pushing
    if (diffScanGuard !== undefined) {
      // Produce diff content: branch vs its remote tracking base.
      // If the remote tracking ref doesn't exist yet (first push), fall back
      // to `git log -p HEAD` which captures all committed content on the
      // branch — ensuring secrets in first-push branches are also scanned.
      const diffResult = await runGit(
        ["diff", `${i.remote}/${i.branch}..HEAD`],
        { cwd: i.cwd, gitBin: opts.gitBin },
      );
      let diffText: string;
      if (diffResult.kind === "success" || diffResult.kind === "noop") {
        diffText = diffResult.stdout;
      } else {
        // origin ref absent (first push) — scan all committed content
        const logResult = await runGit(
          ["log", "-p", "HEAD"],
          { cwd: i.cwd, gitBin: opts.gitBin },
        );
        diffText = logResult.stdout + logResult.stderr;
      }

      const guardResult = await diffScanGuard.guardedSubmit({
        verb: "git.push",
        taskId: requestId,
        serializedPayload: diffText,
        submit: async () => { /* no-op — we'll push below if not blocked */ },
      });

      if (guardResult.status === "blocked") {
        states.set(requestId, {
          status: "failed",
          error: { branch: i.branch, stderr: "scan-blocked" },
        });
        return requestId;
      }
    }

    // Run git push (no force-push flag)
    const pushResult = await runGit(
      ["push", i.remote, i.branch],
      { cwd: i.cwd, gitBin: opts.gitBin },
    );

    if (pushResult.kind === "success" || pushResult.kind === "noop") {
      // Capture HEAD sha for correlation
      let sha = "";
      const shaResult = await runGit(
        ["rev-parse", "HEAD"],
        { cwd: i.cwd, gitBin: opts.gitBin },
      );
      if (shaResult.kind === "success") {
        sha = shaResult.stdout.trim();
      }

      // Capture remote URL for correlation
      let remote_url = "";
      const urlResult = await runGit(
        ["remote", "get-url", i.remote],
        { cwd: i.cwd, gitBin: opts.gitBin },
      );
      if (urlResult.kind === "success") {
        remote_url = urlResult.stdout.trim();
      }

      const correlation: PushCorrelation = {
        remote_url,
        branch: i.branch,
        sha,
      };
      states.set(requestId, { status: "done", result: correlation });
    } else {
      // terminal (non-fast-forward) or other failure
      states.set(requestId, {
        status: "failed",
        error: {
          branch: i.branch,
          stderr: pushResult.stderr.trim() || pushResult.stdout.trim(),
        },
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
      return { status: "done", result: state.result };
    }
    return { status: "failed", error: state.error };
  };

  const reconcile = async (ledger: unknown): Promise<unknown> => {
    const l = ledger as {
      input?: GitPushInput;
      correlation?: PushCorrelation;
    };
    const input = l.input;
    const correlation = l.correlation;

    if (input === undefined || correlation === undefined) {
      return { status: "resubmit" };
    }

    const { remote_url, branch, sha: desiredSha } = correlation;
    const remoteTarget = remote_url || input.remote;

    // Query remote ref via ls-remote
    const lsResult = await runGit(
      ["ls-remote", remoteTarget, `refs/heads/${branch}`],
      { cwd: input.cwd },
    );

    if (lsResult.kind !== "success" && lsResult.kind !== "noop") {
      // Can't query remote — request resubmit
      return { status: "resubmit" };
    }

    const output = lsResult.stdout.trim();
    if (output === "") {
      // Ref does not exist on remote
      return { status: "resubmit" };
    }

    // ls-remote output: "<sha>\trefs/heads/<branch>"
    const parts = output.split("\t");
    const remoteSha = parts[0] !== undefined ? parts[0].trim() : "";

    if (remoteSha === desiredSha) {
      return { status: "done" };
    }

    // Ref exists at a different sha — escalate (diverged)
    return { status: "escalate" };
  };

  return { submit, poll_status, reconcile };
}
