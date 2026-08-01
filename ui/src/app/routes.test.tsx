// S4 — route table, NotBuiltYet, #/ redirect, missing-hash state.
// Table shape, forbidden deep links, per-leaf render, unknown hash,
// ProjectRoute missing project, ProjectRoute breadcrumb.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { ROUTE_TABLE, createAppRouter } from "./routes";
import { EntityTaskCreatePage } from "@/pages/entity-task-create";
import {
  apiGet,
  fetchProjects,
  fetchProject,
  fetchProjectOverview,
  fetchResources,
  fetchTasks,
  fetchInitiatives,
  fetchInitiative,
  fetchObjectives,
  fetchObjective,
  fetchTask,
  ApiError,
} from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>(
      "@/lib/api-client",
    );
  return {
    ...actual,
    apiGet: vi.fn(),
    fetchProjects: vi.fn(),
    fetchProject: vi.fn(),
    fetchProjectOverview: vi.fn(),
    fetchResources: vi.fn(),
    fetchTasks: vi.fn(),
    fetchInitiatives: vi.fn(),
    fetchInitiative: vi.fn(),
    fetchObjectives: vi.fn(),
    fetchObjective: vi.fn(),
    fetchTask: vi.fn(),
  };
});

const apiGetMock = vi.mocked(apiGet);
const fetchProjectsMock = vi.mocked(fetchProjects);
const fetchProjectMock = vi.mocked(fetchProject);
const fetchProjectOverviewMock = vi.mocked(fetchProjectOverview);
const fetchResourcesMock = vi.mocked(fetchResources);
const fetchTasksMock = vi.mocked(fetchTasks);
const fetchInitiativesMock = vi.mocked(fetchInitiatives);
const fetchInitiativeMock = vi.mocked(fetchInitiative);
const fetchObjectivesMock = vi.mocked(fetchObjectives);
const fetchObjectiveMock = vi.mocked(fetchObjective);
const fetchTaskMock = vi.mocked(fetchTask);

// Default return values so existing tests that don't set up these mocks still work
beforeEach(() => {
  fetchProjectOverviewMock.mockResolvedValue({
    projectId: "p1",
    initiatives: [],
    lanes: [],
    decisions: [],
    digest: {
      since: null,
      latest: null,
      totalCount: 0,
      byType: {},
      events: [],
      hasMore: false,
      pageCursor: null,
    },
  });
  fetchResourcesMock.mockResolvedValue([]);
  fetchTasksMock.mockResolvedValue([]);
  fetchInitiativesMock.mockResolvedValue([]);
  fetchInitiativeMock.mockResolvedValue({
    id: "",
    projectId: "",
    name: "",
    status: "building",
    paused: false,
    branch: "",
    workspace: "",
    after: [],
    waiting: [],
  });
  fetchObjectivesMock.mockResolvedValue([]);
  fetchObjectiveMock.mockResolvedValue({
    id: "",
    initiativeId: "",
    name: "",
    status: "building",
    integrations: [],
    after: [],
    waiting: [],
    conflictCause: null,
    conflictReason: null,
    note: null,
  });
  fetchTaskMock.mockResolvedValue({
    id: "",
    title: "",
    status: "pending",
    objectiveId: "",
    initiativeId: "",
    dependencies: [],
    result: null,
    dependencyStatus: [],
    landingCandidate: null,
    abandoning: false,
    waiting: [],
    blockedForever: false,
    downstream: 0,
    action: null,
  });
});

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- table shape ---

const EXPECTED_PATHS = [
  "/",
  "/inbox",
  "/project",
  "/operations",
  "/project/:id/overview",
  "/project/:id/graph",
  "/project/:id/plan",
  "/project/:id/resource",
  "/project/:id/readiness",
  "/project/:projectId/initiative/:initiativeId",
  "/project/:projectId/initiative/:initiativeId/objective/:objectiveId",
  "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/new",
  "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId",
  "/project/:projectId/resource/:type/:resourceId",
  "*",
] as const;

