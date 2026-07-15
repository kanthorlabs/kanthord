import { useState } from "react";
import { DataStates } from "@/components/DataStates";
import { OpsPage } from "@/components/templates/OpsPage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { locators } from "@/locators";

export interface VerifyReportVM {
  present?: boolean;
  outcome?: string;
  ranAt?: bigint;
  reportJson?: string;
}

export interface PingData {
  present: boolean;
  sentAt: bigint;
  tasksProcessed: bigint;
}

export interface DaemonStatusData {
  version: string;
  uptimeSeconds: bigint;
  lastPing?: PingData;
  lastVerify?: VerifyReportVM;
}

export interface DaemonOpsProps {
  loading?: boolean;
  error?: { message: string };
  status?: DaemonStatusData;
  onVerifySuccess?: () => void | Promise<void>;
}

export function DaemonOps(props: DaemonOpsProps = {}) {
  if (props.loading) return <DataStates loading />;
  if (props.error !== undefined) return <DataStates error={props.error} />;
  if (props.status === undefined) return <DataStates error={{ message: "Daemon status is unavailable." }} />;
  return <DaemonOpsContent status={props.status} onVerifySuccess={props.onVerifySuccess} />;
}

function DaemonOpsContent({
  status,
  onVerifySuccess,
}: {
  status: DaemonStatusData;
  onVerifySuccess?: () => void | Promise<void>;
}) {
  const client = useDaemonClient();
  const [verifyReport, setVerifyReport] = useState<VerifyReportVM | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function handleVerify() {
    setVerifyError(null);
    try {
      const result = await client.triggerVerify({});
      if (result.report !== undefined) setVerifyReport(result.report);
      await onVerifySuccess?.();
    } catch (reason: unknown) {
      setVerifyError(reason instanceof Error ? reason.message : "Verification failed");
    }
  }

  const lastPing = status.lastPing;
  return (
    <OpsPage>
      <Card data-testid={locators.daemonOps.healthCard}>
        <CardHeader><CardTitle>Dead-man health</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {lastPing?.present === true ? (
            <>
              <div data-testid={locators.daemonOps.pingTime} className="text-sm text-muted-foreground">Last ping: {String(lastPing.sentAt)}</div>
              <div data-testid={locators.daemonOps.tasksProcessed} className="text-sm font-medium">{String(lastPing.tasksProcessed)} tasks processed today</div>
            </>
          ) : (
            <>
              <div data-testid={locators.daemonOps.noPingState} className="text-sm text-muted-foreground">No ping recorded</div>
              <div data-testid={locators.daemonOps.tasksProcessedUnavailable} className="text-sm text-muted-foreground">Tasks processed count not yet available</div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Verify</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button data-testid={locators.daemonOps.verifyTrigger} onClick={() => void handleVerify()}>Run verify</Button>
          {verifyError !== null && <div data-testid={locators.daemonOps.verifyError} className="text-sm text-destructive">{verifyError}</div>}
          {verifyReport !== null && (
            <div data-testid={locators.daemonOps.verifyReport} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Outcome:</span>
                <span data-testid={locators.daemonOps.verifyOutcome} className="text-sm font-medium">{verifyReport.outcome}</span>
              </div>
              <pre className="text-xs text-muted-foreground overflow-x-auto rounded-md bg-muted p-2 whitespace-pre-wrap">{verifyReport.reportJson}</pre>
            </div>
          )}
        </CardContent>
      </Card>
    </OpsPage>
  );
}
