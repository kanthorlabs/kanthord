import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadVerbRegistry, registerVerb } from "./registry.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";

describe("src/broker/registry.ts", () => {
  // -------------------------------------------------------------------------
  // T1 — Load verb registry entries (full §5 declaration surface)
  // -------------------------------------------------------------------------
  test("loadVerbRegistry returns typed entries with full §5 declaration surface", async () => {
    const dir = await mkdtemp(join(tmpdir(), "verb-registry-t1-"));
    try {
      await writeFile(
        join(dir, "deploy_service.yaml"),
        [
          "verb: deploy_service",
          "tier: auto",
          "timeout: 30000",
          "idempotency:",
          "  window_ms: 3600000",
          "retry:",
          "  max: 3",
          "  backoff: exponential",
          "poll_interval: 5000",
          "terminal_states:",
          "  - success",
          "  - failed",
          "  - timeout",
          "rate_limit:",
          "  requests_per_minute: 60",
          "observed_state_can_regress: false",
        ].join("\n"),
      );

      await writeFile(
        join(dir, "create_branch.yaml"),
        [
          "verb: create_branch",
          "tier: approval_required",
          "timeout: 60000",
          "idempotency:",
          "  window_ms: 86400000",
          "retry:",
          "  max: 5",
          "  backoff: linear",
          "poll_interval: 10000",
          "terminal_states:",
          "  - done",
          "  - error",
          "rate_limit:",
          "  requests_per_minute: 10",
          "observed_state_can_regress: true",
        ].join("\n"),
      );

      const registry = await loadVerbRegistry(dir);

      // ---- verb 1: deploy_service ------------------------------------------
      const v1 = registry["deploy_service"];
      assert.ok(v1, "deploy_service entry must be present");
      assert.equal(v1.verb, "deploy_service");
      assert.equal(v1.tier, "auto");
      assert.equal(v1.timeout, 30000);
      assert.equal(v1.idempotency.window_ms, 3600000);
      assert.equal(v1.retry.max, 3);
      assert.equal(v1.retry.backoff, "exponential");
      assert.equal(v1.poll_interval, 5000);
      assert.deepEqual(v1.terminal_states, ["success", "failed", "timeout"]);
      assert.equal(v1.rate_limit.requests_per_minute, 60);
      assert.equal(v1.observed_state_can_regress, false);

      // ---- verb 2: create_branch -------------------------------------------
      const v2 = registry["create_branch"];
      assert.ok(v2, "create_branch entry must be present");
      assert.equal(v2.verb, "create_branch");
      assert.equal(v2.tier, "approval_required");
      assert.equal(v2.timeout, 60000);
      assert.equal(v2.idempotency.window_ms, 86400000);
      assert.equal(v2.retry.max, 5);
      assert.equal(v2.retry.backoff, "linear");
      assert.equal(v2.poll_interval, 10000);
      assert.deepEqual(v2.terminal_states, ["done", "error"]);
      assert.equal(v2.rate_limit.requests_per_minute, 10);
      assert.equal(v2.observed_state_can_regress, true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2 — Async adapter interface + reconcile-required rule
  // -------------------------------------------------------------------------
  const stubEntry: VerbRegistryEntry = {
    verb: "deploy_service",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 3600000 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 5000,
    terminal_states: ["success", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };

  test("registerVerb throws a typed error naming the verb when reconcile adapter is absent", () => {
    const noReconcileAdapter = {
      submit: async (_input: unknown): Promise<unknown> => ({}),
      poll_status: async (_requestId: unknown): Promise<unknown> => ({}),
    } as unknown as AsyncVerbAdapter;

    assert.throws(
      () => registerVerb(stubEntry, noReconcileAdapter),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must throw an Error");
        assert.ok(
          err.message.includes("deploy_service"),
          `error message must name the verb; got: "${err.message}"`,
        );
        return true;
      },
    );
  });

  test("registerVerb accepts a complete adapter with submit, poll_status, and reconcile", () => {
    const fullAdapter: AsyncVerbAdapter = {
      submit: async (_input: unknown): Promise<unknown> => ({}),
      poll_status: async (_requestId: unknown): Promise<unknown> => ({}),
      reconcile: async (_ledger: unknown): Promise<unknown> => ({}),
    };

    assert.doesNotThrow(() => registerVerb(stubEntry, fullAdapter));
  });
});
