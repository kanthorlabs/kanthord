import { useCallback, useEffect, useRef, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { RepoSlots } from "@/slots/RepoSlots";
import type { RepoSlotsProps } from "@/slots/RepoSlots";

export function RepoSlotsContainer() {
  const client = useDaemonClient();
  const requestVersion = useRef(0);
  const [state, setState] = useState<RepoSlotsProps>({ loading: true });

  const load = useCallback(async (showLoading: boolean) => {
    const version = ++requestVersion.current;
    if (showLoading) setState({ loading: true });
    try {
      const result = await client.listSlots({});
      if (version === requestVersion.current) setState({ slots: result.slots, fetchedAt: new Date() });
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setState((current) => current.slots === undefined
          ? { error: { message: String(reason) } }
          : { ...current, refreshError: { message: String(reason) } });
      }
    }
  }, [client]);

  useEffect(() => {
    void load(true);
    return () => { requestVersion.current += 1; };
  }, [load]);

  return <RepoSlots {...state} onRefresh={() => load(false)} />;
}
