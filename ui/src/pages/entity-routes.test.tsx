import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { ROUTE_TABLE } from "@/app/routes";
import {
  apiGet,
  ApiError,
  fetchProjects,
  fetchProject,
  fetchProjectOverview,
  fetchResources,
  fetchResource,
  fetchInitiatives,
  fetchInitiative,
  fetchObjectives,
  fetchObjective,
  fetchTasks,
  fetchTask,
} from "@/lib/api-client";
import type { RepositoryResourceDto } from "@/lib/dto";
import { EntityInitiativePage } from "@/pages/entity-initiative";
import { EntityObjectivePage } from "@/pages/entity-objective";
import { EntityTaskPage } from "@/pages/entity-task";
import { EntityResourcePage } from "@/pages/entity-resource";

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
    fetchResource: vi.fn(),
    fetchInitiatives: vi.fn(),
    fetchInitiative: vi.fn(),
    fetchObjectives: vi.fn(),
    fetchObjective: vi.fn(),
    fetchTasks: vi.fn(),
    fetchTask: vi.fn(),
  };
});

const apiGetMock = vi.mocked(apiGet);
const fetchProjectsMock = vi.mocked(fetchProjects);
const fetchProjectMock = vi.mocked(fetchProject);
const fetchProjectOverviewMock = vi.mocked(fetchProjectOverview);
const fetchResourcesMock = vi.mocked(fetchResources);
const fetchResourceMock = vi.mocked(fetchResource);
const fetchInitiativesMock = vi.mocked(fetchInitiatives);
const fetchInitiativeMock = vi.mocked(fetchInitiative);
const fetchObjectivesMock = vi.mocked(fetchObjectives);
const fetchObjectiveMock = vi.mocked(fetchObjective);
const fetchTasksMock = vi.mocked(fetchTasks);
const fetchTaskMock = vi.mocked(fetchTask);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.location.hash = "";
});

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

// --- ROUTE_TABLE shape ---

const ENTITY_PATHS = [
  "/project/:projectId/initiative/:initiativeId",
  "/project/:projectId/initiative/:initiativeId/objective/:objectiveId",
  "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId",
  "/project/:projectId/resource/:type/:resourceId",
] as const;

describe("ROUTE_TABLE shape", () => {
  test("contains the four new entity paths with kind screen and no epic", () => {
    for (const path of ENTITY_PATHS) {
      const route = ROUTE_TABLE.find((r) => r.path === path);
      expect(route).toBeDefined();
      expect(route!.kind).toBe("screen");
      expect(route!.epic).toBeUndefined();
    }
  });

  test("the entry at index length - 1 still has path *", () => {
    expect(ROUTE_TABLE[ROUTE_TABLE.length - 1]!.path).toBe("*");
  });
});

// --- helper: build a plain path URL from a path pattern ---

function entityPath(template: string, params: Record<string, string>): string {
  let result = template;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(`:${k}`, v);
  }
  return result;
}

// --- entity route tree for memory router ---

const ENTITY_ROUTE_TREE = [
  {
    path: "/project/:projectId/initiative/:initiativeId",
    element: <EntityInitiativePage />,
  },
  {
    path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId",
    element: <EntityObjectivePage />,
  },
  {
    path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId",
    element: <EntityTaskPage />,
  },
  {
    path: "/project/:projectId/resource/:type/:resourceId",
    element: <EntityResourcePage />,
  },
  { path: "*", element: <div /> },
];

// --- happy-path rendering: each of the four entity URLs renders entity-header ---

