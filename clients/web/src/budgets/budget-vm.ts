/**
 * BudgetVM — UI-side view-model for the per-task budget ledger (Story 006 T1).
 *
 * N4 adapter note (api-needs-for-026.md §N4): only GetBudget(task_id) exists
 * on the current proto; the Budgets surface accepts a pre-resolved BudgetVM
 * list from a thin page-layer adapter that issues per-task GetBudget calls
 * aggregated into this shape. When ListBudgets lands in Epic 026, the adapter
 * is updated — the component accepts the same view-model type.
 */
export interface BudgetVM {
  taskId: string;
  spent: number;
  ceiling: number;
  breakerState: string;
  override: {
    present: boolean;
    amount: number;
    reason: string;
    actor: string;
  };
}
