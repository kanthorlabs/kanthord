import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeSqliteReconcileStorage } from "./sqlite-reconcile-storage.ts";
import type { AtomicReconcileStorage } from "./sqlite-reconcile-storage.ts";
import { makeBudgetReconciler } from "./budget-reconcile.ts";
import type { ReconcileEscalationEvent } from "./budget-reconcile.ts";

// ---------------------------------------------------------------------------
// T1 — SqliteReconcileStorage satisfies ReconcileStorage contract
// ---------------------------------------------------------------------------

describe("src/ring1/sqlite-reconcile-storage.ts — T1 storage contract", () => {
  let tmpDir!: string;
  let storage!: AtomicReconcileStorage;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sqlite-reconcile-t1-"));
    storage = makeSqliteReconcileStorage(join(tmpDir, "budget.db"));
  });

  after(async () => {
    storage.close();
    await rm(tmpDir, { recursive: true });
  });

  it("T1(a): load returns null for an unknown taskId", async () => {
    const result = await storage.load("no-such-task");
    assert.equal(result, null, "load on missing taskId must return null");
  });

  it("T1(b): save then load returns the same serialized value", async () => {
    await storage.save("task-t1b", '{"entries":[]}');
    const loaded = await storage.load("task-t1b");
    assert.equal(loaded, '{"entries":[]}', "load must return the exact saved value");
  });

  it("T1(c): save over an existing taskId replaces the value", async () => {
    await storage.save("task-t1c", "first");
    await storage.save("task-t1c", "second");
    const loaded = await storage.load("task-t1c");
    assert.equal(loaded, "second", "subsequent save must overwrite the previous value");
  });

  it("T1(d): atomicUpdate applies the updater and persists the result", async () => {
    await storage.atomicUpdate("task-t1d", (current) => {
      assert.equal(current, null, "first atomicUpdate must see null for a new taskId");
      return '["reservation-1"]';
    });
    const loaded = await storage.load("task-t1d");
    assert.equal(loaded, '["reservation-1"]', "atomicUpdate must persist the returned value");
  });

  it("T1(e): atomicUpdate sees the previous value on second call", async () => {
    await storage.atomicUpdate("task-t1e", (_current) => '["r1"]');
    await storage.atomicUpdate("task-t1e", (current) => {
      assert.equal(current, '["r1"]', "second atomicUpdate must see the value written by the first");
      return '["r1","r2"]';
    });
    const loaded = await storage.load("task-t1e");
    assert.equal(loaded, '["r1","r2"]', "atomicUpdate chain must produce the accumulated value");
  });
});

// ---------------------------------------------------------------------------
// T2 — concurrent near-ceiling reserves cannot both proceed (atomicity)
//
// Node.js is single-threaded so "concurrent" here means two reserve() calls
// issued without awaiting the first — both read the ledger, compute under-
// ceiling, and then attempt to write.  With a non-atomic load/save the second
// write overwrites the first and the ceiling is bypassed.  With an atomic
// SQLite UPDATE-WHERE or BEGIN IMMEDIATE transaction the second write either
// serializes or detects the stale read and re-checks — only one may proceed.
//
// Ceiling = 10; conservativeCost = 7; two concurrent reserves of 7 each →
// 7 + 7 = 14 > 10 → at most one can proceed.
// ---------------------------------------------------------------------------

describe("src/ring1/sqlite-reconcile-storage.ts — T2 concurrent reserve atomicity", () => {
  let tmpDir!: string;
  let storage!: AtomicReconcileStorage;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sqlite-reconcile-t2-"));
    storage = makeSqliteReconcileStorage(join(tmpDir, "budget-atomic.db"));
  });

  after(async () => {
    storage.close();
    await rm(tmpDir, { recursive: true });
  });

  it("T2(a): two concurrent near-ceiling reserves — at most one proceeds", async () => {
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 10, conservativeCost: 7 },
      storage,
      (e) => escalations.push(e),
    );

    // Issue both reserves without awaiting — they race against the same ledger.
    // Ceiling = 10; each reserve = 7 → only one can proceed (7 ≤ 10) before
    // the second sees cumulative 7 + 7 = 14 > 10.
    const [r1, r2] = await Promise.all([
      reconciler.reserve("task-t2a", 7),
      reconciler.reserve("task-t2a", 7),
    ]);

    const proceeded = [r1, r2].filter((r) => r.status === "proceed");
    const halted = [r1, r2].filter((r) => r.status === "halted");

    assert.equal(
      proceeded.length,
      1,
      "exactly one concurrent reserve must proceed — atomicity must prevent both from seeing under-ceiling",
    );
    assert.equal(
      halted.length,
      1,
      "exactly one concurrent reserve must be halted — ceiling enforced atomically",
    );
    assert.equal(
      escalations.length,
      1,
      "the halted reserve must emit exactly one budget-breach escalation",
    );
    assert.equal(escalations[0]?.tag, "budget-breach");
  });

  it("T2(b): after a single reserve the ledger reflects exactly one reservation", async () => {
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 20, conservativeCost: 5 },
      storage,
      (e) => escalations.push(e),
    );

    const r = await reconciler.reserve("task-t2b", 5);
    assert.equal(r.status, "proceed", "single reserve must proceed");

    // A second sequential reserve of 16 exceeds ceiling (5 + 16 = 21 > 20)
    const r2 = await reconciler.reserve("task-t2b", 16);
    assert.equal(r2.status, "halted", "second reserve exceeding ceiling must be halted");
    assert.equal(escalations.length, 1);
  });
});

