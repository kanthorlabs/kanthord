/**
 * B5 — Production registry entries: all real verbs load from the real path
 * with complete PRD §5 contracts.
 *
 * Tests (one per verb family):
 *  (a) git.branch registry entry: complete §5 fields, tier:auto, rate_limit n/a
 *  (b) git.commit registry entry: complete §5 fields, tier:auto, rate_limit n/a
 *  (c) git.clone  registry entry: complete §5 fields, tier:auto, rate_limit n/a
 *  (d) git.fetch  registry entry: complete §5 fields, tier:auto, rate_limit n/a
 *  (e) git.push   registry entry: complete §5 fields, tier:auto, idempotency required, rate_limit n/a
 *  (f) github.create_pr registry entry: complete §5 fields, tier:auto_with_audit, rate_limit declared
 *  (g) all six verbs pass registerVerb reconcile-path check (non-stub adapters not needed — presence of reconcile on a stub adapter is the §5 rule)
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadVerbRegistry, registerVerb } from "../registry.ts";
import type { VerbRegistryEntry, AsyncVerbAdapter } from "../registry.ts";

// ---------------------------------------------------------------------------
// Production registry path: <project-root>/broker/verbs/
// This file lives at src/broker/verbs/registry-production.test.ts
// Three levels up from src/broker/verbs/ → project root
// ---------------------------------------------------------------------------
const REGISTRY_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "broker",
  "verbs",
);

/** Stub adapter satisfying the reconcile-path check. */
function makeStubAdapter(): AsyncVerbAdapter {
  return {
    submit: async (_input: unknown) => ({}),
    poll_status: async (_requestId: unknown) => ({}),
    reconcile: async (_ledger: unknown) => ({}),
  };
}

/** Assert a VerbRegistryEntry has all required PRD §5 fields with valid values. */
function assertCompleteContract(
  entry: VerbRegistryEntry,
  verbName: string,
  opts: {
    expectedTier: "auto" | "auto_with_audit";
    rateLimitIsNa: boolean;
    idempotencyRequired: boolean;
    observedStateCanRegress: boolean;
  },
): void {
  assert.equal(entry.verb, verbName, `${verbName}: verb field`);
  assert.equal(entry.tier, opts.expectedTier, `${verbName}: tier`);
  assert.ok(
    typeof entry.timeout === "number" && entry.timeout > 0,
    `${verbName}: timeout > 0`,
  );
  assert.ok(
    typeof entry.idempotency === "object" &&
    typeof entry.idempotency.window_ms === "number",
    `${verbName}: idempotency.window_ms declared`,
  );
  if (opts.idempotencyRequired) {
    assert.ok(
      entry.idempotency.window_ms > 0,
      `${verbName}: idempotency.window_ms > 0 (required)`,
    );
  }
  assert.ok(
    typeof entry.retry === "object" &&
    typeof entry.retry.max === "number" &&
    entry.retry.max > 0 &&
    typeof entry.retry.backoff === "string" &&
    entry.retry.backoff.length > 0,
    `${verbName}: retry.max > 0, retry.backoff declared`,
  );
  assert.ok(
    typeof entry.poll_interval === "number" && entry.poll_interval > 0,
    `${verbName}: poll_interval > 0`,
  );
  assert.ok(
    Array.isArray(entry.terminal_states) && entry.terminal_states.length > 0,
    `${verbName}: terminal_states non-empty`,
  );
  assert.ok(
    entry.terminal_states.includes("done"),
    `${verbName}: terminal_states includes done`,
  );
  assert.ok(
    typeof entry.rate_limit === "object" &&
    typeof entry.rate_limit.requests_per_minute === "number",
    `${verbName}: rate_limit.requests_per_minute declared`,
  );
  if (opts.rateLimitIsNa) {
    assert.equal(
      entry.rate_limit.requests_per_minute,
      0,
      `${verbName}: rate_limit n/a declared as 0`,
    );
  } else {
    assert.ok(
      entry.rate_limit.requests_per_minute > 0,
      `${verbName}: rate_limit.requests_per_minute > 0 for non-local verb`,
    );
  }
  assert.equal(
    typeof entry.observed_state_can_regress,
    "boolean",
    `${verbName}: observed_state_can_regress declared`,
  );
  assert.equal(
    entry.observed_state_can_regress,
    opts.observedStateCanRegress,
    `${verbName}: observed_state_can_regress = ${opts.observedStateCanRegress}`,
  );
}

