import { useCallback, useEffect, useRef, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { DaemonOps } from "@/daemon-ops/DaemonOps";
import type { DaemonOpsProps } from "@/daemon-ops/DaemonOps";

export function DaemonOpsContainer() {
  const client = useDaemonClient();
  const requestVersion = useRef(0);
  const [state, setState] = useState<DaemonOpsProps>({ loading: true });

  const load = useCallback(async (showLoading: boolean) => {
    const version = ++requestVersion.current;
    if (showLoading) setState({ loading: true });
    try {
      const result = await client.getDaemonStatus({});
      if (version === requestVersion.current) {
        setState({
          status: {
            version: result.version,
            uptimeSeconds: result.uptimeSeconds,
            lastPing: result.lastPing,
            lastVerify: result.lastVerify,
          },
        });
      }
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setState({ error: { message: String(reason) } });
      }
    }
  }, [client]);

  useEffect(() => {
    void load(true);
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  return <DaemonOps {...state} onVerifySuccess={() => load(false)} />;
}
