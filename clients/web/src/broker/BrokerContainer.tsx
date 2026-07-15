import { useEffect, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { BrokerOpsView, BrokerVerbsView } from "@/broker/BrokerViews";
import type { BrokerOpsViewProps, BrokerVerbsViewProps } from "@/broker/BrokerViews";

type BrokerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; operations: NonNullable<BrokerOpsViewProps["operations"]>; verbs: NonNullable<BrokerVerbsViewProps["verbs"]> };

export function BrokerContainer() {
  const client = useDaemonClient();
  const [state, setState] = useState<BrokerState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.listBrokerOperations({}), client.listBrokerVerbs({})]).then(
      ([operations, verbs]) => {
        if (!cancelled) setState({ status: "data", operations: operations.operations, verbs: verbs.verbs });
      },
      (reason: unknown) => {
        if (!cancelled) setState({ status: "error", message: String(reason) });
      },
    );
    return () => { cancelled = true; };
  }, [client]);

  if (state.status === "loading") {
    return <><BrokerOpsView loading /><BrokerVerbsView loading /></>;
  }
  if (state.status === "error") {
    const error = { message: state.message };
    return <><BrokerOpsView error={error} /><BrokerVerbsView error={error} /></>;
  }
  return <><BrokerOpsView operations={state.operations} /><BrokerVerbsView verbs={state.verbs} /></>;
}
