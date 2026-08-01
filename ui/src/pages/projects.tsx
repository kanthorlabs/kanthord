// Story 03 + Story 04: ProjectsPage with server-side search and write controls.
// Decision 3: search is server-side only; no client-side filtering.
// Decision 9: detail pane is read-only.
import { useState } from "react";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";

import { AsyncBoundary } from "@/components/async-boundary";
import { CollectionToolbar } from "@/components/collection-toolbar";
import { CreateProject } from "@/components/create-project";
import { DetailPane } from "@/components/detail-pane";
import { RenameProject } from "@/components/rename-project";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchProjects } from "@/lib/api-client";
import { projectKeys } from "@/lib/query-keys";
import { asyncStateOf } from "@/lib/async-state";
import {
  useDebouncedValue,
  SEARCH_DEBOUNCE_MS,
} from "@/lib/use-debounced-value";
import type { ProjectDto } from "@/lib/dto";

export function ProjectsPage(): ReactElement {
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const [selected, setSelected] = useState<ProjectDto | null>(null);

  const query = useQuery({
    queryKey: projectKeys.list(term || undefined),
    queryFn: ({ signal }) => fetchProjects(term || undefined, { signal }),
  });

  const state = asyncStateOf(query, { isEmpty: (data) => data.length === 0 });

  return (
    <main className="p-6">
      <h1 className="mb-4 text-2xl font-bold">Projects</h1>
      <CollectionToolbar
        placeholder="search projects"
        value={search}
        onChange={setSearch}
        actions={<CreateProject />}
      />
      <div className="mt-4">
        <AsyncBoundary
          state={state}
          what="projects"
          message={
            query.error instanceof Error ? query.error.message : undefined
          }
        >
          {query.data && (
            <Table data-testid="project-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Id</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((p) => (
                  <TableRow
                    key={p.id}
                    data-project-id={p.id}
                    onClick={() => setSelected(p)}
                  >
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.id}</TableCell>
                    <TableCell>
                      <RenameProject projectId={p.id} name={p.name} />
                    </TableCell>
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
          rows={[
            { label: "Name", value: selected.name },
            { label: "Id", value: selected.id },
          ]}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
