/**
 * Budgets — per-task budget ledger + override flow (Story 006 T1).
 *
 * Accepts a pre-resolved BudgetVM list (N4 adapter, api-needs-for-026.md §N4).
 * Renders a ledger table with BreakerStateBadge per row, recorded override
 * details when present, and per-row override trigger via ConfirmActionDialog
 * with a required reason (DESIGN §7).
 *
 * Semantic tokens only (DESIGN §3). Locators from registry only (DESIGN §8).
 */
import { useState } from "react";
import { ConnectError } from "@connectrpc/connect";
import { BreakerStateBadge } from "@/components/status/BreakerStateBadge";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { ListPage } from "@/components/templates/ListPage";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { locators } from "@/locators";
import type { BudgetVM } from "./budget-vm";

interface BudgetsProps {
  budgets: BudgetVM[];
  onOverrideSuccess?: () => void | Promise<void>;
  fetchedAt?: Date;
  onRefresh?: () => Promise<void>;
  refreshError?: { message: string };
}

type OverrideResult =
  | { kind: "idle" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function Budgets({ budgets, onOverrideSuccess, fetchedAt, onRefresh, refreshError }: BudgetsProps) {
  const client = useDaemonClient();
  const [overrideResult, setOverrideResult] = useState<OverrideResult>({
    kind: "idle",
  });

  async function handleOverride(taskId: string, reason: string) {
    try {
      await client.overrideBudget({ taskId, reason });
      await onOverrideSuccess?.();
      setOverrideResult({ kind: "success" });
    } catch (err: unknown) {
      // B6: surface ALL error types — ConnectError shows typed message, any
      // other Error shows its message; nothing is swallowed.
      const message =
        err instanceof ConnectError
          ? err.message
          : err instanceof Error
            ? err.message
            : "An error occurred";
      setOverrideResult({ kind: "error", message });
    }
  }

  return (
    <ListPage title="Budgets" fetchedAt={fetchedAt} onRefresh={onRefresh} refreshError={refreshError}>
      {budgets.length === 0 ? (
        <Empty data-testid={locators.budgets.ledger.empty}>
          No budgets found.
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
      {overrideResult.kind === "success" && (
        <div
          data-testid={locators.budgets.override.successState}
          className="text-sm text-foreground"
        >
          Override recorded successfully.
        </div>
      )}

      {overrideResult.kind === "error" && (
        <div
          data-testid={locators.budgets.override.apiError}
          className="text-sm text-destructive"
        >
          {overrideResult.message}
        </div>
      )}

      <div className="overflow-x-auto">
        <table
          data-testid={locators.budgets.ledger.table}
          className="w-full text-sm"
        >
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                Task
              </th>
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                Spent
              </th>
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                Ceiling
              </th>
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                Breaker
              </th>
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                Override
              </th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
          <tbody>
            {budgets.map((budget) => (
              <tr
                key={budget.taskId}
                data-testid={locators.budgets.ledger.row}
                className="border-b border-border"
              >
                <td className="py-2 px-3 font-mono text-xs">{budget.taskId}</td>
                <td className="py-2 px-3">{budget.spent}</td>
                <td className="py-2 px-3">{budget.ceiling}</td>
                <td className="py-2 px-3">
                  <BreakerStateBadge state={budget.breakerState} />
                </td>
                <td className="py-2 px-3">
                  {budget.override.present && (
                    <div className="flex flex-col gap-0.5 text-xs">
                      <span>
                        <span className="text-muted-foreground">By: </span>
                        {budget.override.actor}
                      </span>
                      <span>
                        <span className="text-muted-foreground">Amount: </span>
                        {budget.override.amount}
                      </span>
                      <span>
                        <span className="text-muted-foreground">Reason: </span>
                        {budget.override.reason}
                      </span>
                    </div>
                  )}
                </td>
                <td className="py-2 px-3">
                  <ConfirmActionDialog
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={locators.budgets.override.trigger(
                          budget.taskId
                        )}
                      >
                        Override
                      </Button>
                    }
                    title="Override Budget"
                    description="Enter a reason for this budget override. The override is recorded with your identity."
                    requiresInput={{ label: "Reason" }}
                    onConfirm={(reason) =>
                      void handleOverride(budget.taskId, reason)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </div>
      )}
    </ListPage>
  );
}