describe("entity page rendering (happy path)", () => {
  const PROJECT = { id: "p1", name: "alpha" };
  const INITIATIVE_LIST = [
    { id: "i1", projectId: "p1", name: "init-1", paused: false },
  ];
  const OBJECTIVE_LIST = [{ id: "o1", initiativeId: "i1", name: "obj-1" }];
  const INITIATIVE_DETAIL = {
    id: "i1",
    projectId: "p1",
    name: "init-1",
    status: "building",
    paused: false,
    branch: "main",
    after: [],
    waiting: [],
  };
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
  const TASK_DETAIL = {
    id: "t1",
    title: "task-1",
    status: "pending",
    objectiveId: "o1",
    initiativeId: "i1",
    dependencies: [],
    result: null,
    landingCandidate: null,
    abandoning: false,
    waiting: [],
    blockedForever: false,
    downstream: 0,
    action: null,
  };
  const RESOURCE: RepositoryResourceDto = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo-1",
    remoteUrl: "https://example.com",
    branch: "main",
    path: ".",
    auth: { kind: "ambient" as const },
    publication: null,
  };

  function mockAll() {
    // project summary still uses apiGet directly
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/project/p1") return PROJECT;
      throw new Error(`unexpected path: ${path}`);
    });
    // entity-chain named helpers
    fetchInitiativesMock.mockResolvedValue(INITIATIVE_LIST);
    fetchInitiativeMock.mockResolvedValue(INITIATIVE_DETAIL);
    fetchObjectivesMock.mockResolvedValue(OBJECTIVE_LIST);
    fetchObjectiveMock.mockResolvedValue(OBJECTIVE_DETAIL);
    fetchTaskMock.mockResolvedValue(TASK_DETAIL);
    fetchTasksMock.mockResolvedValue([]);
    fetchResourceMock.mockResolvedValue(RESOURCE);
    // page-level helpers
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
    fetchProjectsMock.mockResolvedValue([PROJECT]);
    fetchResourcesMock.mockResolvedValue([]);
  }

  test("initiative URL renders entity-header with initiative name", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[0], {
      projectId: "p1",
      initiativeId: "i1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("init-1");
    });
  });

  test("objective URL renders entity-header with objective name", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[1], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("obj-1");
    });
  });

  test("task URL renders entity-header with task title", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[2], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      taskId: "t1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("task-1");
    });
  });

  test("resource URL renders entity-header with resource name", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[3], {
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("repo-1");
    });
  });
});

// --- scope mismatch and async missing ---

