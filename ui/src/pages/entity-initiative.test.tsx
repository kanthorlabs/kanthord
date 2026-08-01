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
  fetchInitiatives,
  fetchInitiative,
  fetchObjectives,
} from "@/lib/api-client";
import { EntityInitiativePage } from "@/pages/entity-initiative";
import type { InitiativeDetailDto } from "@/lib/dto";

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
    fetchInitiatives: vi.fn(),
    fetchInitiative: vi.fn(),
    fetchObjectives: vi.fn(),
  };
});

const apiGetMock = vi.mocked(apiGet);
const fetchProjectsMock = vi.mocked(fetchProjects);
const fetchProjectMock = vi.mocked(fetchProject);
const fetchProjectOverviewMock = vi.mocked(fetchProjectOverview);
const fetchResourcesMock = vi.mocked(fetchResources);
const fetchInitiativesMock = vi.mocked(fetchInitiatives);
const fetchInitiativeMock = vi.mocked(fetchInitiative);
const fetchObjectivesMock = vi.mocked(fetchObjectives);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.location.hash = "";
});

const ROUTE_TREE = [
  {
    path: "/project/:projectId/initiative/:initiativeId",
    element: <EntityInitiativePage />,
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
const INITIATIVE_DETAIL: InitiativeDetailDto = {
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
const INITIATIVE_DETAIL_PAUSED = {
  ...INITIATIVE_DETAIL,
  paused: true,
};
const INITIATIVE_DETAIL_NO_WORKSPACE = {
  ...INITIATIVE_DETAIL,
  workspace: undefined,
};
const OBJECTIVE_LIST = [
  { id: "o1", initiativeId: "i1", name: "obj-1" },
  { id: "o2", initiativeId: "i1", name: "obj-2", status: "building" },
];

function mockAll(overrides?: {
  initiativeDetail?: typeof INITIATIVE_DETAIL;
  objectiveList?: typeof OBJECTIVE_LIST;
}) {
  const initDetail = overrides?.initiativeDetail ?? INITIATIVE_DETAIL;
  const objList = overrides?.objectiveList ?? OBJECTIVE_LIST;

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
  fetchInitiativeMock.mockResolvedValue(initDetail);
  fetchObjectivesMock.mockResolvedValue(objList);
}

function initiativeUrl(params?: { paused?: boolean; workspace?: string }) {
  if (params?.paused) {
    mockAll({ initiativeDetail: INITIATIVE_DETAIL_PAUSED });
  } else if (params?.workspace === undefined) {
    mockAll({ initiativeDetail: INITIATIVE_DETAIL_NO_WORKSPACE });
  } else {
    mockAll();
  }

  const router = createMemoryRouter(ROUTE_TREE, {
    initialEntries: ["/project/p1/initiative/i1"],
  });
  renderWithQuery(<RouterProvider router={router} />);
}

// --- tests ---

describe("initiative workspace tabs", () => {
  test("tab strip is exactly Summary, Objectives, Dependencies and Summary is default", async () => {
    initiativeUrl();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Summary", "Objectives", "Dependencies"]);
    // Summary tab is selected by default (has aria-selected=true)
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // --- Summary panel ---

  describe("Summary panel", () => {
    test("paused true renders initiative-paused with text paused", async () => {
      initiativeUrl({ paused: true });
      await waitFor(() => {
        expect(screen.getByTestId("initiative-paused")).toHaveTextContent(
          "paused",
        );
      });
    });

    test("paused false renders initiative-paused with text running", async () => {
      initiativeUrl();
      await waitFor(() => {
        expect(screen.getByTestId("initiative-paused")).toHaveTextContent(
          "running",
        );
      });
    });

    test("branch renders kanthord/init/i1", async () => {
      initiativeUrl();
      await waitFor(() => {
        expect(screen.getByTestId("initiative-branch")).toHaveTextContent(
          "kanthord/init/i1",
        );
      });
    });

    test("workspace present renders initiative-workspace with the value", async () => {
      initiativeUrl({ workspace: "/w/x" });
      await waitFor(() => {
        expect(screen.getByTestId("initiative-workspace")).toHaveTextContent(
          "/w/x",
        );
      });
    });

    test("workspace absent renders empty-workspace and no initiative-workspace", async () => {
      initiativeUrl({ workspace: undefined });
      await waitFor(() => {
        expect(screen.getByTestId("empty-workspace")).toHaveTextContent(
          "Not specified.",
        );
      });
      expect(
        screen.queryByTestId("initiative-workspace"),
      ).not.toBeInTheDocument();
    });
  });

  // --- Objectives panel ---

  describe("Objectives panel", () => {
    test("empty: fetchObjectives resolves [] → empty-objectives, no objective-table", async () => {
      mockAll({ objectiveList: [] });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Objectives" }),
        ).toBeInTheDocument();
      });

      // Click Objectives tab
      await userEvent.click(screen.getByRole("tab", { name: "Objectives" }));

      await waitFor(() => {
        expect(screen.getByTestId("empty-objectives")).toHaveTextContent(
          "No objectives yet.",
        );
      });
      expect(screen.queryByTestId("objective-table")).not.toBeInTheDocument();
    });

    test("error: fetchObjectives rejects → async-error in panel, entity-header still present", async () => {
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
      fetchObjectivesMock.mockRejectedValue(
        new ApiError(503, "unavailable", "down"),
      );

      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Objectives" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Objectives" }));

      await waitFor(() => {
        expect(screen.getByTestId("async-error")).toBeInTheDocument();
      });
      // entity-header is still present with Summary tab intact
      expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    });

    test("two rows: rows in mocked order, first link href ends with /objective/o1, absent status defaults to building", async () => {
      mockAll();
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Objectives" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Objectives" }));

      await waitFor(() => {
        expect(screen.getByTestId("objective-table")).toBeInTheDocument();
      });

      const rows = screen
        .getAllByTestId("objective-table")
        .flatMap((t) =>
          Array.from(t.querySelectorAll<HTMLElement>("[data-objective-id]")),
        );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.getAttribute("data-objective-id")).toBe("o1");
      expect(rows[1]!.getAttribute("data-objective-id")).toBe("o2");

      // First row link
      const link1 = rows[0]!.querySelector("a");
      expect(link1).toBeDefined();
      expect(link1!.getAttribute("href")).toBe(
        "/project/p1/initiative/i1/objective/o1",
      );

      // Second row has status building (absent status key defaults)
      const statusChip2 = rows[1]!.querySelector("[data-value]");
      expect(statusChip2).not.toBeNull();
      expect(statusChip2!.getAttribute("data-value")).toBe("building");
    });
  });

  // --- Dependencies panel ---

  describe("Dependencies panel", () => {
    test("empty: after=[], waiting=[] → empty-initiative-dependencies, panel text non-empty", async () => {
      mockAll();
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));

      await waitFor(() => {
        expect(
          screen.getByTestId("empty-initiative-dependencies"),
        ).toHaveTextContent("No dependencies.");
      });
    });

    test("populated: after=[iA,iB], waiting=[{id:iA, neverSatisfies:true}] → correct sections", async () => {
      const INITIATIVE_DEPS = {
        ...INITIATIVE_DETAIL,
        after: ["iA", "iB"],
        waiting: [{ id: "iA", neverSatisfies: true }],
      };
      mockAll({ initiativeDetail: INITIATIVE_DEPS });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));

      await waitFor(() => {
        const afterSection = screen.getByTestId("initiative-after");
        const afterIds = afterSection.querySelectorAll(
          "[data-testid='after-id']",
        );
        expect(afterIds).toHaveLength(2);
        expect(afterIds[0]).toHaveTextContent("iA");
        expect(afterIds[1]).toHaveTextContent("iB");
      });

      const waitingSection = screen.getByTestId("initiative-waiting");
      const waitingIds = waitingSection.querySelectorAll(
        "[data-testid='waiting-id']",
      );
      expect(waitingIds).toHaveLength(1);
      expect(waitingIds[0]).toHaveTextContent("iA");
      expect(screen.getByTestId("waiting-never")).toHaveTextContent(
        "This dependency can never be satisfied.",
      );
    });

    test("after=[iA] with waiting=[] → empty-waiting reads None, no waiting-never", async () => {
      const INITIATIVE_AFTER_ONLY = {
        ...INITIATIVE_DETAIL,
        after: ["iA"],
        waiting: [],
      };
      mockAll({ initiativeDetail: INITIATIVE_AFTER_ONLY });
      const router = createMemoryRouter(ROUTE_TREE, {
        initialEntries: ["/project/p1/initiative/i1"],
      });
      renderWithQuery(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));

      await waitFor(() => {
        expect(screen.getByTestId("empty-waiting")).toHaveTextContent("None.");
      });
      expect(screen.queryByTestId("waiting-never")).not.toBeInTheDocument();
    });
  });

  // --- only one panel mounted ---

  test("clicking Dependencies removes objective-table from DOM", async () => {
    mockAll();
    const router = createMemoryRouter(ROUTE_TREE, {
      initialEntries: ["/project/p1/initiative/i1"],
    });
    renderWithQuery(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: "Dependencies" }),
      ).toBeInTheDocument();
    });

    // Click Objectives first to mount its table
    await userEvent.click(screen.getByRole("tab", { name: "Objectives" }));
    await waitFor(() => {
      expect(screen.getByTestId("objective-table")).toBeInTheDocument();
    });

    // Click Dependencies — objective-table should be gone
    await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
    await waitFor(() => {
      expect(screen.queryByTestId("objective-table")).not.toBeInTheDocument();
    });
  });

  // --- write controls (026.4 S5 — rename) ---

  test("rename: Rename button renders as rename-open, no other mutation controls", async () => {
    initiativeUrl();
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toBeInTheDocument();
    });

    // Rename button (from RenameInitiative) renders
    const renameBtn = screen.getByTestId("rename-open");
    expect(renameBtn).toBeInTheDocument();
    expect(renameBtn).toHaveTextContent("Rename");

    // No other mutation buttons (no new, create, delete, pause, resume)
    const mutationPattern = /new|create|edit|delete|pause|resume/i;
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      if (btn === renameBtn) continue;
      expect(btn.textContent).not.toMatch(mutationPattern);
    }
    const links = screen.queryAllByRole("link");
    for (const link of links) {
      expect(link.textContent).not.toMatch(mutationPattern);
    }
  });

  // --- B8: DependencyEditor mounts in Dependencies tab ---

  test("B8: DependencyEditor mounts in Dependencies tab with kind initiative; tab set unchanged; dependency-add present when zero edges", async () => {
    const user = userEvent.setup();
    mockAll({
      initiativeDetail: {
        ...INITIATIVE_DETAIL,
        after: [],
        waiting: [],
      },
    });
    const router = createMemoryRouter(ROUTE_TREE, {
      initialEntries: ["/project/p1/initiative/i1"],
    });
    renderWithQuery(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: "Dependencies" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Dependencies" }));

    await waitFor(() => {
      expect(screen.getByTestId("dependency-add")).toBeInTheDocument();
    });

    // Tab set unchanged
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Summary", "Objectives", "Dependencies"]);

    // dependency-add present when zero edges
    expect(screen.getByTestId("dependency-add")).toBeInTheDocument();

    // Precondition note is always visible
    expect(
      screen.getByTestId("dependency-precondition-note"),
    ).toBeInTheDocument();
  });

  // --- B9: create-objective inside objectives panel ---

  test("B9: create-objective renders inside objectives panel, absent while summary tab active", async () => {
    initiativeUrl();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    });

    // Summary tab is default — create-objective should NOT be present
    expect(screen.queryByTestId("create-objective")).not.toBeInTheDocument();

    // Click Objectives tab
    await userEvent.click(screen.getByRole("tab", { name: "Objectives" }));
    await waitFor(() => {
      expect(screen.getByTestId("create-objective")).toBeInTheDocument();
    });
  });
});
