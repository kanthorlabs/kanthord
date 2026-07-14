import { createHash } from "node:crypto";
import type { Store } from "../foundations/sqlite-store.ts";

export interface BudgetReservationLogger {
  info(record: Record<string, unknown>): void;
}

export interface ReserveBudgetReservationOpts {
  store: Store;
  taskId: string;
  attemptedAt: number;
  conservativeCost: number;
  ceiling: number;
  logger?: BudgetReservationLogger;
}

export type BudgetReservationResult = {
  outcome: "proceed" | "halted";
  reservedTotal: number;
};

function escalationId(sourceId: string): string {
  const digest = createHash("sha256").update(sourceId).digest("hex").slice(0, 32);
  return `esc:${digest}`;
}

function persistEscalation(
  store: Store,
  taskId: string,
  attemptedAt: number,
  reason: "budget-breach" | "budget-ledger-failure",
): void {
  const sourceId = `${taskId}:${reason}`;
  store.run(
    `INSERT OR IGNORE INTO inbox_items (id, kind, status, created_at, evidence)
     VALUES (?, 'escalation', 'open', ?, ?)`,
    escalationId(sourceId),
    attemptedAt,
    JSON.stringify({
      task_id: taskId,
      reason,
      payload_summary: reason === "budget-breach"
        ? `task ${taskId} budget ceiling breached`
        : `task ${taskId} budget reservation storage failed`,
    }),
  );
}

function parkTask(store: Store, taskId: string): void {
  store.run("UPDATE scheduler_task SET status = 'parked' WHERE node_id = ?", taskId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Atomically decides a model-call reservation and records durable evidence.
 *
 * A halted decision writes its deterministic escalation and parks the scheduler
 * task in the same SQLite transaction. On transaction failure the original error
 * is preserved after a separate best-effort durable fail-closed lifecycle write.
 */
export function reserveBudgetReservation(
  opts: ReserveBudgetReservationOpts,
): BudgetReservationResult {
  const { store, taskId, attemptedAt, conservativeCost, ceiling, logger } = opts;
  let transactionOpen = false;

  try {
    store.run("BEGIN IMMEDIATE");
    transactionOpen = true;
    const reservation = store.get<{ ledger: string }>(
      `INSERT INTO budget_ledger (task_id, ledger)
       SELECT ?, ?
       WHERE ? <= ?
       ON CONFLICT(task_id) DO UPDATE SET ledger = CAST(CAST(ledger AS REAL) + ? AS TEXT)
       WHERE CAST(ledger AS REAL) + ? <= ?
       RETURNING ledger`,
      `spend:${taskId}`,
      String(conservativeCost),
      conservativeCost,
      ceiling,
      conservativeCost,
      conservativeCost,
      ceiling,
    );
    const outcome = reservation === undefined ? "halted" : "proceed";
    const reservedTotal = reservation === undefined
      ? Number(store.get<{ ledger: string }>(
        "SELECT ledger FROM budget_ledger WHERE task_id = ?",
        `spend:${taskId}`,
      )?.ledger ?? 0)
      : Number(reservation.ledger);

    store.run(
      `INSERT INTO budget_reservation_attempt
         (task_id, attempted_at, conservative_cost, outcome, reserved_total)
       VALUES (?, ?, ?, ?, ?)`,
      taskId,
      attemptedAt,
      conservativeCost,
      outcome,
      reservedTotal,
    );
    if (outcome === "halted") {
      persistEscalation(store, taskId, attemptedAt, "budget-breach");
      parkTask(store, taskId);
    }
    store.run("COMMIT");
    transactionOpen = false;
    return { outcome, reservedTotal };
  } catch (rootError: unknown) {
    if (transactionOpen) {
      try {
        store.run("ROLLBACK");
      } catch (rollbackError: unknown) {
        logger?.info({
          event: "budget-reservation-rollback-failed",
          task_id: taskId,
          error: errorMessage(rollbackError),
        });
      }
    }
    logger?.info({
      event: "budget-reservation-transaction-failed",
      task_id: taskId,
      error: errorMessage(rootError),
    });
    try {
      persistEscalation(store, taskId, attemptedAt, "budget-ledger-failure");
      parkTask(store, taskId);
    } catch (failClosedError: unknown) {
      logger?.info({
        event: "budget-ledger-failure-persistence-failed",
        task_id: taskId,
        error: errorMessage(failClosedError),
      });
    }
    throw rootError;
  }
}