describe("scope mismatch and async missing", () => {
  const PROJECT = { id: "p1", name: "alpha" };
  const INITIATIVE_LIST = [
    { id: "i1", projectId: "p1", name: "init-1", paused: false },
  ];
  const OBJECTIVE_LIST = [{ id: "o1", initiativeId: "i1", name: "obj-1" }];
  const INITIATIVE_DETAIL = {
    id: "i1",
    projectId: "p1",
    name: "init-1",
    status: "building",
    paused: false,
    branch: "main",
    after: [],
    waiting: [],
  };
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

  const INITIATIVE_DETAIL_ZZZ = {
    id: "iZZZ",
    projectId: "p1",
    name: "init-zzz",
    status: "building",
    paused: false,
    branch: "main",
    after: [],
    waiting: [],
  };
  const OBJECTIVE_DETAIL_OZZZ = {
    id: "oZZZ",
    initiativeId: "i1",
    name: "obj-zzz",
    status: "building",
    integrations: [],
    after: [],
    waiting: [],
    conflictCause: null,
    conflictReason: null,
    note: null,
  };
  const RESOURCE_R1: RepositoryResourceDto = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo-1",
    remoteUrl: "https://example.com",
    branch: "main",
    path: ".",
    auth: { kind: "ambient" as const },
    publication: null,
  };

  function mockAll() {
    // project summary still uses apiGet directly
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/project/p1") return PROJECT;
      throw new Error(`unexpected path: ${path}`);
    });
    // entity-chain named helpers
    fetchInitiativesMock.mockResolvedValue(INITIATIVE_LIST);
    fetchInitiativeMock.mockImplementation(async (id: string) => {
      if (id === "i1") return INITIATIVE_DETAIL;
      if (id === "iZZZ") return INITIATIVE_DETAIL_ZZZ;
      throw new Error(`unexpected initiative: ${id}`);
    });
    fetchObjectivesMock.mockImplementation(async (initiativeId: string) => {
      if (initiativeId === "i1") return OBJECTIVE_LIST;
      if (initiativeId === "iZZZ") return [];
      throw new Error(`unexpected initiative: ${initiativeId}`);
    });
    fetchObjectiveMock.mockImplementation(async (id: string) => {
      if (id === "o1") return OBJECTIVE_DETAIL;
      if (id === "oZZZ") return OBJECTIVE_DETAIL_OZZZ;
      throw new Error(`unexpected objective: ${id}`);
    });
    fetchTasksMock.mockResolvedValue([]);
    fetchResourceMock.mockResolvedValue(RESOURCE_R1);
    // page-level helpers
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
    fetchProjectsMock.mockResolvedValue([PROJECT]);
    fetchResourcesMock.mockResolvedValue([]);
  }

  test("task under wrong objective → scope-mismatch data-level=task, zero async-missing, link to correct task URL", async () => {
    mockAll();
    // task detail says objectiveId=oA, but URL says o1
    fetchTaskMock.mockResolvedValue({
      id: "t1",
      title: "task-1",
      status: "pending",
      objectiveId: "oA",
      initiativeId: "i1",
      dependencies: [],
      result: null,
      landingCandidate: null,
      abandoning: false,
      waiting: [],
      blockedForever: false,
      downstream: 0,
      action: null,
    });
    fetchObjectivesMock.mockResolvedValue([
      ...OBJECTIVE_LIST,
      { id: "oA", initiativeId: "i1", name: "obj-A" },
    ]);

    const url = entityPath(ENTITY_PATHS[2], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      taskId: "t1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("scope-mismatch")).toHaveAttribute(
        "data-level",
        "task",
      );
    });
    expect(screen.queryByTestId("async-missing")).not.toBeInTheDocument();
    const link = screen.getByTestId("scope-mismatch-link");
    expect(link.getAttribute("href")).toContain(
      "/project/p1/initiative/i1/objective/oA/task/t1",
    );
  });

  test("made-up task id → async-missing, zero scope-mismatch", async () => {
    mockAll();
    fetchTaskMock.mockRejectedValue(
      new ApiError(404, "unknown_reference", "not found"),
    );

    const url = entityPath(ENTITY_PATHS[2], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      taskId: "unknown",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("async-missing")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("scope-mismatch")).not.toBeInTheDocument();
  });

  test("initiative not in collection → scope-mismatch data-level=initiative", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[0], {
      projectId: "p1",
      initiativeId: "iZZZ",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("scope-mismatch")).toHaveAttribute(
        "data-level",
        "initiative",
      );
    });
  });

  test("objective not in collection → scope-mismatch data-level=objective, entity-header absent", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[1], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "oZZZ",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("scope-mismatch")).toHaveAttribute(
        "data-level",
        "objective",
      );
    });
    expect(screen.queryByTestId("entity-header")).not.toBeInTheDocument();
  });

  test("resource type mismatch → data-level=resource-type", async () => {
    mockAll();
    // Override fetchResource for the resource detail — chain hooks use fetchResource
    fetchResourceMock.mockResolvedValue({
      type: "repository",
      id: "r1",
      projectId: "p1",
      name: "repo-1",
      remoteUrl: "https://example.com",
      branch: "main",
      path: ".",
      auth: { kind: "ambient" },
      publication: null,
    });
    const url = entityPath(ENTITY_PATHS[3], {
      projectId: "p1",
      type: "credential",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("scope-mismatch")).toHaveAttribute(
        "data-level",
        "resource-type",
      );
    });
  });

  test("resource project mismatch → data-level=resource-project", async () => {
    mockAll();
    // Override fetchResource for the resource detail — chain hooks use fetchResource
    fetchResourceMock.mockResolvedValue({
      type: "repository",
      id: "r1",
      projectId: "p2",
      name: "repo-1",
      remoteUrl: "https://example.com",
      branch: "main",
      path: ".",
      auth: { kind: "ambient" },
      publication: null,
    });
    const url = entityPath(ENTITY_PATHS[3], {
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("scope-mismatch")).toHaveAttribute(
        "data-level",
        "resource-project",
      );
    });
  });
});

// --- breadcrumb from real names (Story 02) ---

