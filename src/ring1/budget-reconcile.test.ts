import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeBudgetReconciler } from "./budget-reconcile.ts";
import type {
  ReconcileStorage,
  ReconcileEscalationEvent,
  CostReport,
} from "./budget-reconcile.ts";

// ---------------------------------------------------------------------------
// Fake in-memory storage for reconcile ledger (shared across instances to
// simulate respawn — both reservation and reconcile entries persist)
// ---------------------------------------------------------------------------

class FakeReconcileStorage implements ReconcileStorage {
  // Map<taskId, serialized ledger entries>
  private readonly entries = new Map<string, string>();

  async load(taskId: string): Promise<string | null> {
    return this.entries.get(taskId) ?? null;
  }

  async save(taskId: string, serialized: string): Promise<void> {
    this.entries.set(taskId, serialized);
  }
}

// ---------------------------------------------------------------------------
// Story 002 Task T1 — Reconcile entries adjust the cumulative total
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Story 002 Task T2 — Respawn survival + fail-closed preserved
// (Tests added below the T1 suite)
// ---------------------------------------------------------------------------

describe("src/ring1/budget-reconcile.ts — T1 reconcile entries", () => {
  // -------------------------------------------------------------------------
  // T1(a): reserve 10, final actual 4 ⇒ difference freed; next 7 under
  //        ceiling 12 proceeds (cumulative = 4 + 7 = 11 ≤ 12)
  // -------------------------------------------------------------------------
  it("T1(a): final actual lower than reservation frees the difference; next reservation under ceiling proceeds", async () => {
    const storage = new FakeReconcileStorage();
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 10 },
      storage,
      (e) => escalations.push(e),
    );

    // Reserve 10 for call-1 — proceeds (cumulative = 10 ≤ 12)
    const reserveResult = await reconciler.reserve("task-t1a", 10);
    assert.equal(reserveResult.status, "proceed", "first reservation must proceed");
    const reservationId = reserveResult.reservationId;
    assert.match(reservationId, /^rsv_[0-9A-HJKMNP-TV-Z]{26}$/, "reservationId must match ^rsv_<26-char Crockford base32>$");

    // Final actual cost = 4 (lower than conservative reservation 10)
    const reconcileResult = await reconciler.reconcile("task-t1a", {
      reservationId,
      actualCost: 4,
      final: true,
    });
    assert.equal(reconcileResult.status, "ok", "reconcile of final cost must succeed");
    assert.equal(escalations.length, 0, "no escalation for final lower cost");

    // Next reservation of 7: cumulative after reconcile = 4; 4 + 7 = 11 ≤ 12 → proceeds
    const nextReserveResult = await reconciler.reserve("task-t1a", 7);
    assert.equal(nextReserveResult.status, "proceed", "next reservation under ceiling must proceed after reconcile frees difference");
    assert.equal(escalations.length, 0, "still no escalation");
  });

  // -------------------------------------------------------------------------
  // T1(b): provisional actual 4 ⇒ conservative 10 charge stands; next
  //        reservation immediately after still sees 10 as the charged amount
  // -------------------------------------------------------------------------
  it("T1(b): provisional actual does not free the conservative reservation", async () => {
    const storage = new FakeReconcileStorage();
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 10 },
      storage,
      (e) => escalations.push(e),
    );

    // Reserve 10 for call-1 — proceeds (cumulative = 10)
    const reserveResult = await reconciler.reserve("task-t1b", 10);
    assert.equal(reserveResult.status, "proceed");
    const reservationId = reserveResult.reservationId;

    // Provisional actual = 4 (not final) — conservative 10 must stand
    await reconciler.reconcile("task-t1b", {
      reservationId,
      actualCost: 4,
      final: false, // provisional — must NOT free the difference
    });

    // Next reservation of 3: cumulative still 10 (provisional kept);
    // 10 + 3 = 13 > ceiling 12 → halted (if difference had been freed:
    // 4 + 3 = 7 ≤ 12 → would have proceeded — proves conservative charge stands)
    const nextReserveResult = await reconciler.reserve("task-t1b", 3);
    assert.equal(nextReserveResult.status, "halted", "provisional report must not free the conservative charge");
    assert.equal(escalations.length, 1, "halted reserve produces an escalation");
    const ev = escalations[0] as ReconcileEscalationEvent;
    assert.equal(ev.tag, "budget-breach");
  });

  // -------------------------------------------------------------------------
  // T1(c): reserve 10 under ceiling 12, final actual 15 ⇒ immediate halt
  //        + escalation at reconcile time (not deferred to next reservation)
  // -------------------------------------------------------------------------
  it("T1(c): final actual exceeding ceiling triggers immediate halt escalation at reconcile time", async () => {
    const storage = new FakeReconcileStorage();
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 10 },
      storage,
      (e) => escalations.push(e),
    );

    // Reserve 10 — proceeds (cumulative = 10 ≤ 12)
    const reserveResult = await reconciler.reserve("task-t1c", 10);
    assert.equal(reserveResult.status, "proceed");
    const reservationId = reserveResult.reservationId;

    // No escalation yet
    assert.equal(escalations.length, 0);

    // Final actual 15 > ceiling 12 → immediate halt + escalation at reconcile time
    const reconcileResult = await reconciler.reconcile("task-t1c", {
      reservationId,
      actualCost: 15,
      final: true,
    });

    // Must report halted immediately (not "ok") and escalation fired now
    assert.equal(reconcileResult.status, "halted", "reconcile must immediately halt when actual exceeds ceiling");
    assert.equal(escalations.length, 1, "escalation must fire at reconcile time, not at next reservation");
    const ev = escalations[0] as ReconcileEscalationEvent;
    assert.equal(ev.tag, "budget-breach");
  });

  // -------------------------------------------------------------------------
  // T1(d): no reported cost (null/undefined actualCost) ⇒ conservative charge
  //        stands — no unbounded spend
  // -------------------------------------------------------------------------
  it("T1(d): a report with no cost keeps the conservative charge", async () => {
    const storage = new FakeReconcileStorage();
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 10 },
      storage,
      (e) => escalations.push(e),
    );

    // Reserve 10 — proceeds (cumulative = 10)
    const reserveResult = await reconciler.reserve("task-t1d", 10);
    assert.equal(reserveResult.status, "proceed");
    const reservationId = reserveResult.reservationId;

    // Report with no cost (final but actualCost = null)
    await reconciler.reconcile("task-t1d", {
      reservationId,
      actualCost: null,
      final: true,
    });

    // Next reservation of 3: cumulative still 10 (no cost reported, conservative stands)
    // 10 + 3 = 13 > ceiling 12 → halted
    const nextReserveResult = await reconciler.reserve("task-t1d", 3);
    assert.equal(nextReserveResult.status, "halted", "no-cost report must keep conservative charge");
  });

  // -------------------------------------------------------------------------
  // T1(e): duplicate report for same reservation adjusts once
  // -------------------------------------------------------------------------
  it("T1(e): duplicate final report for the same reservation adjusts only once", async () => {
    const storage = new FakeReconcileStorage();
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 20, conservativeCost: 10 },
      storage,
      (e) => escalations.push(e),
    );

    // Reserve 10 — cumulative = 10
    const reserveResult = await reconciler.reserve("task-t1e", 10);
    assert.equal(reserveResult.status, "proceed");
    const reservationId = reserveResult.reservationId;

    // First reconcile: final actual = 4 — cumulative drops to 4
    await reconciler.reconcile("task-t1e", { reservationId, actualCost: 4, final: true });

    // Duplicate reconcile with same reservationId — must be idempotent
    await reconciler.reconcile("task-t1e", { reservationId, actualCost: 4, final: true });

    // If the duplicate double-adjusted, cumulative would be 4 - 6 = -2 (or some variant);
    // correct idempotent behavior: cumulative still 4.
    // Verify: next reservation of 15 under ceiling 20: 4 + 15 = 19 ≤ 20 → proceeds
    const nextResult = await reconciler.reserve("task-t1e", 15);
    assert.equal(nextResult.status, "proceed", "duplicate reconcile must not double-adjust the ledger");
    assert.equal(escalations.length, 0);
  });

  // -------------------------------------------------------------------------
  // T1(f): unknown reservation reference ⇒ typed error + escalation
  // -------------------------------------------------------------------------
  it("T1(f): report referencing an unknown reservation id is a typed error and escalation", async () => {
    const storage = new FakeReconcileStorage();
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 20, conservativeCost: 10 },
      storage,
      (e) => escalations.push(e),
    );

    // No reservation made — reference a fabricated id
    const report: CostReport = {
      reservationId: "nonexistent-reservation-id",
      actualCost: 5,
      final: true,
    };

    await assert.rejects(
      () => reconciler.reconcile("task-t1f", report),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must throw an Error");
        return true;
      },
      "unknown reservation reference must reject",
    );

    // Escalation must also fire
    assert.equal(escalations.length, 1, "unknown reservation must trigger escalation");
    const ev = escalations[0] as ReconcileEscalationEvent;
    assert.equal(ev.tag, "unknown-reservation");
  });
});

