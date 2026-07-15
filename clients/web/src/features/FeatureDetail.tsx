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
import { ROUTES } from "@/app/routes";
import { locators } from "@/locators";

type FeatureData = Awaited<ReturnType<DaemonClient["getFeature"]>>;

export interface FeatureDetailProps {
  featureId: string;
  loading?: boolean;
  error?: { message: string };
  data?: FeatureData;
}

export function FeatureDetail({ featureId, loading, error, data }: FeatureDetailProps) {
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
      ]}
      defaultTab="plan"
    />
  );
}
