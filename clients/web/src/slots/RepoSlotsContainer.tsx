import { useEffect, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { RepoSlots } from "@/slots/RepoSlots";
import type { RepoSlotsProps } from "@/slots/RepoSlots";

export function RepoSlotsContainer() {
  const client = useDaemonClient();
  const [state, setState] = useState<RepoSlotsProps>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    client.listSlots({}).then(
      (result) => { if (!cancelled) setState({ slots: result.slots }); },
      (reason: unknown) => { if (!cancelled) setState({ error: { message: String(reason) } }); },
    );
    return () => { cancelled = true; };
  }, [client]);

  return <RepoSlots {...state} />;
}