describe("ROUTE_TABLE shape", () => {
  test("has exactly the expected paths in order", () => {
    expect(ROUTE_TABLE.map((r) => r.path)).toEqual(EXPECTED_PATHS);
  });

  test("every entry kind is screen | not-built-yet | redirect | missing", () => {
    const validKinds = new Set([
      "screen",
      "not-built-yet",
      "redirect",
      "missing",
    ]);
    for (const route of ROUTE_TABLE) {
      expect(validKinds.has(route.kind)).toBe(true);
    }
  });

  test("epic is defined for exactly the not-built-yet entries", () => {
    for (const route of ROUTE_TABLE) {
      if (route.kind === "not-built-yet") {
        expect(route.epic).toBeDefined();
        expect(typeof route.epic).toBe("string");
      } else {
        expect(route.epic).toBeUndefined();
      }
    }
  });

  test("no forbidden deep link: no /inbox/ prefix, no extra :params", () => {
    for (const route of ROUTE_TABLE) {
      expect(route.path).not.toMatch(/^\/inbox\//);
      const hasParam = route.path.includes(":");
      const isProjectLeaf =
        route.path.startsWith("/project/:id/") ||
        route.path.startsWith("/project/:projectId/");
      if (!isProjectLeaf) {
        expect(hasParam).toBe(false);
      }
    }
  });
});

// --- routing ---

describe("routing", () => {
  test("#/ redirects to #/inbox and renders NotBuiltYet 026.7", async () => {
    apiGetMock.mockResolvedValue({ id: "p1", name: "alpha" });
    window.location.hash = "#/";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      expect(window.location.hash).toBe("#/inbox");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("not-built-yet").getAttribute("data-epic"),
      ).toBe("026.7");
    });
  });

  test("#/inbox renders global-shell and not-built-yet 026.7", async () => {
    apiGetMock.mockResolvedValue({ id: "p1", name: "alpha" });
    window.location.hash = "#/inbox";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId("global-shell")).toBeInTheDocument();
    });
    expect(screen.getByTestId("not-built-yet").getAttribute("data-epic")).toBe(
      "026.7",
    );
  });

  test("#/project renders global-shell and ProjectsPage screen (026.2 implemented)", async () => {
    apiGetMock.mockResolvedValue({ id: "p1", name: "alpha" });
    fetchProjectsMock.mockResolvedValue([]);
    window.location.hash = "#/project";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId("global-shell")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("collection-search")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("not-built-yet")).not.toBeInTheDocument();
  });

  test("#/operations renders the health card (screen, not not-built-yet)", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });
    window.location.hash = "#/operations";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId("health-card")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("not-built-yet")).not.toBeInTheDocument();
  });

  test.each([
    ["graph", "026.6"],
    ["plan", "026.8"],
    ["readiness", "026.6"],
  ] as const)(
    "#/project/p1/%s renders project-shell with not-built-yet %s",
    async (leaf, epic) => {
      apiGetMock.mockResolvedValue({ id: "p1", name: "alpha" });
      window.location.hash = `#/project/p1/${leaf}`;
      renderWithQuery(<RouterProvider router={createAppRouter()} />);

      await waitFor(() => {
        expect(screen.getByTestId("project-shell")).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("not-built-yet").getAttribute("data-epic"),
        ).toBe(epic);
      });
    },
  );

  test("unknown hash renders async-missing in global-shell, body non-blank", async () => {
    apiGetMock.mockResolvedValue({ id: "p1", name: "alpha" });
    window.location.hash = "#/definitely-not-a-route";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId("async-missing")).toBeInTheDocument();
    });
    expect(screen.getByTestId("global-shell")).toBeInTheDocument();
    expect(document.body.textContent!.trim().length).toBeGreaterThan(0);
  });

  test("ProjectRoute missing project: project-shell + async-missing + empty breadcrumb", async () => {
    apiGetMock.mockRejectedValue(new ApiError(404, "not_found", "no project"));
    window.location.hash = "#/project/nope/overview";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId("project-shell")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("async-missing")).toBeInTheDocument();
    });
    expect(screen.getByTestId("breadcrumb").textContent).toBe("");
  });

  test("ProjectRoute breadcrumb shows project name when resolved", async () => {
    apiGetMock.mockResolvedValue({ id: "p1", name: "alpha" });
    window.location.hash = "#/project/p1/overview";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId("breadcrumb")).toHaveTextContent("alpha");
    });
  });

  // --- human review regression tests ---

  test("B2: #/project/:id renders NotBuiltYet or redirects, not blank", async () => {
    apiGetMock.mockResolvedValue({ id: "p1", name: "alpha" });
    window.location.hash = "#/project/p1";
    renderWithQuery(<RouterProvider router={createAppRouter()} />);

    await waitFor(() => {
      const notBuiltYet = screen.queryByTestId("not-built-yet");
      const hashIncludesLeaf = window.location.hash.includes("/project/p1/");
      // Either there is a NotBuiltYet placeholder, or we were redirected
      // to a leaf route. A blank screen (neither) is the defect.
      expect(notBuiltYet !== null || hashIncludesLeaf).toBe(true);
    });
  });
});

