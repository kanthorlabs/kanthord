/**
 * Story 003 / Task T1 — github.create_pr: submit/poll/idempotency against the double
 *
 * Tests:
 *  (a) submit creates the PR on the double, records {head_branch, pr_number}
 *      as correlation; poll advances the op to "done"
 *  (b) "already exists" from the double resolves to the existing PR (done with
 *      existing number) — idempotency-by-head-branch
 *  (c) auth header (Bearer token) is present on every captured request from the
 *      double; the token does NOT appear in any ledger entry or event record
 *  (d) open→closed transition during poll resolves "failed" with
 *      {reason:"closed-externally"} and observed state attached
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../../foundations/sqlite-store.ts";
import { FakeClock } from "../../foundations/clock.ts";
import { registerVerb } from "../registry.ts";
import { submit } from "../submit.ts";
import { startPolling } from "../poller.ts";
import { makeCreatePrAdapter } from "./github-create-pr.ts";
import type { GithubHttpSeam, CreatePrResponse, GetPrResponse, ListPrResponse, RateLimitResponse } from "./github-create-pr.ts";
import type { VerifyReport } from "../../git/verify-setup.ts";

// ---------------------------------------------------------------------------
// Module-level verifySetup fixture — used by main-suite tests that exercise
// the submit/poll/timeout/reconcile paths (not the gate itself).
// ---------------------------------------------------------------------------
const alwaysPass = async (): Promise<VerifyReport> => ({
  platform: "test",
  repo: "test",
  identity: "test",
  ok: true,
  checks: [],
  inboxItems: [],
});

// ---------------------------------------------------------------------------
// In-process HTTP double
// ---------------------------------------------------------------------------

/** One captured request logged by the double. */
interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Minimal in-process GitHub HTTP double shaped by SU2 findings.
 * Implements only the surfaces used by the github.create_pr adapter:
 *   POST   /repos/{owner}/{repo}/pulls           — create PR
 *   GET    /repos/{owner}/{repo}/pulls/{number}  — get PR by number
 *   GET    /repos/{owner}/{repo}/pulls?head=...  — list PRs by head branch
 */
class GithubDouble implements GithubHttpSeam {
  readonly log: CapturedRequest[] = [];

  // Configuration — set by individual tests.
  createResponse: CreatePrResponse | { status: 422; message: string; existing_url?: string } = {
    status: 201,
    number: 42,
    url: "https://github.com/owner/repo/pull/42",
  };
  getPrResponse: GetPrResponse | RateLimitResponse = {
    number: 42,
    state: "open",
    url: "https://github.com/owner/repo/pull/42",
    merged: false,
  };
  listByHeadResponse: ListPrResponse = [];

