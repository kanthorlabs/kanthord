/**
 * Ring-1 fail-closed budget circuit-breaker.
 *
 * `makeBudgetBreaker` returns an object with a `reserve(taskId, cost)` method
 * that reserves spend against a durable per-task total before each model call.
 * A reservation that would breach the hard ceiling is atomically halted and
 * escalated without committing the spend.  Conservative fallback applies when
 * exact cost is unknown.  Finer per-task budgets are logged only (not enforced).
 * No model parameter exists on the public surface — model-independence by
 * construction.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BudgetStorage {
  load(taskId: string): Promise<number>;
  save(taskId: string, spent: number): Promise<void>;
}

export interface BudgetEscalationEvent {
  tag: "budget-breach";
  [key: string]: unknown;
}

export interface BudgetLogEntry {
  kind: "finer-budget-exceeded";
  [key: string]: unknown;
}

export interface BudgetOptions {
  ceiling: number;
  conservativeCost: number;
  finerBudgets?: Array<{ name: string; ceiling: number }>;
}

// ---------------------------------------------------------------------------
// Breaker factory
// ---------------------------------------------------------------------------

/**
 * Creates a budget circuit-breaker that enforces the per-task hard ceiling
 * fail-closed: spend is reserved before a call proceeds, and a breach halts
 * without committing the breaching cost.
 */
export function makeBudgetBreaker(
  options: BudgetOptions,
  storage: BudgetStorage,
  onEscalate: (e: BudgetEscalationEvent) => void,
  onLog: (l: BudgetLogEntry) => void,
): { reserve(taskId: string, cost: number | null): Promise<"proceed" | "halted"> } {
  return {
    async reserve(
      taskId: string,
      cost: number | null,
    ): Promise<"proceed" | "halted"> {
      const effectiveCost = cost ?? options.conservativeCost;
      const current = await storage.load(taskId);
      const projected = current + effectiveCost;

      if (projected > options.ceiling) {
        onEscalate({ tag: "budget-breach" });
        return "halted";
      }

      await storage.save(taskId, projected);

      // Finer budgets: log-only, never halt (PRD §9)
      const finerBudgets = options.finerBudgets;
      if (finerBudgets !== undefined) {
        for (const fb of finerBudgets) {
          if (projected > fb.ceiling) {
            onLog({ kind: "finer-budget-exceeded", name: fb.name });
          }
        }
      }

      return "proceed";
    },
  };
}
