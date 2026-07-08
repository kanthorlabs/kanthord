/**
 * Ring-1 budget reconciler.
 *
 * `makeBudgetReconciler` reserves conservative spend before each model call
 * and reconciles with actual cost when a final cost report arrives.
 *
 * Semantics:
 * - Reserve: atomically adds a conservative charge; halts if ceiling is breached.
 * - Reconcile: replaces the conservative charge with actual cost ONLY when
 *   `final:true` and `actualCost !== null`; provisional or no-cost reports keep
 *   the conservative charge (no-spend race on provisional signals, PRD §4).
 * - Fail-closed: unknown reservation → typed error + escalation; ceiling breach
 *   at reconcile time → immediate halt, not deferred.
 * - Idempotent: duplicate final report for same reservationId adjusts once.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CostReport {
  reservationId: string;
  actualCost: number | null;
  final: boolean;
}

export interface ReconcileEscalationEvent {
  tag: "budget-breach" | "unknown-reservation";
  [key: string]: unknown;
}

export interface ReconcileStorage {
  load(taskId: string): Promise<string | null>;
  save(taskId: string, serialized: string): Promise<void>;
}

export interface BudgetReconcilerOptions {
  ceiling: number;
  conservativeCost: number;
}

export type ReserveResult =
  | { status: "proceed"; reservationId: string }
  | { status: "halted" };

export interface ReconcileResult {
  status: "ok" | "halted";
}

export interface BudgetReconciler {
  reserve(taskId: string, cost: number): Promise<ReserveResult>;
  reconcile(taskId: string, report: CostReport): Promise<ReconcileResult>;
}

// ---------------------------------------------------------------------------
// Internal ledger entry types (serialized via JSON)
// ---------------------------------------------------------------------------

interface ReservationEntry {
  kind: "reservation";
  reservationId: string;
  conservativeCharge: number;
}

interface ReconcileEntry {
  kind: "reconcile";
  reservationId: string;
  finalActual: number;
}

type LedgerEntry = ReservationEntry | ReconcileEntry;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadLedger(serialized: string | null): LedgerEntry[] {
  if (serialized === null) return [];
  return JSON.parse(serialized) as LedgerEntry[];
}

function saveLedger(entries: LedgerEntry[]): string {
  return JSON.stringify(entries);
}

/**
 * Compute the cumulative effective charge from the ledger.
 * For each reservation: its charge is the finalActual if a `reconcile` entry
 * exists for it, otherwise the conservativeCharge.
 */
function computeCumulative(entries: LedgerEntry[]): number {
  // Build a map from reservationId → finalActual for reconciled entries
  const reconciled = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === "reconcile") {
      reconciled.set(entry.reservationId, entry.finalActual);
    }
  }

  let total = 0;
  for (const entry of entries) {
    if (entry.kind === "reservation") {
      const finalActual = reconciled.get(entry.reservationId);
      total += finalActual !== undefined ? finalActual : entry.conservativeCharge;
    }
  }
  return total;
}

/**
 * Check if a reconcile entry already exists for this reservationId (idempotency).
 */
function hasReconcileEntry(entries: LedgerEntry[], reservationId: string): boolean {
  for (const entry of entries) {
    if (entry.kind === "reconcile" && entry.reservationId === reservationId) {
      return true;
    }
  }
  return false;
}

/**
 * Find the reservation entry for the given reservationId.
 */
