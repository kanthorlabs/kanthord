import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { FakeClock } from "../foundations/clock.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { writeLedgerEntry, recoverFromLedger } from "./ledger.ts";
import type { AsyncVerbAdapter, VerbRegistryEntry } from "./registry.ts";
import { reconcileOp } from "./reconcile.ts";

// Suite: src/broker/reconcile.ts
// Story 004 — Durable Operation Ledger & Crash Reconciliation, Task T2:
// reconcile state machine — each outcome branch and the hash-match invariant.

/** Row shape of broker_completion as read back from SQLite. */
interface CompletionRow {
  op_id: string;
  status: string;
  result_json: string | null;
  error_json: string | null;
}

function makeEntry(): VerbRegistryEntry {
  return {
    verb: "deploy_service",
    tier: "auto",
    timeout: 30000,
    idempotency: { window_ms: 3600000 },
    retry: { max: 3, backoff: "exponential" },
    poll_interval: 5000,
    terminal_states: ["done", "failed"],
    rate_limit: { requests_per_minute: 60 },
    observed_state_can_regress: false,
  };
}

describe("src/broker/reconcile.ts", () => {
  // -------------------------------------------------------------------------
  // T2a — done branch: observed hash matches desired → writes done completion row
  // -------------------------------------------------------------------------
  test("reconcile done branch: observed hash matches desired — writes done completion row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-reconcile-t2a-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      const DESIRED_HASH = "sha256-correct-hash-T2a";
      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-reconcile-T2a",
        verb: "deploy_service",
        idempotency_key: "idem-T2a",
        correlation: "branch-feature-T2a",
        desired_effect_hash: DESIRED_HASH,
        status: "in_flight",
      });

      // Simulate crash: use a fresh SQLite store (no in-flight/completion rows).
      const store = openStore(join(dir, "broker-T2a.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(1000);

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const ledgerEntry = recovered.find((r) => r.op_id === "op-reconcile-T2a");
      assert.ok(ledgerEntry !== undefined, "entry recovered from ledger after crash");
      assert.strictEqual(
        ledgerEntry.status,
        "needs_reconciliation",
        "interrupted in_flight op is needs_reconciliation",
      );

      const adapter: AsyncVerbAdapter = {
        submit: async () => "req-ignored",
        poll_status: async () => ({ status: "pending" }),
        // Fake remote: observed hash matches desired → done
        reconcile: async () => ({ outcome: "done", observed_hash: DESIRED_HASH }),
      };

      const outcome = await reconcileOp(ledgerEntry, makeEntry(), adapter, store, clock);

      assert.strictEqual(outcome, "done", "reconcileOp returns done on hash match");
      const row = store.get<CompletionRow>(
        "SELECT op_id, status, result_json, error_json FROM broker_completion WHERE op_id = ?",
        ledgerEntry.op_id,
      );
      assert.ok(row !== undefined, "completion row written to broker_completion");
      assert.strictEqual(row.status, "done", "completion row has status=done");
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2b — hash mismatch: adapter claims done but observed_hash ≠ desired → NOT done
  // -------------------------------------------------------------------------
  test("reconcile done branch: observed hash mismatches desired — does not write done completion row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-reconcile-t2b-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      const DESIRED_HASH = "sha256-desired-T2b";
      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-reconcile-T2b",
        verb: "deploy_service",
        idempotency_key: "idem-T2b",
        correlation: "branch-feature-T2b",
        desired_effect_hash: DESIRED_HASH,
        status: "in_flight",
      });

      const store = openStore(join(dir, "broker-T2b.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(1000);

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const ledgerEntry = recovered.find((r) => r.op_id === "op-reconcile-T2b");
      assert.ok(ledgerEntry !== undefined);

      const adapter: AsyncVerbAdapter = {
        submit: async () => "req-ignored",
        poll_status: async () => ({ status: "pending" }),
        // Fake remote: claims done but observed hash does NOT match desired
        reconcile: async () => ({
          outcome: "done",
          observed_hash: "sha256-WRONG-HASH-mismatch",
        }),
      };

      const outcome = await reconcileOp(ledgerEntry, makeEntry(), adapter, store, clock);

      assert.notStrictEqual(
        outcome,
        "done",
        "reconcileOp must not return done when observed_hash mismatches desired_effect_hash",
      );
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2c — failed branch: writes failed completion row
  // -------------------------------------------------------------------------
  test("reconcile failed branch: writes failed completion row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-reconcile-t2c-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-reconcile-T2c",
        verb: "deploy_service",
        idempotency_key: "idem-T2c",
        correlation: "branch-feature-T2c",
        desired_effect_hash: "sha256-T2c",
        status: "in_flight",
      });

      const store = openStore(join(dir, "broker-T2c.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(1000);

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const ledgerEntry = recovered.find((r) => r.op_id === "op-reconcile-T2c");
      assert.ok(ledgerEntry !== undefined);

      const adapter: AsyncVerbAdapter = {
        submit: async () => "req-ignored",
        poll_status: async () => ({ status: "pending" }),
        // Fake remote: verb is unrecoverably failed
        reconcile: async () => ({ outcome: "failed" }),
      };

      const outcome = await reconcileOp(ledgerEntry, makeEntry(), adapter, store, clock);

      assert.strictEqual(outcome, "failed", "reconcileOp returns failed");
      const row = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        ledgerEntry.op_id,
      );
      assert.ok(row !== undefined, "completion row written for failed outcome");
      assert.strictEqual(row.status, "failed", "completion row status is failed");
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2d — resubmit branch: original idempotency key reused, new request_id
  //        minted, no double-effect on a second reconcile call
  // -------------------------------------------------------------------------
  test("reconcile resubmit branch: reuses original idempotency key, mints new request_id, no double-effect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-reconcile-t2d-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      const IDEM_KEY = "idem-T2d-original";
      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-reconcile-T2d",
        verb: "deploy_service",
        idempotency_key: IDEM_KEY,
        correlation: "branch-feature-T2d",
        desired_effect_hash: "sha256-T2d",
        status: "in_flight",
      });

      const store = openStore(join(dir, "broker-T2d.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(1000);

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const ledgerEntry = recovered.find((r) => r.op_id === "op-reconcile-T2d");
      assert.ok(ledgerEntry !== undefined);

      let submitCalls = 0;
      const adapter: AsyncVerbAdapter = {
        submit: async () => {
          submitCalls++;
          return "req-resubmit-T2d-001";
        },
        poll_status: async () => ({ status: "pending" }),
        // Fake remote: state is indeterminate, resubmit required
        reconcile: async () => ({ outcome: "resubmit" }),
      };

      // First reconcile call — should call adapter.submit once
      const outcome = await reconcileOp(ledgerEntry, makeEntry(), adapter, store, clock);

      assert.strictEqual(outcome, "resubmit", "reconcileOp returns resubmit");
      assert.strictEqual(submitCalls, 1, "adapter.submit called exactly once for resubmit");

      // Original idempotency key is reused in the new in-flight row
      interface InFlightRow {
        op_id: string;
        idempotency_key: string;
      }
      const inFlight = store.get<InFlightRow>(
        "SELECT op_id, idempotency_key FROM broker_in_flight WHERE idempotency_key = ?",
        IDEM_KEY,
      );
      assert.ok(
        inFlight !== undefined,
        "in-flight row created with the original idempotency key",
      );
      assert.strictEqual(
        inFlight.idempotency_key,
        IDEM_KEY,
        "original idempotency key is preserved in the resubmit in-flight row",
      );

      // No double-effect: a second reconcileOp call does not call adapter.submit again
      // (the idempotency dedup in broker_in_flight prevents the double-submit)
      await reconcileOp(ledgerEntry, makeEntry(), adapter, store, clock);
      assert.strictEqual(
        submitCalls,
        1,
        "adapter.submit still called only once — idempotency key prevents double-effect",
      );
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T2e — escalate branch: writes escalation_needed completion row
  // -------------------------------------------------------------------------
  test("reconcile escalate branch: writes escalation_needed completion row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-reconcile-t2e-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-reconcile-T2e",
        verb: "deploy_service",
        idempotency_key: "idem-T2e",
        correlation: "branch-feature-T2e",
        desired_effect_hash: "sha256-T2e",
        status: "in_flight",
      });

      const store = openStore(join(dir, "broker-T2e.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(1000);

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const ledgerEntry = recovered.find((r) => r.op_id === "op-reconcile-T2e");
      assert.ok(ledgerEntry !== undefined);

      const adapter: AsyncVerbAdapter = {
        submit: async () => "req-ignored",
        poll_status: async () => ({ status: "pending" }),
        // Fake remote: remote state is ambiguous or unresolvable — escalate
        reconcile: async () => ({ outcome: "escalate" }),
      };

      const outcome = await reconcileOp(ledgerEntry, makeEntry(), adapter, store, clock);

      assert.strictEqual(outcome, "escalate", "reconcileOp returns escalate");
      const row = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        ledgerEntry.op_id,
      );
      assert.ok(row !== undefined, "completion row written for escalate outcome");
      assert.strictEqual(
        row.status,
        "escalation_needed",
        "escalate outcome writes escalation_needed status to broker_completion",
      );
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // S1 REGRESSION — hash-mismatch branch must write a broker_completion row
  // Every other terminal branch writes one; the hash-mismatch path must too.
  // -------------------------------------------------------------------------
  test("reconcile done branch: hash mismatch writes a failed completion row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-reconcile-s1-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      const DESIRED_HASH = "sha256-desired-s1";
      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-reconcile-s1",
        verb: "deploy_service",
        idempotency_key: "idem-s1",
        correlation: "branch-feature-s1",
        desired_effect_hash: DESIRED_HASH,
        status: "in_flight",
      });

      const store = openStore(join(dir, "broker-s1.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(1000);

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const ledgerEntry = recovered.find((r) => r.op_id === "op-reconcile-s1");
      assert.ok(ledgerEntry !== undefined, "entry recovered from ledger after crash");

      const adapter: AsyncVerbAdapter = {
        submit: async () => "req-ignored",
        poll_status: async () => ({ status: "pending" }),
        // Fake remote: claims done but observed hash does NOT match desired
        reconcile: async () => ({
          outcome: "done",
          observed_hash: "sha256-WRONG-HASH-s1",
        }),
      };

      const outcome = await reconcileOp(ledgerEntry, makeEntry(), adapter, store, clock);

      assert.notStrictEqual(outcome, "done", "hash mismatch must not return done");

      // S1: hash-mismatch is a terminal outcome — a broker_completion row must
      // be written (consistent with every other terminal branch: failed,
      // escalate, done-with-match all write a row).
      const row = store.get<CompletionRow>(
        "SELECT op_id, status FROM broker_completion WHERE op_id = ?",
        ledgerEntry.op_id,
      );
      assert.ok(row !== undefined, "hash-mismatch path must write a broker_completion row for the op_id");
      assert.strictEqual(
        row.status,
        "failed",
        "hash-mismatch completion row must have status='failed'",
      );

      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // S2 REGRESSION — resubmit path must pass the ORIGINAL operation payload
  // to adapter.submit, not the LedgerEntry object (ledger metadata).
  // -------------------------------------------------------------------------
  test("reconcile resubmit branch: adapter.submit receives the original operation payload not ledger metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-reconcile-s2-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-reconcile-s2",
        verb: "deploy_service",
        idempotency_key: "idem-s2",
        correlation: "branch-feature-s2",
        desired_effect_hash: "sha256-s2",
        status: "in_flight",
      });

      const store = openStore(join(dir, "broker-s2.db"), { busyTimeout: 1000 });
      const clock = new FakeClock(1000);

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const ledgerEntry = recovered.find((r) => r.op_id === "op-reconcile-s2");
      assert.ok(ledgerEntry !== undefined, "entry recovered from ledger after crash");

      const ORIGINAL_PAYLOAD = { action: "deploy", service: "auth-service", version: "1.2.3" };
      let capturedSubmitPayload: unknown = undefined;

      const adapter: AsyncVerbAdapter = {
        submit: async (p: unknown) => {
          capturedSubmitPayload = p;
          return "req-s2-001";
        },
        poll_status: async () => ({ status: "pending" }),
        // Fake remote: state is indeterminate, must resubmit
        reconcile: async () => ({ outcome: "resubmit" }),
      };

      // S2: reconcileOp must accept a payload parameter (6th arg) so the
      // resubmit branch passes the original operation payload — not the
      // ledger metadata — to adapter.submit.
      // RED: (a) reconcileOp has no payload parameter yet; (b) even at
      // runtime the 6th arg is silently ignored and adapter.submit receives
      // ledgerEntry instead of ORIGINAL_PAYLOAD — deepEqual fails.
      const outcome = await reconcileOp(
        ledgerEntry,
        makeEntry(),
        adapter,
        store,
        clock,
        ORIGINAL_PAYLOAD,
      );

      assert.strictEqual(outcome, "resubmit", "reconcileOp returns resubmit");
      assert.deepEqual(
        capturedSubmitPayload,
        ORIGINAL_PAYLOAD,
        "adapter.submit must receive the original operation payload, not the LedgerEntry metadata",
      );

      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
