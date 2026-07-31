import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import {
  apiGet,
  ApiError,
  fetchProjects,
  fetchProject,
  fetchProjectOverview,
  fetchResources,
  fetchResource,
  fetchTasks,
  fetchInitiatives,
  fetchInitiative,
  fetchObjectives,
  fetchObjective,
} from "@/lib/api-client";
import { EntityObjectivePage } from "@/pages/entity-objective";
import type { ObjectiveDetailDto, TaskRowDto, ResourceDto } from "@/lib/dto";

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
    fetchTasks: vi.fn(),
    fetchInitiatives: vi.fn(),
    fetchInitiative: vi.fn(),
    fetchObjectives: vi.fn(),
    fetchObjective: vi.fn(),
  };
});

const apiGetMock = vi.mocked(apiGet);
const fetchProjectsMock = vi.mocked(fetchProjects);
const fetchProjectMock = vi.mocked(fetchProject);
const fetchProjectOverviewMock = vi.mocked(fetchProjectOverview);
const fetchResourcesMock = vi.mocked(fetchResources);
const fetchResourceMock = vi.mocked(fetchResource);
const fetchTasksMock = vi.mocked(fetchTasks);
const fetchInitiativesMock = vi.mocked(fetchInitiatives);
const fetchInitiativeMock = vi.mocked(fetchInitiative);
const fetchObjectivesMock = vi.mocked(fetchObjectives);
const fetchObjectiveMock = vi.mocked(fetchObjective);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.location.hash = "";
});

const ROUTE_TREE = [
  {
    path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId",
    element: <EntityObjectivePage />,
  },
  { path: "*", element: <div /> },
];

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

// --- fixtures ---

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
  branch: "kanthord/init/i1",
  workspace: "/w/x",
  after: [],
  waiting: [],
};
const OBJECTIVE_LIST = [
  { id: "o1", initiativeId: "i1", name: "obj-1" },
  { id: "o2", initiativeId: "i1", name: "obj-2" },
];
const OBJECTIVE_DETAIL: ObjectiveDetailDto = {
  id: "o1",
  initiativeId: "i1",
  name: "obj-1",
  status: "building",
  commitOid: "c1",
  parentOid: "c0",
  note: "take care",
  integrations: [],
  after: [],
  waiting: [],
  conflictCause: null,
  conflictReason: "gate failed",
};

function mockAll(overrides?: {
  objectiveDetail?: typeof OBJECTIVE_DETAIL;
  fetchTasksResult?: TaskRowDto[];
  fetchTasksError?: Error;
  fetchResourceResult?: ResourceDto;
  fetchResourceError?: Error;
  fetchResourcePending?: boolean;
}) {
  // useProjectSummary still calls apiGet directly
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === "/api/project/p1") return PROJECT;
    throw new Error(`unexpected apiGet path: ${path}`);
  });
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
  fetchInitiativesMock.mockResolvedValue(INITIATIVE_LIST);
  fetchInitiativeMock.mockResolvedValue(INITIATIVE_DETAIL);
  fetchObjectivesMock.mockResolvedValue(OBJECTIVE_LIST);
  fetchObjectiveMock.mockResolvedValue(
    overrides?.objectiveDetail ?? OBJECTIVE_DETAIL,
  );

  // tasks mock
  if (overrides?.fetchTasksError) {
    fetchTasksMock.mockRejectedValue(overrides.fetchTasksError);
  } else {
    fetchTasksMock.mockResolvedValue(overrides?.fetchTasksResult ?? []);
  }

  // resource mock
  if (overrides?.fetchResourcePending) {
    fetchResourceMock.mockReturnValue(new Promise(() => {}));
  } else if (overrides?.fetchResourceError) {
    fetchResourceMock.mockRejectedValue(overrides.fetchResourceError);
  } else {
    fetchResourceMock.mockResolvedValue(
      overrides?.fetchResourceResult ?? {
        type: "repository",
        id: "r1",
        name: "repo-1",
        remoteUrl: "https://example.com/repo.git",
        branch: "main",
        path: "/repo",
        auth: { kind: "ambient" as const },
        publication: null,
      },
    );
  }
}

function objectiveUrl() {
  mockAll();
  const router = createMemoryRouter(ROUTE_TREE, {
    initialEntries: ["/project/p1/initiative/i1/objective/o1"],
  });
  renderWithQuery(<RouterProvider router={router} />);
}

// --- tests ---

