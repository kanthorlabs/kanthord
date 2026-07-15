import { useEffect, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { FeatureList } from "@/features/FeatureList";
import type { FeatureListProps } from "@/features/FeatureList";

export function FeatureListContainer() {
  const client = useDaemonClient();
  const [state, setState] = useState<FeatureListProps>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    client.listFeatures({}).then(
      (result) => {
        if (!cancelled) setState({ features: result.features });
      },
      (reason: unknown) => {
        if (!cancelled) setState({ error: { message: String(reason) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  return <FeatureList {...state} />;
}
