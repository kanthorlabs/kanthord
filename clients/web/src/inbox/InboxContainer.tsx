import { useCallback, useEffect, useRef, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { Inbox } from "@/inbox/Inbox";
import type { InboxProps } from "@/inbox/Inbox";
import { toInboxItemVM } from "@/inbox/inbox-vm";

export function InboxContainer() {
  const client = useDaemonClient();
  const requestVersion = useRef(0);
  const [state, setState] = useState<InboxProps>({ loading: true });

  const load = useCallback(async (showLoading: boolean) => {
    const version = ++requestVersion.current;
    if (showLoading) setState({ loading: true });
    try {
      const result = await client.listInboxItems({});
      if (version === requestVersion.current) {
        setState({
          items: result.items.map((item) => toInboxItemVM(item)),
          fetchedAt: new Date(),
        });
      }
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setState((current) => current.items === undefined
          ? { error: { message: String(reason) } }
          : { ...current, refreshError: { message: String(reason) } });
      }
    }
  }, [client]);

  useEffect(() => {
    void load(true);
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  return <Inbox {...state} onRefresh={() => load(false)} />;
}