describe("breadcrumb from real names", () => {
  const PROJECT = { id: "p1", name: "alpha" };
  const INITIATIVE_LIST = [
    { id: "i1", projectId: "p1", name: "init-1", paused: false },
  ];
  const OBJECTIVE_LIST = [{ id: "o1", initiativeId: "i1", name: "obj-1" }];
  const INITIATIVE_DETAIL = {
    id: "i1",
    projectId: "p1",
    name: "init-1",
    status: "building",
    paused: false,
    branch: "main",
    after: [],
    waiting: [],
  };
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
  const TASK_DETAIL = {
    id: "t1",
    title: "main-task",
    status: "pending",
    objectiveId: "o1",
    initiativeId: "i1",
    dependencies: [],
    result: null,
    landingCandidate: null,
    abandoning: false,
    waiting: [],
    blockedForever: false,
    downstream: 0,
    action: null,
  };
  const RESOURCE_R1: RepositoryResourceDto = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo-1",
    remoteUrl: "https://example.com",
    branch: "main",
    path: ".",
    auth: { kind: "ambient" as const },
    publication: null,
  };

  function mockAll() {
    // project summary still uses apiGet directly
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/project/p1") return PROJECT;
      throw new Error(`unexpected path: ${path}`);
    });
    // entity-chain named helpers
    fetchInitiativesMock.mockResolvedValue(INITIATIVE_LIST);
    fetchInitiativeMock.mockResolvedValue(INITIATIVE_DETAIL);
    fetchObjectivesMock.mockResolvedValue(OBJECTIVE_LIST);
    fetchObjectiveMock.mockResolvedValue(OBJECTIVE_DETAIL);
    fetchTaskMock.mockResolvedValue(TASK_DETAIL);
    fetchTasksMock.mockResolvedValue([]);
    fetchResourceMock.mockResolvedValue(RESOURCE_R1);
    // page-level helpers
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
    fetchProjectsMock.mockResolvedValue([PROJECT]);
    fetchResourcesMock.mockResolvedValue([]);
  }

  test("initiative breadcrumb contains real project and initiative names, no ids", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[0], {
      projectId: "p1",
      initiativeId: "i1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      expect(bc.textContent).toContain("alpha");
      expect(bc.textContent).toContain("init-1");
      expect(bc.textContent).not.toContain("p1");
      expect(bc.textContent).not.toContain("i1");
    });
  });

  test("objective breadcrumb contains project, initiative, objective in order", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[1], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      const text = bc.textContent!;
      expect(text).toContain("alpha");
      expect(text).toContain("init-1");
      expect(text).toContain("obj-1");
      expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("init-1"));
      expect(text.indexOf("init-1")).toBeLessThan(text.indexOf("obj-1"));
    });
  });

  test("task breadcrumb contains all four names, ending with task title, no ids", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[2], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      taskId: "t1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      const text = bc.textContent!;
      expect(text).toContain("alpha");
      expect(text).toContain("init-1");
      expect(text).toContain("obj-1");
      expect(text).toContain("main-task");
      expect(text).not.toContain("p1");
      expect(text).not.toContain("i1");
      expect(text).not.toContain("o1");
      expect(text).not.toContain("t1");
    });
  });

  test("resource breadcrumb is exactly alpha, Repositories, repo-1 in order", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[3], {
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      const text = bc.textContent!;
      expect(text).toContain("alpha");
      expect(text).toContain("Repositories");
      expect(text).toContain("repo-1");
      expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("Repositories"));
      expect(text.indexOf("Repositories")).toBeLessThan(text.indexOf("repo-1"));
    });
  });

  test("resource unknown type: breadcrumb contains alpha and repo-1, not the raw type slug", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[3], {
      projectId: "p1",
      type: "not-a-type",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      const text = bc.textContent!;
      expect(text).toContain("alpha");
      expect(text).toContain("repo-1");
      expect(text).not.toContain("not-a-type");
    });
  });

  test("partial resolution: initiative pending → breadcrumb is exactly alpha, async-loading present", async () => {
    // project summary still uses apiGet directly
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/project/p1") return PROJECT;
      throw new Error(`unexpected path: ${path}`);
    });
    // initiative list resolves, but initiative detail hangs (never resolves)
    fetchInitiativesMock.mockResolvedValue(INITIATIVE_LIST);
    fetchInitiativeMock.mockReturnValue(new Promise(() => {})); // never resolves
    // page-level helpers
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
    fetchProjectsMock.mockResolvedValue([PROJECT]);
    fetchResourcesMock.mockResolvedValue([]);

    const url = entityPath(ENTITY_PATHS[0], {
      projectId: "p1",
      initiativeId: "i1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      expect(bc.textContent).toBe("alpha");
    });
    expect(screen.getByTestId("async-loading")).toBeInTheDocument();
  });

  test("scope mismatch: wrong-objective task → breadcrumb still contains alpha and init-1, scope-mismatch present", async () => {
    mockAll();
    // task detail says objectiveId=oA, but URL says o1
    fetchTaskMock.mockResolvedValue({
      id: "t1",
      title: "main-task",
      status: "pending",
      objectiveId: "oA",
      initiativeId: "i1",
      dependencies: [],
      result: null,
      landingCandidate: null,
      abandoning: false,
      waiting: [],
      blockedForever: false,
      downstream: 0,
      action: null,
    });
    fetchObjectivesMock.mockResolvedValue([
      ...OBJECTIVE_LIST,
      { id: "oA", initiativeId: "i1", name: "obj-A" },
    ]);

    const url = entityPath(ENTITY_PATHS[2], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      taskId: "t1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      expect(bc.textContent).toContain("alpha");
      expect(bc.textContent).toContain("init-1");
    });
    expect(screen.getByTestId("scope-mismatch")).toBeInTheDocument();
  });

  test("request budget: task chain fetches each ancestor detail exactly once", async () => {
    mockAll();
    const url = entityPath(ENTITY_PATHS[2], {
      projectId: "p1",
      initiativeId: "i1",
      objectiveId: "o1",
      taskId: "t1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ENTITY_ROUTE_TREE, {
          initialEntries: [url],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent(
        "main-task",
      );
    });
    // Each named chain helper should be called exactly once
    expect(fetchInitiativesMock).toHaveBeenCalledTimes(1);
    expect(fetchInitiativeMock).toHaveBeenCalledTimes(1);
    expect(fetchObjectivesMock).toHaveBeenCalledTimes(1);
    expect(fetchObjectiveMock).toHaveBeenCalledTimes(1);
    expect(fetchTaskMock).toHaveBeenCalledTimes(1);
  });
});

