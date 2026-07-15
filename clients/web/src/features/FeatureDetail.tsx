/**
 * FeatureDetail — feature drill-down surface (Story 001 T2).
 *
 * Reads the daemon client via useDaemonClient() and fetches the feature via
 * getFeature({ featureId }). Renders via the DetailPage template (DESIGN §6)
 * with three tabs: Plan (tasks + DAG + ops), State, Journal.
 *
 * DESIGN §6 read-only rule: no input, textarea, contentEditable, or save
 * control anywhere on this surface. Plan content renders in non-form elements.
 *
 * int64 proto fields (attempt, totalNodes, satisfiedNodes, totalEdges,
 * satisfiedEdges, expiresAt) are BigInt on the wire — rendered via String().
 */
import { useState, useEffect } from "react";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
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
import { ROUTES } from "@/app/routes";
import { locators } from "@/locators";

type FeatureData = Awaited<ReturnType<DaemonClient["getFeature"]>>;

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "data"; data: FeatureData };

export function FeatureDetail({ featureId }: { featureId: string }) {
  const client = useDaemonClient();
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    client
      .getFeature({ featureId })
      .then((data) => {
        if (!cancelled) setState({ status: "data", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, featureId]);

  if (state.status === "loading") {
    return <DataStates loading />;
  }

  if (state.status === "error") {
    return <DataStates error={{ message: state.message }} />;
  }

  const { data } = state;

  // Plan tab content: tasks, DAG progress, in-flight ops (all read-only)
  const planContent = (
    <div className="flex flex-col gap-6">
      {/* Tasks section */}
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
                <TableRow
                  key={task.taskId}
                  data-testid={locators.features.detail.taskRow(task.taskId)}
                >
                  <TableCell>{task.taskId}</TableCell>
                  <TableCell>
                    <TaskStatusBadge status={task.status} />
                  </TableCell>
                  <TableCell>{String(task.attempt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      {/* DAG progress section */}
      {data.dag !== undefined && (
        <section
          data-testid={locators.features.detail.dag}
          className="text-sm text-foreground"
        >
          <span>
            Nodes: {String(data.dag.satisfiedNodes)}/{String(data.dag.totalNodes)}
          </span>
          {" · "}
          <span>
            Edges: {String(data.dag.satisfiedEdges)}/{String(data.dag.totalEdges)}
          </span>
        </section>
      )}

      {/* In-flight ops section */}
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
              <TableRow
                key={op.opId}
                data-testid={locators.features.detail.opRow(op.opId)}
              >
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
      breadcrumb={[
        { label: "Features", href: ROUTES.features },
        { label: featureId },
      ]}
      tabs={[
        {
          id: "plan",
          label: "Plan",
          content: planContent,
        },
        {
          id: "state",
          label: "State",
          content: (
            <ScrollArea
              data-testid={locators.features.detail.stateView}
              className="max-h-96"
            >
              <pre className="text-sm text-foreground whitespace-pre-wrap">
                {data.stateView}
              </pre>
            </ScrollArea>
          ),
        },
        {
          id: "journal",
          label: "Journal",
          content: (
            <ScrollArea
              data-testid={locators.features.detail.journalView}
              className="max-h-96"
            >
              <pre className="text-sm text-foreground whitespace-pre-wrap">
                {data.journalView}
              </pre>
            </ScrollArea>
          ),
        },
      ]}
      defaultTab="plan"
    />
  );
}
