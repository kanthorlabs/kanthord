// Story 01 — EntityInitiativePage: reads params, uses chain hook, renders workspace.
// Story 03 — three tabs: Summary, Objectives, Dependencies.
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";

import { useInitiativeChain } from "@/app/entity-chain";
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

// --- Summary panel ---

function InitiativeSummary({
  initiative,
}: {
  readonly initiative: NonNullable<
    ReturnType<typeof useInitiativeChain>["initiative"]
  >;
}): ReactElement {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      <dt className="text-muted-foreground text-sm">Status</dt>
      <dd>
        <EntityStatus axis="initiative" value={initiative.status} />
      </dd>

      <dt className="text-muted-foreground text-sm">Paused</dt>
      <dd>
        <span data-testid="initiative-paused">
          {initiative.paused ? "paused" : "running"}
        </span>
      </dd>

      <dt className="text-muted-foreground text-sm">Branch</dt>
      <dd>
        <code data-testid="initiative-branch">{initiative.branch}</code>
      </dd>

      <dt className="text-muted-foreground text-sm">Workspace</dt>
      <dd>
        {initiative.workspace === undefined ? (
          <span data-testid="empty-workspace">Not specified.</span>
        ) : (
          <code data-testid="initiative-workspace">{initiative.workspace}</code>
        )}
      </dd>
    </dl>
  );
}

// --- Objectives panel ---

function InitiativeObjectives({
  projectId,
  initiativeId,
  objectiveRows,
  objectivesState,
  objectivesMessage,
}: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveRows:
    ReturnType<typeof useInitiativeChain>["objectiveRows"] | undefined;
  readonly objectivesState: ReturnType<
    typeof useInitiativeChain
  >["objectivesState"];
  readonly objectivesMessage: string | undefined;
}): ReactElement {
  if (objectivesState === "loading" || objectivesState === "error") {
    return (
      <AsyncBoundary
        state={objectivesState}
        what="objectives"
        message={objectivesMessage}
      />
    );
  }

  if (!objectiveRows || objectiveRows.length === 0) {
    return <p data-testid="empty-objectives">No objectives yet.</p>;
  }

  return (
    <Table data-testid="objective-table">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {objectiveRows.map((o) => (
          <TableRow key={o.id} data-objective-id={o.id}>
            <TableCell>
              <Link
                to={`/project/${projectId}/initiative/${initiativeId}/objective/${o.id}`}
              >
                {o.name}
              </Link>
            </TableCell>
            <TableCell>
              <EntityStatus axis="initiative" value={o.status ?? "building"} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// --- Dependencies panel ---

function InitiativeDependencies({
  initiative,
}: {
  readonly initiative: NonNullable<
    ReturnType<typeof useInitiativeChain>["initiative"]
  >;
}): ReactElement {
  if (initiative.after.length === 0 && initiative.waiting.length === 0) {
    return <p data-testid="empty-initiative-dependencies">No dependencies.</p>;
  }

  return (
    <>
      <section data-testid="initiative-after">
        {initiative.after.length === 0 ? (
          <p data-testid="empty-after">None.</p>
        ) : (
          initiative.after.map((id) => (
            <code key={id} data-testid="after-id">
              {id}
            </code>
          ))
        )}
      </section>
      <section data-testid="initiative-waiting">
        {initiative.waiting.length === 0 ? (
          <p data-testid="empty-waiting">None.</p>
        ) : (
          initiative.waiting.map((w) => (
            <div key={w.id}>
              <code data-testid="waiting-id">{w.id}</code>
              {w.neverSatisfies && (
                <p data-testid="waiting-never">
                  This dependency can never be satisfied.
                </p>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}

// --- Main page ---

export function EntityInitiativePage(): ReactElement {
  const { projectId, initiativeId } = useParams<{
    projectId: string;
    initiativeId: string;
  }>();
  const chain = useInitiativeChain({
    projectId: projectId!,
    initiativeId: initiativeId!,
  });

  const { gate, initiative, segments } = chain;

  const tabs = [
    {
      value: "summary",
      label: "Summary",
      panel: initiative ? <InitiativeSummary initiative={initiative} /> : null,
    },
    {
      value: "objectives",
      label: "Objectives",
      panel: (
        <InitiativeObjectives
          projectId={projectId!}
          initiativeId={initiativeId!}
          objectiveRows={chain.objectiveRows}
          objectivesState={chain.objectivesState}
          objectivesMessage={chain.objectivesMessage}
        />
      ),
    },
    {
      value: "dependencies",
      label: "Dependencies",
      panel: initiative ? (
        <InitiativeDependencies initiative={initiative} />
      ) : null,
    },
  ];

  return (
    <EntityWorkspace
      projectId={projectId!}
      segments={segments}
      gate={gate}
      kindLabel="Initiative"
      name={initiative?.name ?? ""}
      tabs={tabs}
    />
  );
}