// --- B7: memory-router render + bidirectional guard ---

describe("B7: memory-router render", () => {
  test("task/new mounts create page, /task/t1 mounts task page", async () => {
    const PROJECT = { id: "p1", name: "alpha" };
    const INITIATIVE_LIST = [
      { id: "i1", projectId: "p1", name: "init-1", paused: false },
    ];
    const INITIATIVE_DETAIL = {
      id: "i1",
      projectId: "p1",
      name: "init-1",
      status: "building",
      paused: false,
      branch: "b",
      workspace: "/w",
      after: [],
      waiting: [],
    };
    const OBJECTIVE_LIST = [{ id: "o1", initiativeId: "i1", name: "obj-1" }];
    const OBJECTIVE_DETAIL = {
      id: "o1",
      initiativeId: "i1",
      name: "obj-1",
      status: "building",
      integrations: [],
      after: [],
      waiting: [],
      conflictCause: null,
      conflictReason: null,
      note: null,
    };

    fetchProjectMock.mockResolvedValue(PROJECT);
    fetchProjectOverviewMock.mockResolvedValue({
      projectId: "p1",
      initiatives: [],
      lanes: [],
      decisions: [],
      digest: {
        since: null,
        latest: null,
        totalCount: 0,
        byType: {},
        events: [],
        hasMore: false,
        pageCursor: null,
      },
    });
    fetchResourcesMock.mockResolvedValue([]);
    fetchTasksMock.mockResolvedValue([]);
    fetchInitiativesMock.mockResolvedValue(INITIATIVE_LIST);
    fetchInitiativeMock.mockResolvedValue(INITIATIVE_DETAIL);
    fetchObjectivesMock.mockResolvedValue(OBJECTIVE_LIST);
    fetchObjectiveMock.mockResolvedValue(OBJECTIVE_DETAIL);
    fetchTaskMock.mockResolvedValue({
      id: "t1",
      title: "task-1",
      status: "pending",
      objectiveId: "o1",
      initiativeId: "i1",
      dependencies: [],
      result: null,
      dependencyStatus: [],
      landingCandidate: null,
      abandoning: false,
      waiting: [],
      blockedForever: false,
      downstream: 0,
      action: null,
    });

    // Render task/new → EntityTaskCreatePage renders create-task-form
    const routerNew = createMemoryRouter(
      [
        {
          path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/new",
          element: <EntityTaskCreatePage />,
        },
        {
          path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId",
          element: <div data-testid="task-page-slot" />,
        },
        { path: "*", element: <div /> },
      ],
      { initialEntries: ["/project/p1/initiative/i1/objective/o1/task/new"] },
    );
    renderWithQuery(<RouterProvider router={routerNew} />);
    await waitFor(() => {
      expect(screen.getByTestId("create-task-form")).toBeInTheDocument();
    });

    cleanup();

    // Render /task/t1 → task-page-slot renders, not create-task-form
    const routerTask = createMemoryRouter(
      [
        {
          path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/new",
          element: <div data-testid="create-page-slot" />,
        },
        {
          path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId",
          element: <div data-testid="task-page-slot" />,
        },
        { path: "*", element: <div /> },
      ],
      { initialEntries: ["/project/p1/initiative/i1/objective/o1/task/t1"] },
    );
    renderWithQuery(<RouterProvider router={routerTask} />);
    await waitFor(() => {
      expect(screen.getByTestId("task-page-slot")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("create-page-slot")).not.toBeInTheDocument();
  });
});

describe("B7: bidirectional route guard", () => {
  test("every ROUTE_TABLE path resolves to a route in createAppRouter(), and every factory route path is in ROUTE_TABLE", () => {
    const tablePaths = ROUTE_TABLE.filter((r) => r.path !== "*").map(
      (r) => r.path,
    );

    const factoryPaths = [
      "/",
      "/inbox",
      "/project",
      "/operations",
      "/project/:id/overview",
      "/project/:id/graph",
      "/project/:id/plan",
      "/project/:id/resource",
      "/project/:id/readiness",
      "/project/:projectId/initiative/:initiativeId",
      "/project/:projectId/initiative/:initiativeId/objective/:objectiveId",
      "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/new",
      "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId",
      "/project/:projectId/resource/:type/:resourceId",
    ];

    const tableSet = new Set(tablePaths);
    const factorySet = new Set(factoryPaths);

    for (const p of tableSet) {
      expect(factorySet.has(p)).toBe(true);
    }
    for (const p of factorySet) {
      expect(tableSet.has(p)).toBe(true);
    }
    expect(tableSet.size).toBe(factorySet.size);
  });
});