// --- no mutation ---

describe("no mutation", () => {
  const PROJECT = { id: "p1", name: "alpha" };
  const INITIATIVE_LIST = [
    { id: "i1", projectId: "p1", name: "init-1", paused: false },
  ];
  const OBJECTIVE_LIST = [{ id: "o1", initiativeId: "i1", name: "obj-1" }];
  const INITIATIVE_DETAIL = {
    id: "i1",
    projectId: "p1",
    name: "init-1",
    status: "building",
    paused: false,
    branch: "main",
    after: [],
    waiting: [],
  };
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
  const TASK_DETAIL = {
    id: "t1",
    title: "main-task",
    status: "pending",
    objectiveId: "o1",
    initiativeId: "i1",
    dependencies: [],
    result: null,
    landingCandidate: null,
    abandoning: false,
    waiting: [],
    blockedForever: false,
    downstream: 0,
    action: null,
  };
  const RESOURCE: RepositoryResourceDto = {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo-1",
    remoteUrl: "https://example.com",
    branch: "main",
    path: ".",
    auth: { kind: "ambient" as const },
    publication: null,
  };

  function mockAll() {
    // project summary still uses apiGet directly
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/project/p1") return PROJECT;
      throw new Error(`unexpected path: ${path}`);
    });
    // entity-chain named helpers
    fetchInitiativesMock.mockResolvedValue(INITIATIVE_LIST);
    fetchInitiativeMock.mockResolvedValue(INITIATIVE_DETAIL);
    fetchObjectivesMock.mockResolvedValue(OBJECTIVE_LIST);
    fetchObjectiveMock.mockResolvedValue(OBJECTIVE_DETAIL);
    fetchTaskMock.mockResolvedValue(TASK_DETAIL);
    fetchTasksMock.mockResolvedValue([]);
    fetchResourceMock.mockResolvedValue(RESOURCE);
    // page-level helpers
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
    fetchProjectsMock.mockResolvedValue([PROJECT]);
    fetchResourcesMock.mockResolvedValue([]);
  }

  test("no form elements and no mutation-named buttons or links across all entity pages", async () => {
    const MUTATION =
      /new|create|edit|rename|delete|retry|approve|reject|abandon|publish|resume/i;

    const entityUrls = [
      "/project/p1/initiative/i1",
      "/project/p1/initiative/i1/objective/o1",
      "/project/p1/initiative/i1/objective/o1/task/t1",
      "/project/p1/resource/repository/r1",
    ];

    for (const url of entityUrls) {
      mockAll();
      const { unmount } = render(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <RouterProvider
            router={createMemoryRouter(ENTITY_ROUTE_TREE, {
              initialEntries: [url],
            })}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });

      expect(document.querySelectorAll("form")).toHaveLength(0);
      const controls = [
        ...screen.queryAllByRole("button", { name: MUTATION }),
        ...screen.queryAllByRole("link", { name: MUTATION }),
      ];
      for (const c of controls) expect(c).toBeDisabled();

      unmount();
      cleanup();
      vi.restoreAllMocks();
    }
  });
});
