import type { DaemonClient } from "@/lib/client";
import { DataStates } from "@/components/DataStates";
import { DetailPage } from "@/components/templates/DetailPage";
import { TaskStatusBadge } from "@/components/status/TaskStatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FeatureSummary } from "@/metrics/FeatureSummary";
import { SignOff } from "@/plan-flows/SignOff";
import { Halt } from "@/plan-flows/Halt";
import { ReplanApproval } from "@/plan-flows/ReplanApproval";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ReplanProposal } from "@/gen/kanthord/v1/daemon_pb.ts";
import { ROUTES } from "@/app/routes";
import { locators } from "@/locators";

type FeatureData = Awaited<ReturnType<DaemonClient["getFeature"]>>;

export interface FeatureDetailProps {
  featureId: string;
  loading?: boolean;
  error?: { message: string };
  refreshError?: { message: string };
  data?: FeatureData;
  pendingReplanProposal?: PendingReplanProposal;
  actor?: string;
  fetchedAt?: Date;
  onRefresh?: () => Promise<void>;
  onControlSuccess?: () => Promise<void>;
}

type PendingReplanProposal = Omit<ReplanProposal, "$typeName" | "edits" | "displayFiles"> & {
  edits: Array<{ path: string; newContent: string }>;
  displayFiles: Array<{ path: string; lines: Array<{ kind: string; content: string }> }>;
};

export function FeatureDetail({
  featureId,
  loading,
  error,
  refreshError,
  data,
  pendingReplanProposal,
  actor = "operator@kanthord",
  fetchedAt,
  onRefresh,
  onControlSuccess,
}: FeatureDetailProps) {
  if (loading) return <DataStates loading />;
  if (error !== undefined) return <DataStates error={error} />;
  if (data === undefined) return <DataStates error={{ message: "Feature data is unavailable." }} />;

  const planContent = (
    <div className="flex flex-col gap-6">
      <section data-testid={locators.features.detail.tasks}>
        <Table data-testid={locators.features.detail.tasksTable}>
          <TableHeader>
            <TableRow>
              <TableHead>Task ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.stories.flatMap((story) =>
              story.tasks.map((task) => (
                <TableRow key={task.taskId} data-testid={locators.features.detail.taskRow(task.taskId)}>
                  <TableCell>{task.taskId}</TableCell>
                  <TableCell><TaskStatusBadge status={task.status} /></TableCell>
                  <TableCell>{String(task.attempt)}</TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </section>

      {data.dag !== undefined && (
        <section data-testid={locators.features.detail.dag} className="text-sm text-foreground">
          <span>Nodes: {String(data.dag.satisfiedNodes)}/{String(data.dag.totalNodes)}</span>
          {" · "}
          <span>Edges: {String(data.dag.satisfiedEdges)}/{String(data.dag.totalEdges)}</span>
        </section>
      )}

      <section data-testid={locators.features.detail.ops}>
        <Table data-testid={locators.features.detail.opsTable}>
          <TableHeader>
            <TableRow>
              <TableHead>Op ID</TableHead>
              <TableHead>Verb</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.inFlightOps.map((op) => (
              <TableRow key={op.opId} data-testid={locators.features.detail.opRow(op.opId)}>
                <TableCell>{op.opId}</TableCell>
                <TableCell>{op.verb}</TableCell>
                <TableCell>{op.state}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );

  const firstTask = data.stories.flatMap((story) => story.tasks)[0];
  const controlsContent = (
    <div className="flex flex-col gap-6">
      <SignOff featureId={featureId} actor={actor} onSuccess={onControlSuccess ?? onRefresh} />
      {firstTask !== undefined && <Halt taskId={firstTask.taskId} actor={actor} onSuccess={onControlSuccess ?? onRefresh} />}
      {pendingReplanProposal === undefined ? (
        <Alert>
          <AlertDescription>No pending replan proposal.</AlertDescription>
        </Alert>
      ) : (
        <ReplanApproval proposal={pendingReplanProposal} actor={actor} onSuccess={onControlSuccess ?? onRefresh} />
      )}
    </div>
  );

  return (
    <DetailPage
      breadcrumb={[{ label: "Features", href: ROUTES.features }, { label: featureId }]}
      tabs={[
        { id: "plan", label: "Plan", content: planContent },
        {
          id: "state",
          label: "State",
          content: <ScrollArea data-testid={locators.features.detail.stateView} className="max-h-96"><pre className="text-sm text-foreground whitespace-pre-wrap">{data.stateView}</pre></ScrollArea>,
        },
        {
          id: "journal",
          label: "Journal",
          content: <ScrollArea data-testid={locators.features.detail.journalView} className="max-h-96"><pre className="text-sm text-foreground whitespace-pre-wrap">{data.journalView}</pre></ScrollArea>,
        },
        { id: "summary", label: "Summary", content: <FeatureSummary featureId={featureId} /> },
        { id: "controls", label: "Controls", content: controlsContent },
      ]}
      defaultTab="plan"
      refreshError={refreshError}
      fetchedAt={fetchedAt}
      onRefresh={onRefresh}
    />
  );
}
