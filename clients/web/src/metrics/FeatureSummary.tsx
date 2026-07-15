import { useEffect, useState } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

type Summary = Awaited<ReturnType<DaemonClient["getFeatureSummary"]>>;
type SummaryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; summary: Summary };

const BREAKDOWN_TYPES = ["approval", "clarification", "correction", "rework", "takeover", "external"] as const;

export function FeatureSummary({ featureId }: { featureId: string }) {
  const client = useDaemonClient();
  const [state, setState] = useState<SummaryState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    if (typeof client.getFeatureSummary !== "function") {
      setState({ status: "error", message: "Summary method is unavailable." });
      return () => {
        cancelled = true;
      };
    }
    client.getFeatureSummary({ featureId }).then(
      (summary) => {
        if (summary.byConfirmedType === undefined) {
          if (!cancelled) setState({ status: "error", message: "Summary breakdown is unavailable." });
        } else if (!cancelled) {
          setState({ status: "data", summary });
        }
      },
      (reason: unknown) => {
        if (!cancelled) setState({ status: "error", message: String(reason) });
      },
    );
    return () => { cancelled = true; };
  }, [client, featureId]);

  if (state.status === "loading") return <FeatureSummaryLoading />;
  if (state.status === "error") {
    return <Alert variant="destructive" data-testid={locators.metrics.featureSummary.error}><AlertDescription>{state.message}</AlertDescription></Alert>;
  }

  const { summary } = state;
  if (summary.byConfirmedType === undefined) {
    return <Alert variant="destructive" data-testid={locators.metrics.featureSummary.error}><AlertDescription>Summary breakdown is unavailable.</AlertDescription></Alert>;
  }
  const breakdown = summary.byConfirmedType;
  const empty = summary.headline === 0 && summary.excluded === 0 && summary.netCost === 0 && BREAKDOWN_TYPES.every((type) => breakdown[type] === 0);
  const content = <SummaryContent headline={summary.headline} netCost={summary.netCost} excluded={summary.excluded} breakdown={breakdown} />;

  return (
    <Card data-testid={locators.metrics.featureSummary.root}>
      <CardHeader><CardTitle>Feature summary</CardTitle></CardHeader>
      <CardContent>
        {empty ? <Empty data-testid={locators.metrics.featureSummary.empty}>{content}</Empty> : content}
      </CardContent>
    </Card>
  );
}

function FeatureSummaryLoading() {
  return (
    <Card data-testid={locators.metrics.featureSummary.loading}>
      <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-4 w-24" />
      </CardContent>
    </Card>
  );
}

function SummaryContent({
  headline,
  netCost,
  excluded,
  breakdown,
}: {
  headline: number;
  netCost: number;
  excluded: number;
  breakdown: NonNullable<Summary["byConfirmedType"]>;
}) {
  return (
    <>
      <p data-testid={locators.metrics.featureSummary.headline} className="text-foreground text-lg font-semibold">
        {headline} human interactions, ${netCost}
      </p>
      <Table data-testid={locators.metrics.featureSummary.breakdownTable}>
        <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Count</TableHead></TableRow></TableHeader>
        <TableBody>
          {BREAKDOWN_TYPES.map((type) => (
            <TableRow key={type} data-testid={locators.metrics.featureSummary.breakdownRow(type)}>
              <TableCell>{type}</TableCell><TableCell>{breakdown[type]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p data-testid={locators.metrics.featureSummary.excluded} className="text-muted-foreground text-sm">Excluded: {excluded}</p>
    </>
  );
}