  async createPr(
    path: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<CreatePrResponse | { status: 422; message: string; existing_url?: string }> {
    this.log.push({ method: "POST", path, headers, body });
    return this.createResponse;
  }

  async getPr(
    path: string,
    headers: Record<string, string>,
  ): Promise<GetPrResponse | RateLimitResponse> {
    this.log.push({ method: "GET", path, headers, body: null });
    return this.getPrResponse;
  }

  async listByHead(
    path: string,
    headers: Record<string, string>,
  ): Promise<ListPrResponse> {
    this.log.push({ method: "GET", path, headers, body: null });
    return this.listByHeadResponse;
  }
}

// ---------------------------------------------------------------------------
// Registry entry helper
// ---------------------------------------------------------------------------

function makeCreatePrEntry() {
  return {
    verb: "github.create_pr",
    tier: "auto_with_audit" as const,
    timeout: 30000,
    idempotency: { window_ms: 3600000 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 50,
    terminal_states: ["done", "failed", "escalation_needed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: true,
  };
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface CompletionRow {
  op_id: string;
  status: string;
  result_json: string | null;
  error_json: string | null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("src/broker/verbs/github-create-pr.ts", () => {
  // (a) submit creates the PR and records correlation; poll advances to done
  test("submit creates PR and polls to done with correlation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-a-"));
    try {
      const double = new GithubDouble();
      double.createResponse = {
        status: 201,
        number: 42,
        url: "https://github.com/owner/repo/pull/42",
      };
      double.getPrResponse = {
        number: 42,
        state: "open",
        url: "https://github.com/owner/repo/pull/42",
        merged: false,
      };

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const entry = makeCreatePrEntry();
      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN001",
        http: double,
        verifySetup: alwaysPass,
      });
      registerVerb(entry, adapter);

      const opId = await submit(
        entry,
        adapter,
        { head: "feature/my-branch", base: "main", title: "My PR", body: "description" },
        "idem-create-pr-a-001",
        store,
      );
      assert.ok(typeof opId === "string", "op_id must be a string");

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight after submit");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        entry,
        adapter,
        store,
        clock,
      );
      // observed_state_can_regress:true requires 2 consecutive terminal ticks
      // before the completion row is written (poller withholds on first terminal).
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      // Verify completion row
      const comp = store.get<CompletionRow>(
        "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(comp !== undefined, "completion row must exist after poll");
      assert.equal(comp.status, "done", "op must reach done when PR is open");

      // Correlation must carry {head_branch, pr_number}
      assert.ok(comp.result_json !== null, "result_json must carry correlation");
      const result = JSON.parse(comp.result_json) as { head_branch?: string; pr_number?: number };
      assert.equal(result.head_branch, "feature/my-branch", "correlation.head_branch must match");
      assert.equal(result.pr_number, 42, "correlation.pr_number must match");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // (b) "already exists" resolves to the existing PR (idempotency-by-head-branch)
  test("create duplicate resolves to existing PR via idempotency-by-head-branch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-b-"));
    try {
      const double = new GithubDouble();
      // double returns 422 "already exists" on create
      double.createResponse = {
        status: 422,
        message: "a pull request for branch \"feature/dup-branch\" already exists",
        existing_url: "https://github.com/owner/repo/pull/99",
      };
      // listByHead returns the existing PR
      double.listByHeadResponse = [
        { number: 99, state: "open", url: "https://github.com/owner/repo/pull/99" },
      ];
      double.getPrResponse = {
        number: 99,
        state: "open",
        url: "https://github.com/owner/repo/pull/99",
        merged: false,
      };

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const entry = makeCreatePrEntry();
      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN002",
        http: double,
        verifySetup: alwaysPass,
      });

      const opId = await submit(
        entry,
        adapter,
        { head: "feature/dup-branch", base: "main", title: "Dup PR", body: "" },
        "idem-create-pr-b-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight after submit");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        entry,
        adapter,
        store,
        clock,
      );
      // observed_state_can_regress:true requires 2 consecutive terminal ticks.
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const comp = store.get<CompletionRow>(
        "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(comp !== undefined, "completion row must exist after poll");
      assert.equal(comp.status, "done", "duplicate create must resolve as done (idempotency-by-head)");

      const result = JSON.parse(comp.result_json ?? "{}") as { pr_number?: number };
      assert.equal(result.pr_number, 99, "correlation must carry the existing PR number");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // (c) auth header present on double captures; token absent from ledger/events
  test("auth header is present on requests and token is absent from ledger rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-c-"));
    const SECRET_TOKEN = "ghp_SECRETTOKEN003";
    try {
      const double = new GithubDouble();
      double.createResponse = {
        status: 201,
        number: 7,
        url: "https://github.com/owner/repo/pull/7",
      };
      double.getPrResponse = {
        number: 7,
        state: "open",
        url: "https://github.com/owner/repo/pull/7",
        merged: false,
      };

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const entry = makeCreatePrEntry();
      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: SECRET_TOKEN,
        http: double,
        verifySetup: alwaysPass,
      });

      const opId = await submit(
        entry,
        adapter,
        { head: "feature/auth-check", base: "main", title: "Auth PR", body: "" },
        "idem-create-pr-c-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        entry,
        adapter,
        store,
        clock,
      );
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      // Auth header must be present on every double request
      assert.ok(double.log.length > 0, "double must have captured at least one request");
      for (const req of double.log) {
        const authHeader = req.headers["authorization"] ?? req.headers["Authorization"] ?? "";
        assert.ok(
          authHeader.includes(SECRET_TOKEN),
          `request ${req.method} ${req.path} must carry Bearer token in Authorization header`,
        );
      }

