import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FeatureStore } from "../store/feature-store.ts";
import { writeLedgerEntry, recoverFromLedger } from "./ledger.ts";
import type { LedgerEntry } from "./ledger.ts";

// Suite: src/broker/ledger.ts
// Story 004 — Durable Operation Ledger & Crash Reconciliation, Task T1:
// ledger entry write/recover contract.

describe("src/broker/ledger.ts", () => {
  // -------------------------------------------------------------------------
  // T1a — writeLedgerEntry stores all §5 identity fields with no request_id
  // -------------------------------------------------------------------------
  test("writeLedgerEntry stores all §5 identity fields with no request_id into task markdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-ledger-t1a-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      // appendJournal writes into <featureDir>/<storyId>/ — directory must exist
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      const entry: LedgerEntry = {
        op_id: "op-ledger-T1a",
        verb: "deploy_service",
        idempotency_key: "idem-T1a",
        correlation: "branch-feature-001",
        desired_effect_hash: "sha256-abc123def456",
        status: "in_flight",
      };

      const returnedOpId = await writeLedgerEntry(
        featureStore,
        storyId,
        taskStem,
        entry,
      );
      assert.strictEqual(
        returnedOpId,
        entry.op_id,
        "writeLedgerEntry returns the op_id",
      );

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      assert.strictEqual(recovered.length, 1, "exactly one ledger entry recovered");
      const rec = recovered[0];
      assert.ok(rec !== undefined, "recovered entry exists");
      assert.strictEqual(rec.op_id, entry.op_id, "op_id round-trips");
      assert.strictEqual(rec.verb, entry.verb, "verb round-trips");
      assert.strictEqual(
        rec.idempotency_key,
        entry.idempotency_key,
        "idempotency_key round-trips",
      );
      assert.strictEqual(rec.correlation, entry.correlation, "correlation round-trips");
      assert.strictEqual(
        rec.desired_effect_hash,
        entry.desired_effect_hash,
        "desired_effect_hash round-trips",
      );
      assert.ok(
        !("request_id" in rec),
        "no request_id in ledger entry (request ids are ephemeral — never synced)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1b — recoverFromLedger maps in_flight → needs_reconciliation; omits request_id
  // -------------------------------------------------------------------------
  test("recoverFromLedger marks interrupted in_flight op as needs_reconciliation and omits request_id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-ledger-t1b-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-ledger-T1b",
        verb: "deploy_service",
        idempotency_key: "idem-T1b",
        correlation: "branch-feature-002",
        desired_effect_hash: "sha256-def456abc123",
        status: "in_flight",
      });

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const rec = recovered.find((r) => r.op_id === "op-ledger-T1b");
      assert.ok(rec !== undefined, "in_flight op is recovered from the ledger");
      assert.strictEqual(
        rec.status,
        "needs_reconciliation",
        "in_flight op is marked needs_reconciliation on recovery",
      );
      assert.ok(
        !("request_id" in rec),
        "no request_id on the recovered entry",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // T1c — idempotent dedup: same (verb, idempotency_key) → original op_id, no second entry
  // -------------------------------------------------------------------------
  test("resubmitting same (verb, idempotency_key) after recovery returns original op_id with no second ledger entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "broker-ledger-t1c-"));
    try {
      const featureStore = new FeatureStore(join(dir, "feature"));
      const storyId = "001-story";
      const taskStem = "001-task";
      await mkdir(join(dir, "feature", storyId), { recursive: true });

      const original: LedgerEntry = {
        op_id: "op-ledger-T1c",
        verb: "deploy_service",
        idempotency_key: "idem-T1c",
        correlation: "branch-feature-003",
        desired_effect_hash: "sha256-ghi789jkl012",
        status: "in_flight",
      };
      const firstOpId = await writeLedgerEntry(
        featureStore,
        storyId,
        taskStem,
        original,
      );

      // Simulate a resubmit: same (verb, idempotency_key), different op_id candidate
      const secondOpId = await writeLedgerEntry(featureStore, storyId, taskStem, {
        op_id: "op-ledger-T1c-NEW",
        verb: "deploy_service",
        idempotency_key: "idem-T1c",
        correlation: "branch-feature-003",
        desired_effect_hash: "sha256-ghi789jkl012",
        status: "pending",
      });

      assert.strictEqual(
        secondOpId,
        firstOpId,
        "second write with same (verb, idempotency_key) returns the original op_id",
      );

      const recovered = await recoverFromLedger(featureStore, storyId, taskStem);
      const matching = recovered.filter(
        (r) => r.verb === "deploy_service" && r.idempotency_key === "idem-T1c",
      );
      assert.strictEqual(
        matching.length,
        1,
        "exactly one ledger entry for (verb, idempotency_key) — no duplicate written",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