// ---------------------------------------------------------------------------
// T3 — concurrent reserve + reconcile must not corrupt the ledger
//
// Race scenario (single-threaded async interleaving with Promise.all):
//  Setup: ceiling=12; reserve(8) proceeds → cumulative=8; 4 units free.
//  Concurrent: Promise.all([reconcile(actual=3, final), reserve(2)]).
//
//  Microtask interleaving (Node.js single-threaded):
//   a. reconcile calls storage.load() → stmtSelect.get runs synchronously,
//      captures stale ledger [reservation(8)] → Promise.resolve → suspends.
//   b. reserve(2) calls storage.atomicUpdate() → runs BEGIN IMMEDIATE;
//      reads [reservation(8)]; cumulative=8; 8+2=10 ≤ 12 → PROCEEDS;
//      writes [reservation(8), reservation(2)]; COMMIT → suspends.
//   c. reconcile microtask resumes with STALE entries [reservation(8)];
//      computes [reservation(8), reconcile(3)]; calls storage.save()
//      → atomicUpdate → BEGIN IMMEDIATE; OVERWRITES DB with
//      [reservation(8), reconcile(3)] — ERASES reservation(2)!
//   d. reserve(2) microtask resumes; returns box.result = { status:"proceed" }.
//
//  After the concurrent pair: reserve(2).status === "proceed" but its
//  reservation entry has been erased from the ledger.
//  Ledger = [reservation(8), reconcile(3)] → cumulative = 3.
//
//  Consequence: a third sequential reserve(8) reads cumulative=3,
//  computes 3+8=11 ≤ 12 → PROCEEDS — even though reservation(2) was
//  already "proceeded" making the real total 3+2+8=13 > 12.
//
//  Fix: reconcile must use atomicUpdate so the read-modify-write is
//  atomic and reservation(2) cannot be silently erased.
// ---------------------------------------------------------------------------

describe("src/ring1/sqlite-reconcile-storage.ts — T3 concurrent reconcile atomicity", () => {
  let tmpDir!: string;
  let storage!: AtomicReconcileStorage;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sqlite-reconcile-t3-"));
    storage = makeSqliteReconcileStorage(join(tmpDir, "budget-t3.db"));
  });

  after(async () => {
    storage.close();
    await rm(tmpDir, { recursive: true });
  });

  it("T3(a): concurrent reconcile + reserve(2) must not erase the proceeded reservation from the ledger", async () => {
    const escalations: ReconcileEscalationEvent[] = [];

    // ceiling=12; initial reserve(8) leaves 4 units free.
    // reserve(2) fits (8+2=10 ≤ 12) and must proceed concurrently with reconcile.
    const reconciler = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 8 },
      storage,
      (e) => escalations.push(e),
    );

    // Step 1: reserve(8) → proceeds; cumulative = 8.
    const r1 = await reconciler.reserve("task-t3a", 8);
    assert.equal(r1.status, "proceed", "first reservation must proceed");
    const reservationId = (r1 as { status: "proceed"; reservationId: string }).reservationId;

    // Step 2: concurrent reconcile(actual=3, final) + reserve(2).
    // reconcile frees 5 units (actual=3 vs conservative=8).
    // reserve(2) sees cumulative=8, 8+2=10 ≤ 12 → atomically proceeds and writes
    // reservation(2) to the DB.
    // With non-atomic reconcile, reconcile's stale-load save then erases reservation(2).
    const [reconcileResult, r2] = await Promise.all([
      reconciler.reconcile("task-t3a", { reservationId, actualCost: 3, final: true }),
      reconciler.reserve("task-t3a", 2),
    ]);

    assert.equal(reconcileResult.status, "ok", "reconcile must succeed");

    // reserve(2) MUST proceed — at the time of its atomicUpdate, cumulative=8,
    // 8+2=10 ≤ 12.  If it is halted, the fix changed the interleaving ordering
    // in a way that defeats this particular race test; the test would need to
    // be updated.  Fail fast if the scenario no longer applies.
    assert.equal(
      r2.status,
      "proceed",
      "reserve(2) must proceed — 8+2=10 ≤ ceiling 12; if this fails the race scenario changed",
    );

    // Step 3: a follow-on reserve(8).
    // If reservation(2) is durable (atomicUpdate used for reconcile):
    //   cumulative = 3 (reconciled) + 2 (reservation) = 5; 5+8=13 > 12 → HALTED.
    // If reservation(2) was erased (non-atomic reconcile save):
    //   cumulative = 3 only; 3+8=11 ≤ 12 → proceeds — ceiling VIOLATED.
    const r3 = await reconciler.reserve("task-t3a", 8);
    assert.equal(
      r3.status,
      "halted",
      "reservation(2) must remain in the ledger after concurrent reconcile; follow-on reserve(8) must be halted (3+2+8=13 > 12) — non-atomic reconcile erases the proceeded reservation and incorrectly allows this to proceed",
    );
  });
});
