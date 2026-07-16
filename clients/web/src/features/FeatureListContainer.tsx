import { useCallback, useEffect, useRef, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { FeatureList } from "@/features/FeatureList";
import type { FeatureListProps } from "@/features/FeatureList";

export function FeatureListContainer() {
  const client = useDaemonClient();
  const requestVersion = useRef(0);
  const [state, setState] = useState<FeatureListProps>({ loading: true });

  const load = useCallback(async (showLoading: boolean) => {
    const version = ++requestVersion.current;
    if (showLoading) setState({ loading: true });
    try {
      const result = await client.listFeatures({});
      if (version === requestVersion.current) {
        setState({ features: result.features, fetchedAt: new Date() });
      }
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setState((current) => current.features === undefined
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

  return <FeatureList {...state} onRefresh={() => load(false)} />;
}