describe("objective workspace tabs", () => {
  test("tab strip is exactly Summary, Tasks, Integration and Summary is default", async () => {
    objectiveUrl();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Summary", "Tasks", "Integration"]);
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // --- Summary panel ---

  describe("Summary panel", () => {
    test("populated: commitOid, parentOid, note, conflictReason render exact strings", async () => {
      objectiveUrl();
      await waitFor(() => {
        expect(screen.getByTestId("objective-commit-oid")).toHaveTextContent(
          "c1",
        );
      });
      expect(screen.getByTestId("objective-parent-oid")).toHaveTextContent(
        "c0",
      );
      expect(screen.getByTestId("objective-note")).toHaveTextContent(
        "take care",
      );
      expect(screen.getByTestId("objective-conflict-reason")).toHaveTextContent(
        "gate failed",
      );
      // No empty-* elements
      expect(screen.queryByTestId("empty-commit-oid")).not.toBeInTheDocument();
      expect(screen.queryByTestId("empty-parent-oid")).not.toBeInTheDocument();
      expect(screen.queryByTestId("empty-note")).not.toBeInTheDocument();
      expect(screen.queryByTestId("empty-conflict")).not.toBeInTheDocument();
    });

    test("bare: commitOid/parentOid absent, note null, conflictCause null, conflictReason null", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          commitOid: undefined,
          parentOid: undefined,
          note: null,
          conflictCause: null,
          conflictReason: null,
        },
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByTestId("empty-commit-oid")).toHaveTextContent(
          "Not specified.",
        );
      });
      expect(screen.getByTestId("empty-parent-oid")).toHaveTextContent(
        "Not specified.",
      );
      expect(screen.getByTestId("empty-note")).toHaveTextContent(
        "Not specified.",
      );
      expect(screen.getByTestId("empty-conflict")).toHaveTextContent(
        "No conflict recorded.",
      );
      expect(
        screen.queryByTestId("objective-conflict-reason"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("objective-conflict-cause"),
      ).not.toBeInTheDocument();
    });

    test("cause only: conflictCause set, conflictReason null", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          conflictCause: "cas-mismatch",
          conflictReason: null,
        },
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("objective-conflict-cause"),
        ).toHaveTextContent("cas-mismatch");
      });
      expect(screen.queryByTestId("empty-conflict")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("objective-conflict-reason"),
      ).not.toBeInTheDocument();
    });

    test("reason only: conflictReason set, conflictCause null", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          conflictCause: null,
          conflictReason: "gate failed",
        },
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("objective-conflict-reason"),
        ).toHaveTextContent("gate failed");
      });
      expect(
        screen.queryByTestId("objective-conflict-cause"),
      ).not.toBeInTheDocument();
    });

    test("both set: both conflict elements render, empty-conflict absent", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          conflictCause: "cas-mismatch",
          conflictReason: "gate failed",
        },
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("objective-conflict-cause"),
        ).toHaveTextContent("cas-mismatch");
      });
      expect(screen.getByTestId("objective-conflict-reason")).toHaveTextContent(
        "gate failed",
      );
      expect(screen.queryByTestId("empty-conflict")).not.toBeInTheDocument();
    });
  });

  // --- Tasks panel ---

  describe("Tasks panel", () => {
    test("empty: fetchTasks resolves [] → empty-tasks, no task-table", async () => {
      mockAll({ fetchTasksResult: [] });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Tasks" }));

      await waitFor(() => {
        expect(screen.getByTestId("empty-tasks")).toHaveTextContent(
          "No tasks yet.",
        );
      });
      expect(screen.queryByTestId("task-table")).not.toBeInTheDocument();
    });

    test("two rows: rows in mocked order, first link href ends with /project/p1/initiative/i1/objective/o1/task/t1", async () => {
      mockAll({
        fetchTasksResult: [
          {
            id: "t1",
            title: "task-1",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
          {
            id: "t2",
            title: "task-2",
            status: "running",
            state: "paused",
            dependencies: ["t1"],
            waiting: [],
          },
        ],
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Tasks" }));

      await waitFor(() => {
        expect(screen.getByTestId("task-table")).toBeInTheDocument();
      });

      // Verify fetchTasks was called exactly once with correct args
      expect(fetchTasksMock).toHaveBeenCalledTimes(1);
      expect(fetchTasksMock).toHaveBeenCalledWith(
        "i1",
        "o1",
        expect.anything(),
      );

      const rows = screen
        .getAllByTestId("task-table")
        .flatMap((t) =>
          Array.from(t.querySelectorAll<HTMLElement>("[data-task-id]")),
        );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.getAttribute("data-task-id")).toBe("t1");
      expect(rows[1]!.getAttribute("data-task-id")).toBe("t2");

      // First row link
      const link1 = rows[0]!.querySelector("a");
      expect(link1).toBeDefined();
      expect(link1!.getAttribute("href")).toBe(
        "/project/p1/initiative/i1/objective/o1/task/t1",
      );

      // Second row has state "paused"
      const state2 = rows[1]!.querySelector("[data-testid='task-row-state']");
      expect(state2).not.toBeNull();
      expect(state2!).toHaveTextContent("paused");
    });

    test("error: fetchTasks rejects → async-error in panel, no empty-tasks", async () => {
      mockAll({ fetchTasksError: new ApiError(503, "unavailable", "down") });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Tasks" }));

      await waitFor(() => {
        expect(screen.getByTestId("async-error")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("empty-tasks")).not.toBeInTheDocument();
    });

    test("async-empty is never used: with fetchTasks resolving [], async-empty is absent", async () => {
      mockAll({ fetchTasksResult: [] });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Tasks" }));

      await waitFor(() => {
        expect(screen.getByTestId("empty-tasks")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("async-empty")).not.toBeInTheDocument();
    });
  });

  // --- Integration panel ---

  describe("Integration panel", () => {
    test("empty: integrations [] → empty-integration, no integration-table", async () => {
      mockAll();
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Integration" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Integration" }));

      await waitFor(() => {
        expect(screen.getByTestId("empty-integration")).toHaveTextContent(
          "Not integrated yet.",
        );
      });
      expect(screen.queryByTestId("integration-table")).not.toBeInTheDocument();
    });

    test("one element: fetchResource resolves → link text repo-1, href ends with /project/p1/resource/repository/r1, id r1, chip data-value landed", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          integrations: [{ repository: "r1", state: "landed" }],
        },
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Integration" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Integration" }));

      await waitFor(() => {
        expect(screen.getByTestId("integration-table")).toBeInTheDocument();
      });

      const link = screen.getByTestId("integration-repository");
      expect(link).toHaveTextContent("repo-1");
      expect(link.getAttribute("href")).toBe(
        "/project/p1/resource/repository/r1",
      );

      expect(screen.getByTestId("integration-repository-id")).toHaveTextContent(
        "r1",
      );

      const chip = screen.getByTestId("status-chip");
      expect(chip.getAttribute("data-value")).toBe("landed");
    });

    test("name unresolved: fetchResource left pending → link text is r1, row still renders", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          integrations: [{ repository: "r1", state: "landed" }],
        },
        fetchResourcePending: true,
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Integration" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Integration" }));

      await waitFor(() => {
        expect(screen.getByTestId("integration-table")).toBeInTheDocument();
      });

      const link = screen.getByTestId("integration-repository");
      expect(link).toHaveTextContent("r1");
    });

    test("name unresolved: fetchResource rejecting → link text is r1, no async-error in panel", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          integrations: [{ repository: "r1", state: "landed" }],
        },
        fetchResourceError: new ApiError(503, "unavailable", "down"),
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Integration" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Integration" }));

      await waitFor(() => {
        expect(screen.getByTestId("integration-table")).toBeInTheDocument();
      });

      const link = screen.getByTestId("integration-repository");
      expect(link).toHaveTextContent("r1");
      expect(screen.queryByTestId("async-error")).not.toBeInTheDocument();
    });

    test("request budget: fetchResource called exactly once, zero times while Summary is active", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          integrations: [{ repository: "r1", state: "landed" }],
        },
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });

      // Summary is default — fetchResource should not have been called yet
      expect(fetchResourceMock).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("tab", { name: "Integration" }));

      await waitFor(() => {
        expect(fetchResourceMock).toHaveBeenCalledTimes(1);
      });
    });

    test("state outside union: state weird → status-raw reads weird", async () => {
      mockAll({
        objectiveDetail: {
          ...OBJECTIVE_DETAIL,
          integrations: [{ repository: "r1", state: "weird" }],
        },
      });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1/objective/o1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Integration" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Integration" }));

      await waitFor(() => {
        expect(screen.getByTestId("status-raw")).toHaveTextContent("weird");
      });
    });
  });

  // --- only one panel mounted ---

  test("after clicking Integration, task-table is gone; clicking Tasks does not call fetchTasks again", async () => {
    mockAll({
      fetchTasksResult: [
        {
          id: "t1",
          title: "task-1",
          status: "pending",
          state: "runnable",
          dependencies: [],
          waiting: [],
        },
      ],
      objectiveDetail: {
        ...OBJECTIVE_DETAIL,
        integrations: [{ repository: "r1", state: "landed" }],
      },
    });
    const router = createMemoryRouter(ROUTE_TREE, {
      initialEntries: ["/project/p1/initiative/i1/objective/o1"],
    });
    renderWithQuery(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    });

    // Click Tasks first to mount its table
    await userEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    await waitFor(() => {
      expect(screen.getByTestId("task-table")).toBeInTheDocument();
    });

    // Click Integration — task-table should be gone
    await userEvent.click(screen.getByRole("tab", { name: "Integration" }));
    await waitFor(() => {
      expect(screen.queryByTestId("task-table")).not.toBeInTheDocument();
    });

    // Click back to Tasks — should not call fetchTasks again (staleTime: Infinity)
    fetchTasksMock.mockClear();
    await userEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    await waitFor(() => {
      expect(screen.getByTestId("task-table")).toBeInTheDocument();
    });
    expect(fetchTasksMock).not.toHaveBeenCalled();
  });

  // --- no mutation ---

  test("no mutation: no accessible button or link matching mutation patterns, no forms", async () => {
    objectiveUrl();
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toBeInTheDocument();
    });

    const mutationPattern =
      /new|create|edit|rename|delete|approve|reject|retry/i;
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn.textContent).not.toMatch(mutationPattern);
    }
    const links = screen.queryAllByRole("link");
    for (const link of links) {
      expect(link.textContent).not.toMatch(mutationPattern);
    }
    expect(document.querySelectorAll("form")).toHaveLength(0);
  });
});