// ---------------------------------------------------------------------------
// Story 002 Task T2 — Respawn survival + fail-closed preserved
// ---------------------------------------------------------------------------

describe("src/ring1/budget-reconcile.ts — T2 respawn survival and fail-closed", () => {
  // -------------------------------------------------------------------------
  // T2(a): reservations + reconciles split across a respawn breach at the
  //        same cumulative point.
  //
  //  - Reconciler instance A: reserve 8 (ceiling 12) → proceeds; reconcile
  //    final actual 7.
  //  - Simulate respawn: new reconciler instance B shares the same storage.
  //  - Instance B: reserve 6 → cumulative = 7 + 6 = 13 > 12 → halted.
  //    Proves durable reconcile entries survive the respawn and the breach
  //    fires at the correct cumulative point (not reset to 0 on respawn).
  // -------------------------------------------------------------------------
  it("T2(a): reconcile entries survive respawn and breach fires at the same cumulative point", async () => {
    const storage = new FakeReconcileStorage();
    const escalationsA: ReconcileEscalationEvent[] = [];
    const escalationsB: ReconcileEscalationEvent[] = [];

    // Instance A — pre-respawn
    const reconcilerA = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 8 },
      storage,
      (e) => escalationsA.push(e),
    );

    const reserveResultA = await reconcilerA.reserve("task-t2a", 8);
    assert.equal(reserveResultA.status, "proceed", "pre-respawn reservation must proceed");
    const reservationIdA = reserveResultA.reservationId;

    // Reconcile final actual 7 — frees 1 unit
    const reconcileResultA = await reconcilerA.reconcile("task-t2a", {
      reservationId: reservationIdA,
      actualCost: 7,
      final: true,
    });
    assert.equal(reconcileResultA.status, "ok", "reconcile must succeed");
    assert.equal(escalationsA.length, 0, "no breach yet");

    // Instance B — simulated respawn: same storage, fresh reconciler
    const reconcilerB = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 8 },
      storage,
      (e) => escalationsB.push(e),
    );

    // Reserve 6: cumulative from durable ledger = 7 (reconciled); 7 + 6 = 13 > 12 → halted
    const reserveResultB = await reconcilerB.reserve("task-t2a", 6);
    assert.equal(
      reserveResultB.status,
      "halted",
      "respawned reconciler must breach at the same cumulative point (durable reconcile entries must be loaded)",
    );
    assert.equal(escalationsB.length, 1, "breach escalation must fire after respawn");
    const evB = escalationsB[0] as ReconcileEscalationEvent;
    assert.equal(evB.tag, "budget-breach");
  });

  // -------------------------------------------------------------------------
  // T2(b): a halted task stays halted when a late low actual arrives.
  //
  //  - Reserve 10 under ceiling 12; reconcile final actual 15 → halted
  //    immediately (from T1(c) semantics).
  //  - Then issue another reconcile with a lower actual 5 for the same
  //    reservation (should be rejected as a duplicate / already-reconciled).
  //  - The task must NOT un-halt: the next reserve call still returns "halted".
  //
  //  Verifies that a breach once known cannot be reversed by a late lower
  //  cost signal — fail-closed semantics are preserved.
  // -------------------------------------------------------------------------
  it("T2(b): a halted task stays halted when a late low actual arrives", async () => {
    const storage = new FakeReconcileStorage();
    const escalations: ReconcileEscalationEvent[] = [];

    const reconciler = makeBudgetReconciler(
      { ceiling: 12, conservativeCost: 10 },
      storage,
      (e) => escalations.push(e),
    );

    // Reserve 10 — proceeds (cumulative = 10 ≤ 12)
    const reserveResult = await reconciler.reserve("task-t2b", 10);
    assert.equal(reserveResult.status, "proceed");
    const reservationId = reserveResult.reservationId;

    // Final actual 15 → immediate halt + escalation
    const reconcileResult = await reconciler.reconcile("task-t2b", {
      reservationId,
      actualCost: 15,
      final: true,
    });
    assert.equal(reconcileResult.status, "halted", "first reconcile must halt immediately");
    assert.equal(escalations.length, 1);

    // Late lower actual (5) — same reservationId, already reconciled (idempotent)
    // Must not un-halt or reduce the cumulative
    const lateReconcile = await reconciler.reconcile("task-t2b", {
      reservationId,
      actualCost: 5,
      final: true,
    });
    // The duplicate should be idempotent — no second breach escalation
    assert.equal(lateReconcile.status, "ok", "duplicate reconcile is idempotent");
    // Escalation count stays at 1 (no double escalation for the duplicate)
    assert.equal(escalations.length, 1, "no additional escalation for duplicate late reconcile");

    // Any further reservation must be halted: cumulative is still 15 (from first reconcile)
    // The late lower signal must not have un-halted the task
    const nextReserve = await reconciler.reserve("task-t2b", 1);
    assert.equal(
      nextReserve.status,
      "halted",
      "task must stay halted after late lower actual — fail-closed preserved",
    );
  });
});
