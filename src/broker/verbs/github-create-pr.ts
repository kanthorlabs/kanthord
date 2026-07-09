/**
 * src/broker/verbs/github-create-pr — AsyncVerbAdapter for github.create_pr
 * (Story 003 / Task T1)
 *
 * submit:      calls http.createPr with Authorization: Bearer <token>;
 *              on 422 "already exists" falls back to http.listByHead for
 *              idempotency-by-head-branch; stores {head_branch, pr_number}
 *              as correlation; never persists the token in any ledger row.
 * poll_status: calls http.getPr; open PR → done; closed/merged PR → failed
 *              with {reason:"closed-externally", observed_state}.
 * reconcile:   function (required by registerVerb reconcile-path check);
 *              full reconcile behaviour is deferred to T2.
 */

import { randomUUID } from "node:crypto";
import type { AsyncVerbAdapter } from "../registry.ts";
import type { VerifyReport } from "../../git/verify-setup.ts";

// ---------------------------------------------------------------------------
// Public HTTP seam types
// ---------------------------------------------------------------------------

export type CreatePrResponse = {
  status: 201;
  number: number;
  url: string;
};

export type CreatePrDuplicateResponse = {
  status: 422;
  message: string;
  existing_url?: string;
};

export type GetPrResponse = {
  number: number;
  state: "open" | "closed" | "merged";
  url: string;
  merged: boolean;
};

export type RateLimitResponse = { status: 429; retry_after: number };

export type ListPrResponse = Array<{ number: number; state: string; url: string }>;

/**
 * Minimal HTTP surface consumed by the github.create_pr adapter.
 * Shaped by SU2 findings; all implementations (real fetch, test double) must
 * implement this interface.
 */
export interface GithubHttpSeam {
  createPr(
    path: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<CreatePrResponse | CreatePrDuplicateResponse>;
  getPr(
    path: string,
    headers: Record<string, string>,
  ): Promise<GetPrResponse | RateLimitResponse>;
  listByHead(
    path: string,
    headers: Record<string, string>,
  ): Promise<ListPrResponse>;
}

// ---------------------------------------------------------------------------
// Adapter opts and input
// ---------------------------------------------------------------------------

export type CreatePrAdapterOpts = {
  /** "owner/repo" */
  repo: string;
  /** GitHub token — injected per-invocation; never written to ledger rows. */
  token: string;
  /** HTTP seam (real fetch adapter or in-process double). */
  http: GithubHttpSeam;
  /** Optional read-only preflight gate; injected by caller. */
  verifySetup?: () => Promise<VerifyReport>;
};

export type CreatePrInput = {
  head: string;
  base: string;
  title: string;
  body: string;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/**
 * The adapter stores `in_flight` for all cases where a PR number is known.
 * `poll_status` ALWAYS calls `http.getPr` from `in_flight` state so that
 * the poller can detect regressions (open → closed) without stale caching.
 * Terminal states are only returned by `poll_status`, never stored, so the
 * poller's `observed_state_can_regress` check gets fresh live state each tick.
 */
type PrState =
  | { status: "in_flight"; prNumber: number; headBranch: string }
  | { status: "failed"; error: { reason: string; observed_state: string } };

// ---------------------------------------------------------------------------
// github.create_pr adapter
// ---------------------------------------------------------------------------

/**
 * Factory for the `github.create_pr` AsyncVerbAdapter.
 *
 * The token is used only in per-invocation Authorization headers;
 * it is never written to the ledger (broker_in_flight or broker_completion).
 */
export function makeCreatePrAdapter(opts: CreatePrAdapterOpts): AsyncVerbAdapter {
  const { repo, token, http } = opts;
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const states = new Map<string, PrState>();

  const submit = async (input: unknown): Promise<unknown> => {
    const i = input as CreatePrInput;

    if (opts.verifySetup === undefined) {
      return { status: "blocked-needs-setup", inboxItems: [] };
    }

    const report = await opts.verifySetup();
    if (report.ok === false) {
      return { status: "blocked-needs-setup", inboxItems: report.inboxItems };
    }

    const requestId = randomUUID();

    const createPath = `/repos/${repo}/pulls`;
    const createBody = { head: i.head, base: i.base, title: i.title, body: i.body };

    const createResp = await http.createPr(createPath, authHeaders, createBody);

    if (createResp.status === 201) {
      states.set(requestId, {
        status: "in_flight",
        prNumber: createResp.number,
        headBranch: i.head,
      });
      return requestId;
    }

    // 422: duplicate — resolve via listByHead idempotency fallback
    const listPath = `/repos/${repo}/pulls?head=${encodeURIComponent(repo.split("/")[0] ?? "")
    }:${encodeURIComponent(i.head)}&state=all`;
    const listResp = await http.listByHead(listPath, authHeaders);

    const existing = listResp[0];
    if (existing !== undefined) {
      // Treat as in_flight with the existing PR number; poll_status will confirm
      // via getPr, which allows the poller's regression check to work correctly.
      states.set(requestId, {
        status: "in_flight",
        prNumber: existing.number,
        headBranch: i.head,
      });
      return requestId;
    }

    // No existing PR found after duplicate — mark failed
    states.set(requestId, {
      status: "failed",
      error: { reason: "duplicate-unresolvable", observed_state: "unknown" },
    });
    return requestId;
  };

  const poll_status = async (requestId: unknown): Promise<unknown> => {
    const state = states.get(requestId as string);

    if (state === undefined) {
      return { status: "failed", error: { reason: "unknown-request-id", observed_state: "unknown" } };
    }

    if (state.status === "failed") {
      return { status: "failed", error: state.error };
    }

    // in_flight: poll the GitHub API for live PR state.
    // We do NOT cache `done` here — always call getPr so the poller's
    // observed_state_can_regress logic can detect open→closed regressions.
    const { prNumber, headBranch } = state;
    const getPrPath = `/repos/${repo}/pulls/${prNumber}`;
    const prResp = await http.getPr(getPrPath, authHeaders);

    if (!("state" in prResp)) {
      return { status: "rate_limited" };
    }

    if (prResp.state === "open") {
      // PR is open — signal done to the poller (not stored; poller confirms)
      return { status: "done", result: { head_branch: headBranch, pr_number: prNumber } };
    }

    // closed or merged — failed with observed_state
    const failedError = { reason: "closed-externally", observed_state: prResp.state };
    states.set(requestId as string, { status: "failed", error: failedError });
    return { status: "failed", error: failedError };
  };

  const reconcile = async (ledger: unknown): Promise<unknown> => {
    const l = ledger as { head_branch?: string; pr_number?: number };
    const headBranch = l.head_branch ?? "";

    // Query real state via listByHead (no create call).
    const listPath = `/repos/${repo}/pulls?head=${encodeURIComponent(
      repo.split("/")[0] ?? "",
    )}:${encodeURIComponent(headBranch)}&state=all`;
    const listResp = await http.listByHead(listPath, authHeaders);

    const existing = listResp[0];
    if (existing === undefined) {
      // No PR for this head branch — idempotent resubmit.
      return { status: "resubmit" };
    }

    const { state, number: prNumber } = existing;
    if (state === "open") {
      return { status: "done", result: { head_branch: headBranch, pr_number: prNumber } };
    }

    // closed or merged — escalate.
    return {
      status: "failed",
      error: { reason: "closed-externally", observed_state: state },
      escalation_needed: true,
    };
  };

  return { submit, poll_status, reconcile };
}
