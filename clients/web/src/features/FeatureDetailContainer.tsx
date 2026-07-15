import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { FeatureDetail } from "@/features/FeatureDetail";
import type { FeatureDetailProps } from "@/features/FeatureDetail";

type DetailState = Omit<FeatureDetailProps, "featureId">;

export function FeatureDetailContainer() {
  const client = useDaemonClient();
  const { featureId } = useParams<{ featureId: string }>();
  const [state, setState] = useState<DetailState>(() =>
    featureId === undefined
      ? { error: { message: "Feature id is required." } }
      : { loading: true },
  );

  useEffect(() => {
    if (featureId === undefined) return;
    let cancelled = false;
    setState({ loading: true });
    client.getFeature({ featureId }).then(
      (result) => {
        if (!cancelled) setState({ data: result });
      },
      (reason: unknown) => {
        if (!cancelled) setState({ error: { message: String(reason) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, featureId]);

  return <FeatureDetail featureId={featureId ?? ""} {...state} />;
}
