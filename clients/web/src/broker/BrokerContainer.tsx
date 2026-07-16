import { useCallback, useEffect, useRef, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { BrokerOpsView, BrokerVerbsView } from "@/broker/BrokerViews";
import type { BrokerOpsViewProps, BrokerVerbsViewProps } from "@/broker/BrokerViews";

type BrokerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; operations: NonNullable<BrokerOpsViewProps["operations"]>; verbs: NonNullable<BrokerVerbsViewProps["verbs"]>; fetchedAt: Date; refreshError?: { message: string } };

export function BrokerContainer() {
  const client = useDaemonClient();
  const requestVersion = useRef(0);
  const [state, setState] = useState<BrokerState>({ status: "loading" });

  const load = useCallback(async (showLoading: boolean) => {
    const version = ++requestVersion.current;
    if (showLoading) setState({ status: "loading" });
    try {
      const [operations, verbs] = await Promise.all([client.listBrokerOperations({}), client.listBrokerVerbs({})]);
      if (version === requestVersion.current) {
        setState({ status: "data", operations: operations.operations, verbs: verbs.verbs, fetchedAt: new Date() });
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
    return () => { requestVersion.current += 1; };
  }, [load]);

  if (state.status === "loading") {
    return <><BrokerOpsView loading /><BrokerVerbsView loading /></>;
  }
  if (state.status === "error") {
    const error = { message: state.message };
    return <><BrokerOpsView error={error} /><BrokerVerbsView error={error} /></>;
  }
  return <><BrokerOpsView operations={state.operations} refreshError={state.refreshError} fetchedAt={state.fetchedAt} onRefresh={() => load(false)} /><BrokerVerbsView verbs={state.verbs} /></>;
}