      // Token must NOT appear in any ledger row (broker_in_flight or broker_completion)
      const allInFlight = store.all<{ op_id: string; idempotency_key: string }>(
        "SELECT op_id, idempotency_key FROM broker_in_flight",
      );
      const allCompletion = store.all<{ op_id: string; result_json: string | null; error_json: string | null }>(
        "SELECT op_id, result_json, error_json FROM broker_completion",
      );

      for (const row of allInFlight) {
        const rowStr = JSON.stringify(row);
        assert.ok(
          !rowStr.includes(SECRET_TOKEN),
          `in-flight row must not contain token: ${rowStr}`,
        );
      }
      for (const row of allCompletion) {
        const rowStr = JSON.stringify(row);
        assert.ok(
          !rowStr.includes(SECRET_TOKEN),
          `completion row must not contain token: ${rowStr}`,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // (d) open→closed during poll resolves "failed" with {reason:"closed-externally"}
  test("open to closed transition during poll resolves failed with closed-externally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-d-"));
    try {
      const double = new GithubDouble();
      double.createResponse = {
        status: 201,
        number: 55,
        url: "https://github.com/owner/repo/pull/55",
      };

      let pollCount = 0;
      // First poll returns open; second poll returns closed
      const originalGetPr = double.getPr.bind(double);
      double.getPr = async (path: string, headers: Record<string, string>): Promise<GetPrResponse> => {
        pollCount += 1;
        double.log.push({ method: "GET", path, headers, body: null });
        if (pollCount <= 1) {
          return { number: 55, state: "open", url: "https://github.com/owner/repo/pull/55", merged: false };
        }
        return { number: 55, state: "closed", url: "https://github.com/owner/repo/pull/55", merged: false };
      };
      void originalGetPr; // suppress unused warning

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      // observed_state_can_regress: true so the poller holds first terminal and verifies
      const entry = makeCreatePrEntry();
      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN004",
        http: double,
        verifySetup: alwaysPass,
      });

      const opId = await submit(
        entry,
        adapter,
        { head: "feature/regress-check", base: "main", title: "Regress PR", body: "" },
        "idem-create-pr-d-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        entry,
        adapter,
        store,
        clock,
      );

      // First tick: submit returns open (non-terminal or first poll — depends on adapter)
      // Second tick: returns closed → failed(closed-externally)
      // Advance enough ticks
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const comp = store.get<CompletionRow>(
        "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(comp !== undefined, "completion row must exist");
      assert.equal(comp.status, "failed", "open→closed must resolve as failed");

      const errObj = JSON.parse(comp.error_json ?? "{}") as { reason?: string; observed_state?: string };
      assert.equal(errObj.reason, "closed-externally", "error must carry reason:closed-externally");
      assert.ok(
        errObj.observed_state !== undefined,
        "error must carry observed_state from the poll response",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Story 003 / Task T2 — Backoff, timeout escalation, reconcile branches
  // -------------------------------------------------------------------------

  // (a) rate-limit response causes backoff then retry; bounded by entry.retry.max
  test("rate-limit response backs off per registry on fake clock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-t2a-"));
    try {
      const double = new GithubDouble();
      double.createResponse = {
        status: 201,
        number: 10,
        url: "https://github.com/owner/repo/pull/10",
      };

      // First poll tick returns rate_limited; second returns open (done)
      let getPrCallCount = 0;
      double.getPr = async (path: string, headers: Record<string, string>): Promise<GetPrResponse> => {
        getPrCallCount += 1;
        double.log.push({ method: "GET", path, headers, body: null });
        if (getPrCallCount === 1) {
          // Adapter should return rate_limited status on first poll
          return { number: 10, state: "open", url: "https://github.com/owner/repo/pull/10", merged: false };
        }
        return { number: 10, state: "open", url: "https://github.com/owner/repo/pull/10", merged: false };
      };

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      // rate_limit: 60 req/min → deferMs = ceil(60000/60) = 1000
      const entry = {
        ...makeCreatePrEntry(),
        rate_limit: { requests_per_minute: 60 },
      };
      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN_T2A",
        http: double,
        verifySetup: alwaysPass,
      });
      // Wrap adapter to inject rate_limited on first poll, then open
      let pollCallCount = 0;
      const origPoll = adapter.poll_status.bind(adapter);
      adapter.poll_status = async (requestId: unknown): Promise<unknown> => {
        pollCallCount += 1;
        if (pollCallCount === 1) {
          return { status: "rate_limited" };
        }
        return origPoll(requestId);
      };

