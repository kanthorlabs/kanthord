/**
 * BudgetVM — UI-side view-model for the per-task budget ledger (Story 006 T1).
 *
 * toBudgetVM maps GetBudgetResponse → BudgetVM.
 * toBudgetsVM maps ListBudgetsResponse → BudgetVM[] (list page adapter).
 *
 * Override mapping:
 *   proto.override undefined → { present:false, amount:0, reason:"", actor:"" }
 *   proto.override defined   → passthrough of all four fields
 */
import type { GetBudgetResponse, ListBudgetsResponse } from "@/gen/kanthord/v1/daemon_pb";

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

export function toBudgetVM(proto: GetBudgetResponse): BudgetVM {
  return {
    taskId: proto.taskId,
    spent: proto.spent,
    ceiling: proto.ceiling,
    breakerState: proto.breakerState,
    override: proto.override
      ? {
          present: proto.override.present,
          amount: proto.override.amount,
          reason: proto.override.reason,
          actor: proto.override.actor,
        }
      : { present: false, amount: 0, reason: "", actor: "" },
  };
}

export function toBudgetsVM(response: ListBudgetsResponse): BudgetVM[] {
  return response.budgets.map(toBudgetVM);
}
