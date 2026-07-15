import { useEffect, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { Inbox } from "@/inbox/Inbox";
import type { InboxProps } from "@/inbox/Inbox";
import { toInboxItemVM } from "@/inbox/inbox-vm";

export function InboxContainer() {
  const client = useDaemonClient();
  const [state, setState] = useState<InboxProps>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    client.listInboxItems({}).then(
      (result) => {
        if (!cancelled) {
          setState({
            items: result.items.map((item) => toInboxItemVM(item)),
          });
        }
      },
      (reason: unknown) => {
        if (!cancelled) setState({ error: { message: String(reason) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  return <Inbox {...state} />;
}
