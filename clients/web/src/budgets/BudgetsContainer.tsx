import { useCallback, useEffect, useRef, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { Budgets } from "@/budgets/Budgets";
import { toBudgetsVM } from "@/budgets/budget-vm";
import { DataStates } from "@/components/DataStates";
import type { BudgetVM } from "@/budgets/budget-vm";

type BudgetsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; budgets: BudgetVM[]; fetchedAt: Date; refreshError?: { message: string } };

export function BudgetsContainer() {
  const client = useDaemonClient();
  const requestVersion = useRef(0);
  const [state, setState] = useState<BudgetsState>({ status: "loading" });

  const load = useCallback(async (showLoading: boolean) => {
    const version = ++requestVersion.current;
    if (showLoading) setState({ status: "loading" });
    try {
      const result = await client.listBudgets({});
      if (version === requestVersion.current) {
        setState({ status: "data", budgets: toBudgetsVM(result), fetchedAt: new Date() });
      }
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setState((current) => current.status === "data"
          ? { ...current, refreshError: { message: String(reason) } }
          : { status: "error", message: String(reason) });
      }
    }
  }, [client]);

  useEffect(() => {
    void load(true);
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  if (state.status === "loading") return <DataStates loading />;
  if (state.status === "error") return <DataStates error={{ message: state.message }} />;
  return <Budgets budgets={state.budgets} fetchedAt={state.fetchedAt} refreshError={state.refreshError} onRefresh={() => load(false)} onOverrideSuccess={() => load(false)} />;
}
