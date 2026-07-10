/**
 * 2A security scenario — daemon killed between submit and completion;
 * restart reconciles via head-branch lookup on the double with no second
 * create request; op reaches a terminal state.
 * Story 001 T2 file 3/3 (Epic 019). Exercises Epic 014 (github.create_pr).
 */

import type { FakeClock } from "../../foundations/clock.ts";
import type { Store } from "../../foundations/sqlite-store.ts";
import type { GithubHttpSeam } from "../../broker/verbs/github-create-pr.ts";
import { makeCreatePrAdapter } from "../../broker/verbs/github-create-pr.ts";
import type { VerbRegistryEntry } from "../../broker/registry.ts";
import { submit } from "../../broker/submit.ts";
import { reconcileOp } from "../../broker/reconcile.ts";
import type { VerifyReport } from "../../git/verify-setup.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type KillMidCreatePrFixture = {
  clock: FakeClock;
  store: Store;
};

export type KillMidCreatePrResult = {
  createCallCountBeforeKill: number;
  createCallCountAfterRestart: number;
  listByHeadCallCount: number;
  outcomeIsTerminal: boolean;
  reconcileOutcome: string;
  opId: string;
};

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export async function run2aKillMidCreatePrScenario(
  fixture: KillMidCreatePrFixture,
): Promise<KillMidCreatePrResult> {
  const { store } = fixture;

  // Shared call counters so both adapters (pre- and post-kill) accumulate
  // against the same double.
  let createPrCallCount = 0;
  let listByHeadCallCount = 0;

  // GithubHttpSeam double. createPr returns 201 (new PR); listByHead returns
  // an open PR at pr_number 42 so reconcile can resolve to "done".
  const double: GithubHttpSeam = {
    createPr: async (_path, _headers, _body) => {
      createPrCallCount++;
      return { status: 201, number: 42, url: "https://github.com/test/repo/pull/42" };
    },
    getPr: async (_path, _headers) => {
      return {
        number: 42,
        state: "open",
        url: "https://github.com/test/repo/pull/42",
        merged: false,
      };
    },
    listByHead: async (_path, _headers) => {
      listByHeadCallCount++;
      return [{ number: 42, state: "open", url: "https://github.com/test/repo/pull/42" }];
    },
  };

  // verifySetup that always passes — lets submit() proceed to createPr.
  const alwaysPass = async (): Promise<VerifyReport> => ({
    platform: "github",
    repo: "test/repo",
    identity: "testuser",
    ok: true,
    checks: [],
    inboxItems: [],
  });

  // Minimal VerbRegistryEntry — idempotency.window_ms = 0 so empty key is OK.
  const entry: VerbRegistryEntry = {
    verb: "github.create_pr",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 0 },
    retry: { max: 0, backoff: "none" },
    poll_interval: 5000,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };

  // --- Phase 1: submit via first adapter (pre-kill) -------------------------

  const adapter1 = makeCreatePrAdapter({
    repo: "test/repo",
    token: "test-token",
    http: double,
    verifySetup: alwaysPass,
  });

  const opId = await submit(
    entry,
    adapter1,
    {
      head: "feature/kill-test",
      base: "main",
      title: "Kill test PR",
      body: "Testing kill mid create_pr reconcile",
    },
    "",
    store,
  );

  const createCallCountBeforeKill = createPrCallCount;
  const createPrCallsAtRestartPoint = createPrCallCount;

  // --- Phase 2: simulate daemon kill + restart ------------------------------
  // A new adapter has a fresh in-memory `states` Map (ephemeral state is gone).
  // The double (and its counters) survive — modelling the durable HTTP layer.

  const adapter2 = makeCreatePrAdapter({
    repo: "test/repo",
    token: "test-token",
    http: double,
    verifySetup: alwaysPass,
  });

  // Route reconcile through reconcileOp so the durable broker_completion row
  // is written. correlation encodes head_branch as JSON — the adapter parses it.
  const ledgerEntry = {
    op_id: opId,
    verb: "github.create_pr",
    idempotency_key: "",
    correlation: JSON.stringify({ head_branch: "feature/kill-test" }),
    desired_effect_hash: "",
    status: "needs_reconciliation" as const,
  };

  const reconcileOutcome = await reconcileOp(
    ledgerEntry,
    entry,
    adapter2,
    store,
    fixture.clock,
  );

  const createCallCountAfterRestart = createPrCallCount - createPrCallsAtRestartPoint;
  const outcomeIsTerminal = reconcileOutcome === "done" || reconcileOutcome === "failed";

  return {
    createCallCountBeforeKill,
    createCallCountAfterRestart,
    listByHeadCallCount,
    outcomeIsTerminal,
    reconcileOutcome,
    opId,
  };
}