describe("src/broker/verbs: production registry entries (broker/verbs/)", () => {
  // (a) git.branch
  test("git.branch production registry entry: tier:auto, rate_limit:n/a, complete §5 contract", async () => {
    const registry = await loadVerbRegistry(REGISTRY_DIR);
    const entry = registry["git.branch"];
    assert.ok(entry !== undefined, "git.branch entry must be present in production registry");
    assertCompleteContract(entry, "git.branch", {
      expectedTier: "auto",
      rateLimitIsNa: true,
      idempotencyRequired: false,
      observedStateCanRegress: false,
    });
  });

  // (b) git.commit
  test("git.commit production registry entry: tier:auto, rate_limit:n/a, complete §5 contract", async () => {
    const registry = await loadVerbRegistry(REGISTRY_DIR);
    const entry = registry["git.commit"];
    assert.ok(entry !== undefined, "git.commit entry must be present in production registry");
    assertCompleteContract(entry, "git.commit", {
      expectedTier: "auto",
      rateLimitIsNa: true,
      idempotencyRequired: false,
      observedStateCanRegress: false,
    });
  });

  // (c) git.clone
  test("git.clone production registry entry: tier:auto, rate_limit:n/a, complete §5 contract", async () => {
    const registry = await loadVerbRegistry(REGISTRY_DIR);
    const entry = registry["git.clone"];
    assert.ok(entry !== undefined, "git.clone entry must be present in production registry");
    assertCompleteContract(entry, "git.clone", {
      expectedTier: "auto",
      rateLimitIsNa: true,
      idempotencyRequired: false,
      observedStateCanRegress: false,
    });
  });

  // (d) git.fetch
  test("git.fetch production registry entry: tier:auto, rate_limit:n/a, complete §5 contract", async () => {
    const registry = await loadVerbRegistry(REGISTRY_DIR);
    const entry = registry["git.fetch"];
    assert.ok(entry !== undefined, "git.fetch entry must be present in production registry");
    assertCompleteContract(entry, "git.fetch", {
      expectedTier: "auto",
      rateLimitIsNa: true,
      idempotencyRequired: false,
      observedStateCanRegress: false,
    });
  });

  // (e) git.push — idempotency required (window_ms > 0)
  test("git.push production registry entry: tier:auto, idempotency required, rate_limit:n/a, complete §5 contract", async () => {
    const registry = await loadVerbRegistry(REGISTRY_DIR);
    const entry = registry["git.push"];
    assert.ok(entry !== undefined, "git.push entry must be present in production registry");
    assertCompleteContract(entry, "git.push", {
      expectedTier: "auto",
      rateLimitIsNa: true,
      idempotencyRequired: true,
      observedStateCanRegress: false,
    });
  });

  // (f) github.create_pr — auto_with_audit, rate_limit declared non-zero
  test("github.create_pr production registry entry: tier:auto_with_audit, rate_limit declared, complete §5 contract", async () => {
    const registry = await loadVerbRegistry(REGISTRY_DIR);
    const entry = registry["github.create_pr"];
    assert.ok(entry !== undefined, "github.create_pr entry must be present in production registry");
    assertCompleteContract(entry, "github.create_pr", {
      expectedTier: "auto_with_audit",
      rateLimitIsNa: false,
      idempotencyRequired: true,
      observedStateCanRegress: true,
    });
    // github.create_pr must declare escalation_needed as a terminal state
    assert.ok(
      entry.terminal_states.includes("escalation_needed"),
      "github.create_pr: terminal_states includes escalation_needed",
    );
  });

  // (g) all six verbs pass the registerVerb reconcile-path check
  test("all six production verbs pass registerVerb reconcile-path check", async () => {
    const registry = await loadVerbRegistry(REGISTRY_DIR);
    const verbs = ["git.branch", "git.commit", "git.clone", "git.fetch", "git.push", "github.create_pr"];
    for (const verbName of verbs) {
      const entry = registry[verbName];
      assert.ok(entry !== undefined, `${verbName}: entry must be in production registry`);
      // registerVerb throws if reconcile is absent — a stub adapter suffices
      assert.doesNotThrow(
        () => registerVerb(entry, makeStubAdapter()),
        `${verbName}: registerVerb must not throw (reconcile path present)`,
      );
    }
  });
});
