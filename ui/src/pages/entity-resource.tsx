// Story 01 — EntityResourcePage: reads params, uses chain hook, renders workspace.
// Story 07 — single Summary tab with type-discriminated <dl> rows.
import type { ReactElement } from "react";
import { useParams } from "react-router-dom";

import { useResourceChain } from "@/app/entity-chain";
import { EntityWorkspace } from "@/components/entity-workspace";
import { publicationLabel } from "@/lib/status-role";
import type { ResourceDto } from "@/lib/dto";

// --- Summary panel ---

function ResourceSummary({
  resource,
}: {
  readonly resource: ResourceDto;
}): ReactElement {
  switch (resource.type) {
    case "repository":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground text-sm">Name</dt>
          <dd>
            <span data-testid="resource-name">{resource.name}</span>
          </dd>

          <dt className="text-muted-foreground text-sm">Remote</dt>
          <dd>
            <code data-testid="resource-remote-url">{resource.remoteUrl}</code>
          </dd>

          <dt className="text-muted-foreground text-sm">Branch</dt>
          <dd>
            <code data-testid="resource-branch">{resource.branch}</code>
          </dd>

          <dt className="text-muted-foreground text-sm">Path</dt>
          <dd>
            <code data-testid="resource-path">{resource.path}</code>
          </dd>

          <dt className="text-muted-foreground text-sm">Auth</dt>
          <dd>
            <span data-testid="resource-auth-kind">{resource.auth.kind}</span>
            {resource.auth.kind === "https-token" && (
              <>
                {" "}
                <code data-testid="resource-auth-credential">
                  {resource.auth.credentialId}
                </code>
              </>
            )}
          </dd>

          <dt className="text-muted-foreground text-sm">Publication</dt>
          <dd>
            <span data-testid="resource-publication">
              {resource.publication === null
                ? "\u2014"
                : publicationLabel(resource.publication)}
            </span>
          </dd>
        </dl>
      );

    case "credential":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground text-sm">Name</dt>
          <dd>
            <span data-testid="resource-name">{resource.name}</span>
          </dd>

          <dt className="text-muted-foreground text-sm">Provider</dt>
          <dd>
            <span data-testid="resource-provider">{resource.provider}</span>
          </dd>
        </dl>
      );

    case "notification":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground text-sm">Name</dt>
          <dd>
            <span data-testid="resource-name">{resource.name}</span>
          </dd>

          <dt className="text-muted-foreground text-sm">Provider</dt>
          <dd>
            <span data-testid="resource-provider">{resource.provider}</span>
          </dd>

          <dt className="text-muted-foreground text-sm">Destination</dt>
          <dd>
            <span data-testid="resource-destination">
              {resource.destination}
            </span>
          </dd>
        </dl>
      );

    case "filesystem":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground text-sm">Name</dt>
          <dd>
            <span data-testid="resource-name">{resource.name}</span>
          </dd>

          <dt className="text-muted-foreground text-sm">Path</dt>
          <dd>
            <code data-testid="resource-path">{resource.path}</code>
          </dd>
        </dl>
      );

    default: {
      const exhaustive: never = resource;
      return exhaustive;
    }
  }
}

// --- Main page ---

export function EntityResourcePage(): ReactElement {
  const { projectId, type, resourceId } = useParams<{
    projectId: string;
    type: string;
    resourceId: string;
  }>();
  const { gate, resource, segments } = useResourceChain({
    projectId: projectId!,
    type: type!,
    resourceId: resourceId!,
  });

  const tabs = resource
    ? [
        {
          value: "summary",
          label: "Summary",
          panel: <ResourceSummary resource={resource} />,
        },
      ]
    : [];

  return (
    <EntityWorkspace
      projectId={projectId!}
      segments={segments}
      gate={gate}
      kindLabel="Resource"
      name={resource?.name ?? ""}
      tabs={tabs}
    />
  );
}
