/**
 * DaemonOps — daemon-ops view: dead-man health card + verify trigger
 * (Story 006 T2).
 *
 * Calls client.getDaemonStatus({}) on mount and renders:
 *   - A dead-man health card (DESIGN §6 OpsPage card) showing last ping time,
 *     "N tasks processed today" count (present=true) or not-yet-available state
 *     (present=false / Epic 029 field not yet populated).
 *   - A verify trigger button that calls client.triggerVerify({}) and renders
 *     the returned VerifyReport (outcome + reportJson content) inline.
 *
 * Local view-model types are defined here (B1 — component owns the projection;
 * no view-model types imported from the shared client module). The generated
 * VerifyReport and DeadManPing types are structurally assignable to the local
 * view-model interfaces, so no explicit cast is needed.
 *
 * Semantic tokens only (DESIGN §3). Locators from registry only (DESIGN §8).
 */
import { useState, useEffect } from "react";
import { DataStates } from "@/components/DataStates";
import { OpsPage } from "@/components/templates/OpsPage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Local view-model types (B1 — component-owned; not imported from client.ts)
// ---------------------------------------------------------------------------

interface VerifyReportVM {
  present?: boolean;
  outcome?: string;
  ranAt?: bigint;
  reportJson?: string;
}

interface PingData {
  present: boolean;
  sentAt: bigint;
  tasksProcessed: bigint;
}

interface DaemonStatusData {
  version: string;
  uptimeSeconds: bigint;
  lastPing?: PingData;
  lastVerify?: VerifyReportVM;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DaemonOps() {
  const client = useDaemonClient();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null); // B2
  const [status, setStatus] = useState<DaemonStatusData | null>(null);
  const [verifyReport, setVerifyReport] = useState<VerifyReportVM | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null); // B3

  useEffect(() => {
    void client
      .getDaemonStatus({})
      .then((result) => {
        // B1: map proto response to local view-model (DeadManPing and VerifyReport
        // are structurally compatible with PingData / VerifyReportVM — required
        // proto fields satisfy optional VM fields without needing an explicit cast).
        setStatus({
          version: result.version,
          uptimeSeconds: result.uptimeSeconds,
          lastPing: result.lastPing,
          lastVerify: result.lastVerify,
        });
        setLoading(false);
      })
      .catch((err: unknown) => {
        // B2: surface load rejections instead of staying stuck on loading
        setLoadError(err instanceof Error ? err.message : "Failed to load status");
        setLoading(false);
      });
  }, [client]);

  async function handleVerify() {
    setVerifyError(null);
    try {
      const result = await client.triggerVerify({});
      // VerifyReport (from TriggerVerifyResponse) is structurally assignable to VerifyReportVM.
      if (result.report !== undefined) {
        setVerifyReport(result.report);
      }
    } catch (err: unknown) {
      // B3: surface verify rejections inline
      setVerifyError(err instanceof Error ? err.message : "Verification failed");
    }
  }

  if (loading) {
    return <DataStates loading={true} />;
  }

  // B2: render error state on load failure
  if (loadError !== null) {
    return <DataStates error={{ message: loadError }} />;
  }

  const lastPing = status?.lastPing;

  return (
    <OpsPage>
      {/* Dead-man health card (DESIGN §6 OpsPage card, Story 006 T2 Input 7) */}
      <Card data-testid={locators.daemonOps.healthCard}>
        <CardHeader>
          <CardTitle>Dead-man health</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {lastPing?.present === true ? (
            <>
              <div
                data-testid={locators.daemonOps.pingTime}
                className="text-sm text-muted-foreground"
              >
                Last ping: {String(lastPing.sentAt)}
              </div>
              <div
                data-testid={locators.daemonOps.tasksProcessed}
                className="text-sm font-medium"
              >
                {String(lastPing.tasksProcessed)} tasks processed today
              </div>
            </>
          ) : (
            <>
              <div
                data-testid={locators.daemonOps.noPingState}
                className="text-sm text-muted-foreground"
              >
                No ping recorded
              </div>
              <div
                data-testid={locators.daemonOps.tasksProcessedUnavailable}
                className="text-sm text-muted-foreground"
              >
                Tasks processed count not yet available
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Verify trigger card */}
      <Card>
        <CardHeader>
          <CardTitle>Verify</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            data-testid={locators.daemonOps.verifyTrigger}
            onClick={() => void handleVerify()}
          >
            Run verify
          </Button>

          {/* B3: inline verify-error element */}
          {verifyError !== null && (
            <div
              data-testid={locators.daemonOps.verifyError}
              className="text-sm text-destructive"
            >
              {verifyError}
            </div>
          )}

          {verifyReport !== null && (
            <div
              data-testid={locators.daemonOps.verifyReport}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Outcome:</span>
                <span
                  data-testid={locators.daemonOps.verifyOutcome}
                  className="text-sm font-medium"
                >
                  {verifyReport.outcome}
                </span>
              </div>
              <pre className="text-xs text-muted-foreground overflow-x-auto rounded-md bg-muted p-2 whitespace-pre-wrap">
                {verifyReport.reportJson}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </OpsPage>
  );
}
