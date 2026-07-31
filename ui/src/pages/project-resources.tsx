// Story 06 — ProjectResourcesPage: four URL-addressable typed tabs.
// Decision 1: tab identity comes from the URL, never component state.
// Decision 2: one query per tab, only the visible tab runs.
// Decision 3: server-side ?name= search; no client-side filtering.
// Decision 8: no write controls.
import { useState } from "react";
import type { ReactElement } from "react";
import { NavLink, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { AsyncBoundary } from "@/components/async-boundary";
import { CollectionToolbar } from "@/components/collection-toolbar";
import { DetailPane } from "@/components/detail-pane";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchResources, fetchResource } from "@/lib/api-client";
import {
  isResourceType,
  type ResourceDto,
  type ResourceTypeKey,
} from "@/lib/dto";
import { asyncStateOf } from "@/lib/async-state";
import { projectKeys, resourceKeys } from "@/lib/query-keys";
import { publicationLabel } from "@/lib/status-role";
import {
  useDebouncedValue,
  SEARCH_DEBOUNCE_MS,
} from "@/lib/use-debounced-value";

// --- tab config ---

interface TabDef {
  readonly type: ResourceTypeKey;
  readonly label: string;
}

const TABS: readonly TabDef[] = [
  { type: "repository", label: "Repositories" },
  { type: "credential", label: "Credentials" },
  { type: "notification", label: "Notifications" },
  { type: "filesystem", label: "Filesystems" },
];

const TAB_BY_TYPE = new Map<ResourceTypeKey, TabDef>(
  TABS.map((t) => [t.type, t]),
);

// --- per-type column headers ---

const COLUMN_HEADERS: Record<ResourceTypeKey, readonly string[]> = {
  repository: ["Name", "Branch", "Remote", "Path", "Auth", "Publication"],
  credential: ["Name", "Provider"],
  notification: ["Name", "Provider", "Destination"],
  filesystem: ["Name", "Path"],
};

// --- per-type row renderer ---

function renderCells(row: ResourceDto, type: ResourceTypeKey): ReactElement {
  switch (type) {
    case "repository": {
      const r = row as Extract<ResourceDto, { type: "repository" }>;
      return (
        <>
          <TableCell>{r.name}</TableCell>
          <TableCell data-testid="resource-col-branch">{r.branch}</TableCell>
          <TableCell>{r.remoteUrl}</TableCell>
          <TableCell>{r.path}</TableCell>
          <TableCell>{r.auth.kind}</TableCell>
          <TableCell>
            {r.publication === null ? "—" : publicationLabel(r.publication)}
          </TableCell>
        </>
      );
    }
    case "credential": {
      const r = row as Extract<ResourceDto, { type: "credential" }>;
      return (
        <>
          <TableCell>{r.name}</TableCell>
          <TableCell>{r.provider}</TableCell>
        </>
      );
    }
    case "notification": {
      const r = row as Extract<ResourceDto, { type: "notification" }>;
      return (
        <>
          <TableCell>{r.name}</TableCell>
          <TableCell>{r.provider}</TableCell>
          <TableCell>{r.destination}</TableCell>
        </>
      );
    }
    case "filesystem": {
      const r = row as Extract<ResourceDto, { type: "filesystem" }>;
      return (
        <>
          <TableCell>{r.name}</TableCell>
          <TableCell>{r.path}</TableCell>
        </>
      );
    }
  }
}

// --- detail pane rows for a resource (list fields) ---

function detailRows(row: ResourceDto): { label: string; value: string }[] {
  switch (row.type) {
    case "repository":
      return [
        { label: "Name", value: row.name },
        { label: "Branch", value: row.branch },
        { label: "Remote", value: row.remoteUrl },
        { label: "Path", value: row.path },
        { label: "Auth", value: row.auth.kind },
        {
          label: "Publication",
          value:
            row.publication === null ? "—" : publicationLabel(row.publication),
        },
      ];
    case "credential":
      return [
        { label: "Name", value: row.name },
        { label: "Provider", value: row.provider },
      ];
    case "notification":
      return [
        { label: "Name", value: row.name },
        { label: "Provider", value: row.provider },
        { label: "Destination", value: row.destination },
      ];
    case "filesystem":
      return [
        { label: "Name", value: row.name },
        { label: "Path", value: row.path },
      ];
  }
}

// --- main component ---

export function ProjectResourcesPage(): ReactElement {
  const { id: projectId, type } = useParams<{ id: string; type: string }>();

  // Unknown type → missing, no request issued
  if (!type || !isResourceType(type)) {
    return (
      <main className="p-6">
        <AsyncBoundary state="missing" what="resource type" />
      </main>
    );
  }

  return <ResourceTabView projectId={projectId!} type={type} />;
}

function ResourceTabView({
  projectId,
  type,
}: {
  projectId: string;
  type: ResourceTypeKey;
}): ReactElement {
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const [selected, setSelected] = useState<ResourceDto | null>(null);

  // Detail query — runs when a row is selected
  const detailQuery = useQuery({
    queryKey: resourceKeys.detail(selected?.id ?? ""),
    queryFn: ({ signal }) => fetchResource(selected!.id, { signal }),
    enabled: selected !== null,
    staleTime: Infinity,
  });

  // Only the active tab's query runs (decision 2)
  const listQuery = useQuery({
    queryKey: projectKeys.resources(projectId, type, term || undefined),
    queryFn: ({ signal }) =>
      fetchResources(projectId, type, term || undefined, { signal }),
    staleTime: Infinity,
  });

  const state = asyncStateOf(listQuery, {
    isEmpty: (data) => data.length === 0,
  });

  const tabDef = TAB_BY_TYPE.get(type)!;

  return (
    <main className="p-6">
      <nav data-testid="resource-tabs" aria-label="Resource types">
        {TABS.map((tab) => (
          <NavLink
            key={tab.type}
            to={`/project/${projectId}/resource/${tab.type}`}
            className={({ isActive }) =>
              isActive ? "font-bold aria-current-page" : ""
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4">
        <CollectionToolbar
          placeholder={"search " + tabDef.label.toLowerCase()}
          value={search}
          onChange={setSearch}
        />
      </div>

      <div className="mt-4">
        <AsyncBoundary
          state={state}
          what={tabDef.label.toLowerCase()}
          message={
            listQuery.error instanceof Error
              ? listQuery.error.message
              : undefined
          }
        >
          {listQuery.data && (
            <Table data-testid="resource-table">
              <TableHeader>
                <TableRow>
                  {COLUMN_HEADERS[type].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.data.map((r) => (
                  <TableRow
                    key={r.id}
                    data-resource-id={r.id}
                    onClick={() => setSelected(r)}
                  >
                    {renderCells(r, type)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AsyncBoundary>
      </div>

      {selected && (
        <DetailPane
          title={selected.name}
          rows={detailRows(selected)}
          onClose={() => setSelected(null)}
        >
          {detailQuery.data && (
            <>
              {/* Extra fields from the detail endpoint (e.g. publication) */}
              {detailQuery.data.type === "repository" &&
                detailQuery.data.publication !== null && (
                  <div className="mt-2">
                    <dt className="text-muted-foreground">Publication</dt>
                    <dd>{publicationLabel(detailQuery.data.publication)}</dd>
                  </div>
                )}
            </>
          )}
        </DetailPane>
      )}
    </main>
  );
}