      registerVerb(entry, adapter);
      const opId = await submit(
        entry,
        adapter,
        { head: "feature/rate-limit", base: "main", title: "Rate PR", body: "" },
        "idem-t2a-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight after submit");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        entry,
        adapter,
        store,
        clock,
      );

      // First tick fires at poll_interval (50ms): returns rate_limited
      // Poller schedules next at deferMs = ceil(60000/60) = 1000ms
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      // No completion row yet (rate_limited is non-terminal)
      const noComp = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.equal(noComp, undefined, "no completion row after rate_limited tick");

      // Advance past the backoff delay (1000ms); first terminal tick
      const deferMs = Math.ceil(60000 / entry.rate_limit.requests_per_minute);
      clock.advance(deferMs);
      // The chain depth here is: outer async IIFE → await monkeypatched poll_status
      // → await origPoll → await http.getPr (custom async fn) = 4 microtask hops.
      // Use 4 resolves to fully flush before the confirm tick is scheduled.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      // Second consecutive terminal tick (observed_state_can_regress needs 2)
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const comp = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(comp !== undefined, "completion row must exist after backoff+retry");
      assert.equal(comp.status, "done", "op must reach done after rate-limit backoff");
      // Rate-limited tick must not have incremented getPr calls (it is non-terminal)
      assert.ok(pollCallCount >= 2, "poll must have been called at least twice (rate_limited then open)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // (b) never-terminal double hits per-verb timeout → escalation_needed
  test("never-terminal double hits per-verb timeout and emits escalation_needed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-t2b-"));
    try {
      const double = new GithubDouble();
      double.createResponse = {
        status: 201,
        number: 20,
        url: "https://github.com/owner/repo/pull/20",
      };
      // getPr always returns in-progress state — never terminal
      double.getPr = async (path: string, headers: Record<string, string>): Promise<GetPrResponse> => {
        double.log.push({ method: "GET", path, headers, body: null });
        // Return a non-terminal result by patching adapter poll_status externally
        return { number: 20, state: "open", url: "https://github.com/owner/repo/pull/20", merged: false };
      };

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      // Short timeout so we don't need many ticks
      const entry = {
        ...makeCreatePrEntry(),
        timeout: 200,  // 200ms timeout
        poll_interval: 50,
        observed_state_can_regress: false, // simpler: not regress-capable so we can avoid double-tick
      };
      // Patch adapter poll_status to always return a non-terminal status
      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN_T2B",
        http: double,
        verifySetup: alwaysPass,
      });
      adapter.poll_status = async (_requestId: unknown): Promise<unknown> => {
        return { status: "in_progress" }; // non-terminal, no error (regular poll)
      };

      registerVerb(entry, adapter);
      const opId = await submit(
        entry,
        adapter,
        { head: "feature/timeout-check", base: "main", title: "Timeout PR", body: "" },
        "idem-t2b-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight after submit");

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        entry,
        adapter,
        store,
        clock,
      );

      // Advance past timeout (200ms) with regular poll ticks (50ms each)
      // tick at 50ms → non-terminal; tick at 100ms → non-terminal;
      // tick at 150ms → non-terminal; tick at 200ms → elapsed >= timeout → escalation_needed
      clock.advance(entry.poll_interval); // 50ms
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(entry.poll_interval); // 100ms
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(entry.poll_interval); // 150ms
      await Promise.resolve();
      await Promise.resolve();
      clock.advance(entry.poll_interval); // 200ms — elapsed >= timeout
      await Promise.resolve();
      await Promise.resolve();

      const comp = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(comp !== undefined, "completion row must exist after timeout");
      assert.equal(comp.status, "escalation_needed", "op must reach escalation_needed on timeout");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // (c) reconcile branches: open PR → done (no create calls); no PR → resubmit;
  //     closed-externally → failed(closed-externally) + escalation-needed
  test("reconcile with open PR returns done and logs no create request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-t2c1-"));
    try {
      const double = new GithubDouble();
      // listByHead returns existing open PR
      double.listByHeadResponse = [
        { number: 30, state: "open", url: "https://github.com/owner/repo/pull/30" },
      ];

      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN_T2C1",
        http: double,
        verifySetup: alwaysPass,
      });

      // reconcile ledger: head_branch is the correlation key
      const result = await adapter.reconcile({
        head_branch: "feature/existing-pr",
        pr_number: 30,
      }) as { status: string; result?: { pr_number?: number } };

      assert.equal(result.status, "done", "reconcile must return done for existing open PR");
      assert.equal(result.result?.pr_number, 30, "reconcile done must carry pr_number correlation");
      // No create request must have been issued
      const createRequests = double.log.filter((r) => r.method === "POST");
      assert.equal(createRequests.length, 0, "reconcile must not issue any create (POST) requests");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reconcile with no PR returns resubmit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-t2c2-"));
    try {
      const double = new GithubDouble();
      // listByHead returns empty list (no PR for this head branch)
      double.listByHeadResponse = [];

      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN_T2C2",
        http: double,
        verifySetup: alwaysPass,
      });

      const result = await adapter.reconcile({
        head_branch: "feature/no-pr",
        pr_number: undefined,
      }) as { status: string };

      assert.equal(result.status, "resubmit", "reconcile must return resubmit when no PR exists");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reconcile with closed PR returns failed closed-externally and escalation-needed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-t2c3-"));
    try {
      const double = new GithubDouble();
      // listByHead returns a closed PR (closed by human)
      double.listByHeadResponse = [
        { number: 40, state: "closed", url: "https://github.com/owner/repo/pull/40" },
      ];

      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: "ghp_TESTTOKEN_T2C3",
        http: double,
        verifySetup: alwaysPass,
      });

      const result = await adapter.reconcile({
        head_branch: "feature/closed-pr",
        pr_number: 40,
      }) as { status: string; error?: { reason?: string; observed_state?: string }; escalation_needed?: boolean };

      // closed-externally must trigger failed + escalation-needed (same as poll-path classification)
      assert.equal(result.status, "failed", "reconcile must return failed for closed-externally");
      assert.equal(result.error?.reason, "closed-externally", "error must carry reason:closed-externally");
      assert.ok(result.error?.observed_state !== undefined, "error must carry observed_state");
      assert.ok(result.escalation_needed === true, "reconcile must signal escalation_needed on closed-externally");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // (d) redaction sweep: failing run captures no token in any output
  test("redaction sweep — token absent from all captured outputs of a failing run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-create-pr-t2d-"));
    const SECRET_TOKEN = "ghp_SWEEPSECRET_T2D";
    try {
      const capturedOutputs: string[] = [];

      const double = new GithubDouble();
      // Simulate a failing run: create succeeds, but getPr returns closed immediately
      double.createResponse = {
        status: 201,
        number: 50,
        url: "https://github.com/owner/repo/pull/50",
      };
      double.getPr = async (path: string, headers: Record<string, string>): Promise<GetPrResponse> => {
        double.log.push({ method: "GET", path, headers, body: null });
        return { number: 50, state: "closed", url: "https://github.com/owner/repo/pull/50", merged: false };
      };

      const store = openStore(join(dir, "broker.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(0);
      const entry = { ...makeCreatePrEntry(), observed_state_can_regress: false };
      const adapter = makeCreatePrAdapter({
        repo: "owner/repo",
        token: SECRET_TOKEN,
        http: double,
        verifySetup: alwaysPass,
      });

      const opId = await submit(
        entry,
        adapter,
        { head: "feature/sweep-check", base: "main", title: "Sweep PR", body: "" },
        "idem-t2d-001",
        store,
      );

      const op = store.get<{ op_id: string; verb: string; request_id: string; status: string }>(
        "SELECT op_id, verb, request_id, status FROM broker_in_flight WHERE op_id = ?",
        opId,
      );
      assert.ok(op !== undefined, "op must be in-flight");
      capturedOutputs.push(JSON.stringify(op));

      startPolling(
        { op_id: op.op_id, verb: op.verb, request_id: op.request_id, status: "in_flight" },
        entry,
        adapter,
        store,
        clock,
      );
      clock.advance(entry.poll_interval);
      await Promise.resolve();
      await Promise.resolve();

      const comp = store.get<CompletionRow>(
        "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
        opId,
      );
      assert.ok(comp !== undefined, "completion row must exist for sweep");
      capturedOutputs.push(JSON.stringify(comp));

      // Capture all in-flight rows
      const allInFlight = store.all<Record<string, unknown>>(
        "SELECT * FROM broker_in_flight",
      );
      for (const row of allInFlight) capturedOutputs.push(JSON.stringify(row));

      // Capture all captured requests from the double
      for (const req of double.log) {
        // Headers contain the auth token in normal use — exclude headers from the sweep
        // (the token IS present in captured request headers, which is expected for transport)
        // Sweep covers: ledger rows, completion payloads, error payloads
        capturedOutputs.push(JSON.stringify({ method: req.method, path: req.path, body: req.body }));
      }

      // Sweep all captured outputs for the token
      for (const output of capturedOutputs) {
        assert.ok(
          !output.includes(SECRET_TOKEN),
          `captured output must not contain token: ${output.substring(0, 200)}`,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// B1 — verifySetup gate on github.create_pr (Blocker B1, third installment)
// ---------------------------------------------------------------------------

describe("src/broker/verbs/github-create-pr.ts — B1 verifySetup gate", () => {
  test("verifySetup failing check prevents github.create_pr submit and emits blocked-needs-setup", async () => {
    // Build a failing VerifyReport
    const failingReport: VerifyReport = {
      platform: "github",
      repo: "owner/repo",
      identity: "bot",
      ok: false,
      checks: [
        {
          name: "gh-scopes",
          ok: false,
          detail: "Missing scope: repo",
          remediation: "Re-generate the PAT with repo scope.",
        },
      ],
      inboxItems: [
        {
          kind: "system:setup",
          message: "GitHub platform setup required for owner/repo (identity: bot)",
          details: "PAT missing required scopes: repo",
          remediation: "Re-generate the PAT with repo scope.",
        },
      ],
    };

    const fakePreflight = async () => failingReport;

    // Track whether http.createPr is ever called — it must NOT be
    let createPrCalled = false;
    const guardedHttp: GithubHttpSeam = {
      async createPr(_path, _headers, _body): Promise<CreatePrResponse> {
        createPrCalled = true;
        return { status: 201, number: 99, url: "https://github.com/owner/repo/pull/99" };
      },
      async getPr(_path, _headers): Promise<GetPrResponse> {
        return { number: 99, state: "open", url: "https://github.com/owner/repo/pull/99", merged: false };
      },
      async listByHead(_path, _headers): Promise<ListPrResponse> {
        return [];
      },
    };

    const adapter = makeCreatePrAdapter({
      repo: "owner/repo",
      token: "tok-test",
      http: guardedHttp,
      verifySetup: fakePreflight,
    });

    const result = await adapter.submit({
      head: "feature/blocked-pr",
      base: "main",
      title: "PR title",
      body: "PR body",
    }) as { status: string; inboxItems?: unknown[] };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "github.create_pr submit must return blocked-needs-setup when verifySetup fails",
    );
    assert.ok(
      Array.isArray(result.inboxItems) && result.inboxItems.length > 0,
      "blocked-needs-setup result must carry inboxItems",
    );
    assert.equal(
      createPrCalled,
      false,
      "http.createPr must not be called when verifySetup fails",
    );
  });
});

// ---------------------------------------------------------------------------
// B2 — adapter-native rate-limit response from GithubHttpSeam.getPr
// ---------------------------------------------------------------------------

describe("src/broker/verbs/github-create-pr.ts — B2 adapter-native rate-limit from getPr", () => {
  test("GithubHttpSeam.getPr returning rate-limit causes poll_status to return rate_limited natively", async () => {
    // Build a rate-limit response shaped by SU2 findings (HTTP 429 + retry_after).
    // This response comes from the seam — no monkeypatching of adapter.poll_status.
    const rateLimitResp: RateLimitResponse = {
      status: 429,
      retry_after: 1,
    };

    // Double whose getPr always returns the rate-limit shape
    const rateLimitedHttp: GithubHttpSeam = {
      async createPr(
        _path: string,
        _headers: Record<string, string>,
        _body: unknown,
      ): Promise<CreatePrResponse> {
        return { status: 201, number: 55, url: "https://github.com/owner/repo/pull/55" };
      },
      async getPr(
        _path: string,
        _headers: Record<string, string>,
      ): Promise<GetPrResponse | RateLimitResponse> {
        return rateLimitResp;
      },
      async listByHead(
        _path: string,
        _headers: Record<string, string>,
      ): Promise<ListPrResponse> {
        return [];
      },
    };

    const adapter = makeCreatePrAdapter({
      repo: "owner/repo",
      token: "ghp_TESTTOKEN_B2",
      http: rateLimitedHttp,
      verifySetup: alwaysPass,
    });

    // Submit first to populate internal state so poll_status can fire
    const requestId = await adapter.submit({
      head: "feature/b2-rate-limit",
      base: "main",
      title: "B2 PR",
      body: "",
    });

    // Call poll_status directly on the adapter — no monkeypatch
    const pollResult = await adapter.poll_status(requestId) as { status: string };

    assert.equal(
      pollResult.status,
      "rate_limited",
      "poll_status must return rate_limited when GithubHttpSeam.getPr returns a rate-limit response",
    );
  });
});

// ---------------------------------------------------------------------------
// Reviewer round-3 B1 — absent verifySetup must block github.create_pr submit
// Same runtime behavior as git-local and git-push adapters: when verifySetup
// is omitted entirely from CreatePrAdapterOpts, submit must return
// { status: "blocked-needs-setup", inboxItems: [] } without calling http.createPr.
// ---------------------------------------------------------------------------

describe("src/broker/verbs/github-create-pr.ts — reviewer-round-3 B1: absent verifySetup blocks submit", () => {
  test("omitting verifySetup blocks github.create_pr submit (verifySetup must not be optional)", async () => {
    let createPrCalled = false;
    const guardedHttp: GithubHttpSeam = {
      async createPr(_path, _headers, _body): Promise<CreatePrResponse> {
        createPrCalled = true;
        return { status: 201, number: 77, url: "https://github.com/owner/repo/pull/77" };
      },
      async getPr(_path, _headers): Promise<GetPrResponse> {
        return { number: 77, state: "open", url: "https://github.com/owner/repo/pull/77", merged: false };
      },
      async listByHead(_path, _headers): Promise<ListPrResponse> {
        return [];
      },
    };

    // Construct adapter with NO verifySetup — the gate must fire regardless.
    const adapter = makeCreatePrAdapter({
      repo: "owner/repo",
      token: "tok-b1-absent",
      http: guardedHttp,
      // verifySetup intentionally omitted
    });

    const result = await adapter.submit({
      head: "feature/b1-absent-verify",
      base: "main",
      title: "B1 absent",
      body: "",
    }) as { status: string; inboxItems?: unknown[] };

    assert.equal(
      result.status,
      "blocked-needs-setup",
      "github.create_pr submit must return blocked-needs-setup when verifySetup is absent",
    );
    assert.ok(
      Array.isArray(result.inboxItems),
      "blocked-needs-setup result must carry inboxItems array",
    );
    assert.equal(
      createPrCalled,
      false,
      "http.createPr must not be called when verifySetup is absent",
    );
  });
});
