// S4 — route table, hash router, NotBuiltYet, #/ redirect, missing-hash state.
// Decision 4: only settled top-level routes are registered.
// Decision 5: placeholders are an honest unavailable state.
// Decision 6: #/ redirects to #/inbox.
import type { ReactElement } from "react";
import type { QueryClient } from "@tanstack/react-query";
import {
  Navigate,
  Outlet,
  createHashRouter,
  useParams,
} from "react-router-dom";

import { OperationsPage } from "@/pages/operations";
import { NotBuiltYet } from "@/components/not-built-yet";
import { GlobalShell, ProjectShell } from "@/components/shell";
import { AsyncBoundary } from "@/components/async-boundary";
import { asyncStateOf } from "@/lib/async-state";
import { useProjectSummary, healthQueryOptions } from "@/lib/queries";

// --- route table shape (data, not the router config) ---

export type RouteKind = "screen" | "not-built-yet" | "redirect" | "missing";

export interface AppRoute {
  readonly path: string;
  readonly kind: RouteKind;
  readonly epic?: string;
}

export const ROUTE_TABLE: readonly AppRoute[] = [
  { path: "/", kind: "redirect" },
  { path: "/inbox", kind: "not-built-yet", epic: "026.7" },
  { path: "/project", kind: "not-built-yet", epic: "026.2" },
  { path: "/operations", kind: "screen" },
  { path: "/project/:id/overview", kind: "not-built-yet", epic: "026.2" },
  { path: "/project/:id/graph", kind: "not-built-yet", epic: "026.6" },
  { path: "/project/:id/plan", kind: "not-built-yet", epic: "026.8" },
  { path: "/project/:id/resource", kind: "not-built-yet", epic: "026.5" },
  { path: "/project/:id/readiness", kind: "not-built-yet", epic: "026.6" },
  { path: "*", kind: "missing" },
];

// --- layout components ---

/** GlobalShell layout: wraps non-project routes. */
function GlobalShellLayout(): ReactElement {
  return (
    <GlobalShell>
      <Outlet />
    </GlobalShell>
  );
}

/** ProjectRoute: reads :id, fetches project, renders ProjectShell with breadcrumb. */
function ProjectRoute(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const project = useProjectSummary(id!);
  const state = asyncStateOf(project);

  const segments: readonly string[] =
    state === "resolved" && project.data ? [project.data.name] : [];

  return (
    <ProjectShell projectId={id!} segments={segments}>
      {state === "resolved" ? (
        <Outlet />
      ) : (
        <AsyncBoundary state={state} what="project" />
      )}
    </ProjectShell>
  );
}

// --- router factory ---

export function createAppRouter(queryClient?: QueryClient) {
  return createHashRouter([
    { path: "/", element: <Navigate to="/inbox" replace /> },
    {
      element: <GlobalShellLayout />,
      children: [
        {
          path: "/inbox",
          element: <NotBuiltYet surface="Inbox" epic="026.7" />,
        },
        {
          path: "/project",
          element: <NotBuiltYet surface="Projects" epic="026.2" />,
        },
        {
          path: "*",
          element: <AsyncBoundary state="missing" what="page" />,
        },
      ],
    },
    // OperationsPage renders its own GlobalShell (S6 — freshness slot).
    // The loader prefetches health data so the card is committed by the time
    // Playwright's networkidle fires — no loading→resolved split commit.
    {
      path: "/operations",
      loader: queryClient
        ? async () => {
            await queryClient.prefetchQuery(healthQueryOptions());
            return null;
          }
        : undefined,
      element: <OperationsPage />,
    },
    {
      path: "/project/:id",
      element: <ProjectRoute />,
      children: [
        { index: true, element: <Navigate to="overview" replace /> },
        {
          path: "overview",
          element: <NotBuiltYet surface="Overview" epic="026.2" />,
        },
        {
          path: "graph",
          element: <NotBuiltYet surface="Graph" epic="026.6" />,
        },
        {
          path: "plan",
          element: <NotBuiltYet surface="Plan" epic="026.8" />,
        },
        {
          path: "resource",
          element: <NotBuiltYet surface="Resources" epic="026.5" />,
        },
        {
          path: "readiness",
          element: <NotBuiltYet surface="Readiness" epic="026.6" />,
        },
      ],
    },
  ]);
}
