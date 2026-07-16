import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { FeatureDetail } from "@/features/FeatureDetail";
import type { FeatureDetailProps } from "@/features/FeatureDetail";

type DetailState = Omit<FeatureDetailProps, "featureId">;

export function FeatureDetailContainer() {
  const client = useDaemonClient();
  const { featureId } = useParams<{ featureId: string }>();
  const requestVersion = useRef(0);
  const [state, setState] = useState<DetailState>(() =>
    featureId === undefined
      ? { error: { message: "Feature id is required." } }
      : { loading: true },
  );

  const load = useCallback(async (showLoading: boolean, preserveProposal = false) => {
    if (featureId === undefined) return;
    const version = ++requestVersion.current;
    if (showLoading) setState({ loading: true });
    const pendingProposal = client.getPendingReplanProposal?.({ featureId })
      ?? Promise.resolve({ proposal: undefined });
    try {
      const [feature, pending] = await Promise.all([client.getFeature({ featureId }), pendingProposal]);
      if (version === requestVersion.current) {
        setState((current) => ({
          data: feature,
          pendingReplanProposal: pending.proposal
            ?? (preserveProposal ? current.pendingReplanProposal : undefined),
          fetchedAt: new Date(),
        }));
      }
    } catch (reason: unknown) {
      if (version === requestVersion.current) {
        setState((current) => current.data === undefined
          ? { error: { message: String(reason) } }
          : { ...current, refreshError: { message: String(reason) } });
      }
    }
  }, [client, featureId]);

  useEffect(() => {
    void load(true);
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  return (
    <FeatureDetail
      featureId={featureId ?? ""}
      {...state}
      onRefresh={() => load(false)}
      onControlSuccess={() => load(false, true)}
    />
  );
}
