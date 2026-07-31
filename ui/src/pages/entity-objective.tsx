// Story 01 — EntityObjectivePage: reads params, uses chain hook, renders workspace.
// Story 04 — three tabs: Summary, Tasks, Integration.
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { useObjectiveChain } from "@/app/entity-chain";
import { EntityWorkspace } from "@/components/entity-workspace";
import { AsyncBoundary } from "@/components/async-boundary";
import { EntityStatus } from "@/lib/status-display";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
  TableBody,
} from "@/components/ui/table";
import { asyncStateOf } from "@/lib/async-state";
import { fetchTasks, fetchResource } from "@/lib/api-client";
import { taskKeys, resourceKeys } from "@/lib/query-keys";

// --- Summary panel ---

function ObjectiveSummary({
  objective,
}: {
  readonly objective: NonNullable<
    ReturnType<typeof useObjectiveChain>["objective"]
  >;
}): ReactElement {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      <dt className="text-muted-foreground text-sm">Status</dt>
      <dd>
        <EntityStatus axis="initiative" value={objective.status} />
      </dd>

      <dt className="text-muted-foreground text-sm">Candidate commit</dt>
      <dd>
        {objective.commitOid === undefined ? (
          <span data-testid="empty-commit-oid">Not specified.</span>
        ) : (
          <code data-testid="objective-commit-oid">{objective.commitOid}</code>
        )}
      </dd>

      <dt className="text-muted-foreground text-sm">Parent commit</dt>
      <dd>
        {objective.parentOid === undefined ? (
          <span data-testid="empty-parent-oid">Not specified.</span>
        ) : (
          <code data-testid="objective-parent-oid">{objective.parentOid}</code>
        )}
      </dd>

      <dt className="text-muted-foreground text-sm">Note</dt>
      <dd>
        {objective.note === null ? (
          <span data-testid="empty-note">Not specified.</span>
        ) : (
          <p data-testid="objective-note">{objective.note}</p>
        )}
      </dd>

      <dt className="text-muted-foreground text-sm">Conflict</dt>
      <dd>
        {objective.conflictCause === null &&
        objective.conflictReason === null ? (
          <span data-testid="empty-conflict">No conflict recorded.</span>
        ) : (
          <>
            {objective.conflictCause !== null && (
              <p data-testid="objective-conflict-cause">
                {objective.conflictCause}
              </p>
            )}
            {objective.conflictReason !== null && (
              <p data-testid="objective-conflict-reason">
                {objective.conflictReason}
              </p>
            )}
          </>
        )}
      </dd>
    </dl>
  );
}

// --- Tasks panel ---

function ObjectiveTasks({
  projectId,
  initiativeId,
  objectiveId,
}: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
}): ReactElement {
  const query = useQuery({
    queryKey: taskKeys.list(initiativeId, objectiveId),
    queryFn: ({ signal }) => fetchTasks(initiativeId, objectiveId, { signal }),
    staleTime: Infinity,
  });

  const state = asyncStateOf(query);

  if (state === "loading" || state === "error") {
    const message =
      query.error instanceof Error ? query.error.message : undefined;
    return <AsyncBoundary state={state} what="tasks" message={message} />;
  }

  if (!query.data || query.data.length === 0) {
    return <p data-testid="empty-tasks">No tasks yet.</p>;
  }

  return (
    <Table data-testid="task-table">
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.data.map((t) => (
          <TableRow key={t.id} data-task-id={t.id}>
            <TableCell>
              <Link
                to={
                  "/project/" +
                  projectId +
                  "/initiative/" +
                  initiativeId +
                  "/objective/" +
                  objectiveId +
                  "/task/" +
                  t.id
                }
              >
                {t.title}
              </Link>
            </TableCell>
            <TableCell>
              <EntityStatus axis="task" value={t.status} />
            </TableCell>
            <TableCell>
              <span data-testid="task-row-state">{t.state}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// --- Integration panel ---

function ObjectiveIntegration({
  projectId,
  integrations,
}: {
  readonly projectId: string;
  readonly integrations: readonly {
    readonly repository: string;
    readonly state: string;
  }[];
}): ReactElement {
  if (integrations.length === 0) {
    return <p data-testid="empty-integration">Not integrated yet.</p>;
  }

  return (
    <Table data-testid="integration-table">
      <TableHeader>
        <TableRow>
          <TableHead>Repository</TableHead>
          <TableHead>State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {integrations.map((i) => (
          <IntegrationRow
            key={i.repository}
            projectId={projectId}
            integration={i}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function IntegrationRow({
  projectId,
  integration,
}: {
  readonly projectId: string;
  readonly integration: { readonly repository: string; readonly state: string };
}): ReactElement {
  const { repository, state } = integration;

  const query = useQuery({
    queryKey: resourceKeys.detail(repository),
    queryFn: ({ signal }) => fetchResource(repository, { signal }),
    staleTime: Infinity,
  });

  const name = query.data?.name;

  return (
    <TableRow>
      <TableCell>
        <Link
          data-testid="integration-repository"
          to={"/project/" + projectId + "/resource/repository/" + repository}
        >
          {name ?? repository}
        </Link>
        <code data-testid="integration-repository-id">{repository}</code>
      </TableCell>
      <TableCell>
        <EntityStatus axis="initiative" value={state} />
      </TableCell>
    </TableRow>
  );
}

// --- Main page ---

export function EntityObjectivePage(): ReactElement {
  const { projectId, initiativeId, objectiveId } = useParams<{
    projectId: string;
    initiativeId: string;
    objectiveId: string;
  }>();
  const { gate, objective, segments } = useObjectiveChain({
    projectId: projectId!,
    initiativeId: initiativeId!,
    objectiveId: objectiveId!,
  });

  const tabs = [
    {
      value: "summary",
      label: "Summary",
      panel: objective ? <ObjectiveSummary objective={objective} /> : null,
    },
    {
      value: "tasks",
      label: "Tasks",
      panel: (
        <ObjectiveTasks
          projectId={projectId!}
          initiativeId={initiativeId!}
          objectiveId={objectiveId!}
        />
      ),
    },
    {
      value: "integration",
      label: "Integration",
      panel: objective ? (
        <ObjectiveIntegration
          projectId={projectId!}
          integrations={objective.integrations}
        />
      ) : null,
    },
  ];

  return (
    <EntityWorkspace
      projectId={projectId!}
      segments={segments}
      gate={gate}
      kindLabel="Objective"
      name={objective?.name ?? ""}
      tabs={tabs}
    />
  );
}