function findReservation(
  entries: LedgerEntry[],
  reservationId: string,
): ReservationEntry | undefined {
  for (const entry of entries) {
    if (entry.kind === "reservation" && entry.reservationId === reservationId) {
      return entry;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Narrow guard: does the injected storage support atomic read-modify-write? */
interface AtomicStorage {
  atomicUpdate(
    taskId: string,
    updater: (current: string | null) => string,
  ): Promise<void>;
}

function isAtomicStorage(s: ReconcileStorage): s is ReconcileStorage & AtomicStorage {
  return typeof (s as Partial<AtomicStorage>).atomicUpdate === "function";
}

export function makeBudgetReconciler(
  opts: BudgetReconcilerOptions,
  storage: ReconcileStorage,
  onEscalate: (e: ReconcileEscalationEvent) => void,
): BudgetReconciler {
  return {
    async reserve(taskId: string, cost: number): Promise<ReserveResult> {
      // Use a mutable box so that both the atomic and non-atomic paths can
      // capture the computed result from inside `performReserve`.
      const box: { result: ReserveResult } = { result: { status: "halted" } };

      const performReserve = (current: string | null): string => {
        const entries = loadLedger(current);
        const cumulative = computeCumulative(entries);
        const projected = cumulative + cost;

        if (projected > opts.ceiling) {
          onEscalate({ tag: "budget-breach" });
          box.result = { status: "halted" };
          // Return the ledger unchanged (no new entry).
          return current ?? saveLedger([]);
        }

        const reservationId = randomUUID();
        const newEntry: ReservationEntry = {
          kind: "reservation",
          reservationId,
          conservativeCharge: cost,
        };
        entries.push(newEntry);
        box.result = { status: "proceed", reservationId };
        return saveLedger(entries);
      };

      if (isAtomicStorage(storage)) {
        await storage.atomicUpdate(taskId, performReserve);
      } else {
        const serialized = await storage.load(taskId);
        const next = performReserve(serialized);
        if (box.result.status === "proceed") {
          await storage.save(taskId, next);
        }
      }

      return box.result;
    },

    async reconcile(taskId: string, report: CostReport): Promise<ReconcileResult> {
      type ReconcileBox =
        | { kind: "result"; result: ReconcileResult }
        | { kind: "throw"; error: Error };

      const box: { value: ReconcileBox } = {
        value: { kind: "result", result: { status: "ok" } },
      };

      const performReconcile = (current: string | null): string => {
        const entries = loadLedger(current);

        // Unknown reservation → typed error + escalation
        const reservation = findReservation(entries, report.reservationId);
        if (reservation === undefined) {
          onEscalate({ tag: "unknown-reservation", reservationId: report.reservationId });
          box.value = {
            kind: "throw",
            error: new Error(`Unknown reservation id: ${report.reservationId}`),
          };
          // Return ledger unchanged (we will throw after the updater returns)
          return current ?? saveLedger([]);
        }

        // Only replace conservative charge when final=true AND actualCost != null
        if (!report.final || report.actualCost === null) {
          // Provisional or no-cost: conservative charge stands, nothing to persist
          box.value = { kind: "result", result: { status: "ok" } };
          return current ?? saveLedger(entries);
        }

        // Idempotent: if already reconciled, skip
        if (hasReconcileEntry(entries, report.reservationId)) {
          box.value = { kind: "result", result: { status: "ok" } };
          return current ?? saveLedger(entries);
        }

        // Compute what the cumulative would be after replacing the conservative
        // charge with the actual cost for this reservation.
        const reconcileEntry: ReconcileEntry = {
          kind: "reconcile",
          reservationId: report.reservationId,
          finalActual: report.actualCost,
        };
        const updatedEntries = [...entries, reconcileEntry];
        const newCumulative = computeCumulative(updatedEntries);

        if (newCumulative > opts.ceiling) {
          // Persist the reconcile entry first so the breach is durably recorded,
          // then escalate after the atomic write completes.
          box.value = { kind: "result", result: { status: "halted" } };
          return saveLedger(updatedEntries);
        }

        box.value = { kind: "result", result: { status: "ok" } };
        return saveLedger(updatedEntries);
      };

      if (isAtomicStorage(storage)) {
        await storage.atomicUpdate(taskId, performReconcile);
      } else {
        const serialized = await storage.load(taskId);
        const next = performReconcile(serialized);
        const bv = box.value;
        // Only save when the reconcile actually wrote new entries
        if (bv.kind === "result" && bv.result.status !== "ok") {
          await storage.save(taskId, next);
        } else if (bv.kind === "result" && bv.result.status === "ok") {
          // Check whether performReconcile produced a new ledger (e.g., final ok)
          // by comparing serialized vs next. Always save when there is a new entry.
          if (next !== (serialized ?? saveLedger([]))) {
            await storage.save(taskId, next);
          }
        }
      }

      const bv = box.value;
      if (bv.kind === "throw") {
        throw bv.error;
      }

      // Fire escalation after the atomic write for breach cases
      if (bv.result.status === "halted") {
        onEscalate({ tag: "budget-breach", reservationId: report.reservationId });
      }

      return bv.result;
    },
  };
}
