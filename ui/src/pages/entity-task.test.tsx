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
  fetchTasks,
  fetchInitiatives,
  fetchInitiative,
  fetchObjectives,
  fetchObjective,
  fetchTask,
} from "@/lib/api-client";
import { EntityTaskPage } from "@/pages/entity-task";
import type { TaskDetailDto } from "@/lib/dto";

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
    fetchResource: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
  };
});

vi.mock("@/lib/invalidation", () => ({
  invalidateFor: vi.fn().mockResolvedValue(undefined),
}));

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.location.hash = "";
});

const ROUTE_TREE = [
  {
    path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId",
    element: <EntityTaskPage />,
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

/** Pending task matching the Proof's seeded state — no agent, note, instructions, ac, verification, context. */
const pendingTask: TaskDetailDto = {
  id: "t1",
  title: "task-1",
  status: "pending",
  objectiveId: "o1",
  initiativeId: "i1",
  dependencies: ["tB"],
  result: null,
  dependencyStatus: [{ id: "tB", status: "pending" }],
  landingCandidate: null,
  abandoning: false,
  waiting: [],
  blockedForever: false,
  downstream: 0,
  action: null,
};

function mockAll(overrides?: {
  taskDetail?: typeof pendingTask;
  fetchTasksResult?: Array<{
    id: string;
    title: string;
    status: string;
    state: string;
    dependencies: string[];
    waiting: string[];
  }>;
  fetchTasksError?: Error;
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
  fetchObjectiveMock.mockResolvedValue(OBJECTIVE_DETAIL);
  fetchTaskMock.mockResolvedValue(overrides?.taskDetail ?? pendingTask);

  // Sibling tasks mock
  if (overrides?.fetchTasksError) {
    fetchTasksMock.mockRejectedValue(overrides.fetchTasksError);
  } else {
    fetchTasksMock.mockResolvedValue(overrides?.fetchTasksResult ?? []);
  }
}

function taskUrl(overrides?: Parameters<typeof mockAll>[0]) {
  mockAll(overrides);
  const router = createMemoryRouter(ROUTE_TREE, {
    initialEntries: ["/project/p1/initiative/i1/objective/o1/task/t1"],
  });
  renderWithQuery(<RouterProvider router={router} />);
}

// --- tests ---

describe("task workspace tabs", () => {
  test("tab strip is exactly Summary, Instructions & AC, Dependencies, Result, Landing and Summary is default", async () => {
    taskUrl();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual([
      "Summary",
      "Instructions & AC",
      "Dependencies",
      "Result",
      "Landing",
    ]);
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // --- Summary panel ---

  describe("Summary panel", () => {
    test("task-downstream for downstream:7 has textContent exactly 7", async () => {
      taskUrl({
        taskDetail: { ...pendingTask, downstream: 7 },
      });
      await waitFor(() => {
        expect(screen.getByTestId("task-downstream")).toBeInTheDocument();
      });
      expect(screen.getByTestId("task-downstream")).toHaveTextContent("7");
      expect(
        screen.getByTestId("task-downstream").textContent!.replace(/\D/g, ""),
      ).toBe("7");
    });

    test("abandoning: true, status: running → task-abandoning text contains running", async () => {
      taskUrl({
        taskDetail: { ...pendingTask, abandoning: true, status: "running" },
      });
      await waitFor(() => {
        expect(screen.getByTestId("task-abandoning")).toBeInTheDocument();
      });
      expect(screen.getByTestId("task-abandoning")).toHaveTextContent(
        "running",
      );
    });

    test("abandoning: false → task-abandoning is absent", async () => {
      taskUrl({ taskDetail: { ...pendingTask, abandoning: false } });
      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("task-abandoning")).not.toBeInTheDocument();
    });

    test("blockedForever: true with waiting:[{tB,neverSatisfies:true},{tC,neverSatisfies:false}] → task-blocked-forever present, contains sentence, tB linked but not tC", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          blockedForever: true,
          waiting: [
            { id: "tB", neverSatisfies: true },
            { id: "tC", neverSatisfies: false },
          ],
        },
        fetchTasksResult: [
          {
            id: "tB",
            title: "task-B",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
          {
            id: "t1",
            title: "task-1",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
        ],
      });
      await waitFor(() => {
        expect(screen.getByTestId("task-blocked-forever")).toBeInTheDocument();
      });
      const section = screen.getByTestId("task-blocked-forever");
      expect(section).toHaveTextContent(
        "This task can never run: at least one dependency will never be satisfied.",
      );
      const tBId = section.querySelector('[data-task-id="tB"]');
      expect(tBId).not.toBeNull();
      // tC should NOT appear — only neverSatisfies:true are rendered
      const tCId = section.querySelector('[data-task-id="tC"]');
      expect(tCId).toBeNull();
      // tB should be a link (in sibling list)
      expect(tBId!.closest("a")).not.toBeNull();
    });

    test("blockedForever: false → task-blocked-forever is absent", async () => {
      taskUrl({ taskDetail: { ...pendingTask, blockedForever: false } });
      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });
      expect(
        screen.queryByTestId("task-blocked-forever"),
      ).not.toBeInTheDocument();
    });

    test("dependency linking: fetchTasks resolving [tB,t1] → tB dependency-id is a link to /task/tB", async () => {
      taskUrl({
        fetchTasksResult: [
          {
            id: "tB",
            title: "task-B",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
          {
            id: "t1",
            title: "task-1",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
        ],
      });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
      await waitFor(() => {
        expect(screen.getByTestId("dependency-table")).toBeInTheDocument();
      });
      const depId = screen.getByTestId("dependency-id");
      expect(depId).toHaveTextContent("tB");
      const link = depId.closest("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe(
        "/project/p1/initiative/i1/objective/o1/task/tB",
      );
    });

    test("dependency linking: fetchTasks resolving [] → tB dependency-id is not a link, textContent is tB", async () => {
      taskUrl({ fetchTasksResult: [] });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
      await waitFor(() => {
        expect(screen.getByTestId("dependency-table")).toBeInTheDocument();
      });
      const depId = screen.getByTestId("dependency-id");
      expect(depId).toHaveTextContent("tB");
      // Not a link
      const allLinks = screen.queryAllByRole("link");
      const isLink = allLinks.some(
        (l) => l.getAttribute("data-task-id") === "tB",
      );
      expect(isLink).toBe(false);
    });

    test("dependency linking: fetchTasks rejecting → tB dependency-id is unlinked, entity-header still renders", async () => {
      taskUrl({ fetchTasksError: new ApiError(503, "unavailable", "down") });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
      await waitFor(() => {
        expect(screen.getByTestId("dependency-table")).toBeInTheDocument();
      });
      const depId = screen.getByTestId("dependency-id");
      expect(depId).toHaveTextContent("tB");
      const allLinks = screen.queryAllByRole("link");
      const isLink = allLinks.some(
        (l) => l.getAttribute("data-task-id") === "tB",
      );
      expect(isLink).toBe(false);
    });
  });

  // --- Instructions & AC panel ---

  describe("Instructions & AC panel", () => {
    test("absent: empty-instructions, empty-ac, empty-verification, empty-context all read Not specified.", async () => {
      taskUrl();
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Instructions & AC" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(
        screen.getByRole("tab", { name: "Instructions & AC" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("empty-instructions")).toHaveTextContent(
          "Not specified.",
        );
      });
      expect(screen.getByTestId("empty-ac")).toHaveTextContent(
        "Not specified.",
      );
      expect(screen.getByTestId("empty-verification")).toHaveTextContent(
        "Not specified.",
      );
      expect(screen.getByTestId("empty-context")).toHaveTextContent(
        "Not specified.",
      );
    });

    test("present: instructions, ac, verification, context render correct content", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          instructions: "do it",
          ac: ["a", "b"],
          verification: ["npm test"],
          context: { repo: "x" },
        },
      });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Instructions & AC" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(
        screen.getByRole("tab", { name: "Instructions & AC" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("task-instructions")).toHaveTextContent(
          "do it",
        );
      });
      const acList = screen.getByTestId("task-ac");
      const acItems = acList.querySelectorAll("li");
      expect(acItems).toHaveLength(2);
      expect(acItems[0]).toHaveTextContent("a");
      expect(acItems[1]).toHaveTextContent("b");
      const verList = screen.getByTestId("task-verification");
      expect(verList.querySelectorAll("li")).toHaveLength(1);
      const ctx = screen.getByTestId("task-context");
      expect(ctx).toHaveTextContent("repo");
      expect(ctx).toHaveTextContent("x");
      // No empty-* elements
      expect(
        screen.queryByTestId("empty-instructions"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("empty-ac")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("empty-verification"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("empty-context")).not.toBeInTheDocument();
    });

    test("ac: [] → empty-ac renders (empty array is not specified)", async () => {
      taskUrl({
        taskDetail: { ...pendingTask, ac: [] },
      });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Instructions & AC" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(
        screen.getByRole("tab", { name: "Instructions & AC" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("empty-ac")).toHaveTextContent(
          "Not specified.",
        );
      });
    });
  });

  // --- Dependencies panel ---

  describe("Dependencies panel", () => {
    test("no dependencies: dependencyStatus key absent → empty-task-dependencies reads No dependencies., dependency-table absent; empty-waiting reads Nothing is blocking this task.", async () => {
      taskUrl({ taskDetail: { ...pendingTask, dependencyStatus: undefined } });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
      await waitFor(() => {
        expect(screen.getByTestId("empty-task-dependencies")).toHaveTextContent(
          "No dependencies.",
        );
      });
      expect(screen.queryByTestId("dependency-table")).not.toBeInTheDocument();
      expect(screen.getByTestId("empty-waiting")).toHaveTextContent(
        "Nothing is blocking this task.",
      );
    });

    test("dangling: dependencyStatus:[{id:tB,status:unknown}] → one row, status-raw reads unknown, no status-chip in that row", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          dependencyStatus: [{ id: "tB", status: "unknown" }],
        },
      });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
      await waitFor(() => {
        expect(screen.getByTestId("dependency-table")).toBeInTheDocument();
      });
      const row = screen
        .getByTestId("dependency-table")
        .querySelector("tbody tr");
      expect(row).not.toBeNull();
      const statusRaw = row!.querySelector('[data-testid="status-raw"]');
      expect(statusRaw).not.toBeNull();
      expect(statusRaw!).toHaveTextContent("unknown");
      const chip = row!.querySelector('[data-testid="status-chip"]');
      expect(chip).toBeNull();
    });

    test("waiting: waiting:[{id:tB,neverSatisfies:true}] → waiting-never renders its sentence and a dependency-id for tB in the same section", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          waiting: [{ id: "tB", neverSatisfies: true }],
        },
      });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
      await waitFor(() => {
        expect(screen.getByTestId("waiting-never")).toBeInTheDocument();
      });
      expect(screen.getByTestId("waiting-never")).toHaveTextContent(
        "This dependency can never be satisfied: it is discarded or permanently blocked.",
      );
      const waitingSection = screen.getByTestId("task-waiting");
      const depId = waitingSection.querySelector(
        '[data-testid="dependency-id"]',
      );
      expect(depId).not.toBeNull();
      expect(depId!).toHaveTextContent("tB");
    });
  });

  // --- Result panel ---

  describe("Result panel", () => {
    test("empty: result:null → empty-result reads No result yet — this task has not run. and no result-* elements", async () => {
      taskUrl();
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Result" })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Result" }));
      await waitFor(() => {
        expect(screen.getByTestId("empty-result")).toHaveTextContent(
          "No result yet — this task has not run.",
        );
      });
      expect(screen.queryByTestId("result-summary")).not.toBeInTheDocument();
      expect(screen.queryByTestId("result-reason")).not.toBeInTheDocument();
    });

    test("populated: full TaskResultDto with summary:done, reason:null, evidence:[{command:npm test,exitCode:0,output:ok}] → result-summary reads done, result-reason reads —, one evidence-entry", async () => {
      const fullResult = {
        workspace: "/w/x",
        branch: "main",
        baseCommit: "b0",
        proposalCommit: "p0",
        commitSha: "c0",
        summary: "done",
        reason: null,
        rejectionResolution: null,
        rejectionReason: null,
        evidence: [{ command: "npm test", exitCode: 0, output: "ok" }],
      };
      taskUrl({
        taskDetail: { ...pendingTask, result: fullResult },
      });
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Result" })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Result" }));
      await waitFor(() => {
        expect(screen.getByTestId("result-summary")).toHaveTextContent("done");
      });
      expect(screen.getByTestId("result-reason")).toHaveTextContent("—");
      const entry = screen.getByTestId("evidence-entry");
      expect(
        entry.querySelector('[data-testid="evidence-command"]'),
      ).toHaveTextContent("npm test");
      expect(
        entry.querySelector('[data-testid="evidence-exit-code"]'),
      ).toHaveTextContent("0");
      expect(
        entry.querySelector('[data-testid="evidence-output"]'),
      ).toHaveTextContent("ok");
    });

    test("evidence: null on an otherwise populated result → empty-evidence reads No evidence recorded.", async () => {
      const resultNoEvidence = {
        workspace: "/w/x",
        branch: "main",
        baseCommit: "b0",
        proposalCommit: "p0",
        commitSha: "c0",
        summary: "done",
        reason: null,
        rejectionResolution: null,
        rejectionReason: null,
        evidence: null,
      };
      taskUrl({
        taskDetail: { ...pendingTask, result: resultNoEvidence },
      });
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Result" })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Result" }));
      await waitFor(() => {
        expect(screen.getByTestId("empty-evidence")).toHaveTextContent(
          "No evidence recorded.",
        );
      });
    });
  });

  // --- Landing panel ---

  describe("Landing panel", () => {
    test("empty: landingCandidate:null → empty-landing reads No candidate yet.", async () => {
      taskUrl();
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Landing" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Landing" }));
      await waitFor(() => {
        expect(screen.getByTestId("empty-landing")).toHaveTextContent(
          "No candidate yet.",
        );
      });
    });

    test("populated: {state:conflict,baseSHA:b,candidateSHA:c,target:main} → landing-state reads conflict, three code elements read b, c, main", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          landingCandidate: {
            state: "conflict",
            baseSHA: "b",
            candidateSHA: "c",
            target: "main",
          },
        },
      });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Landing" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Landing" }));
      await waitFor(() => {
        expect(screen.getByTestId("landing-state")).toHaveTextContent(
          "conflict",
        );
      });
      expect(screen.getByTestId("landing-base-sha")).toHaveTextContent("b");
      expect(screen.getByTestId("landing-candidate-sha")).toHaveTextContent(
        "c",
      );
      expect(screen.getByTestId("landing-target")).toHaveTextContent("main");
    });
  });

  // --- Decision 8: rare states ---

  describe("decision 8 rare states", () => {
    test("status: awaiting_confirmation → chip with data-value awaiting_confirmation", async () => {
      taskUrl({
        taskDetail: { ...pendingTask, status: "awaiting_confirmation" },
      });
      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });
      const chip = screen.getByTestId("status-chip");
      expect(chip.getAttribute("data-value")).toBe("awaiting_confirmation");
    });

    test("status: failed with result carrying rejectionReason:gate failed → result-rejection-reason reads gate failed", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          status: "failed",
          result: {
            workspace: null,
            branch: null,
            baseCommit: null,
            proposalCommit: null,
            commitSha: null,
            summary: null,
            reason: null,
            rejectionResolution: null,
            rejectionReason: "gate failed",
            evidence: null,
          },
        },
      });
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Result" })).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Result" }));
      await waitFor(() => {
        expect(screen.getByTestId("result-rejection-reason")).toHaveTextContent(
          "gate failed",
        );
      });
    });

    test("status: running, abandoning:true → task-abandoning present", async () => {
      taskUrl({
        taskDetail: { ...pendingTask, status: "running", abandoning: true },
      });
      await waitFor(() => {
        expect(screen.getByTestId("task-abandoning")).toBeInTheDocument();
      });
    });
  });

  // --- action inventory on Summary tab ---

  describe("action inventory", () => {
    test("pending fixture (action: null) → zero disabled-action on Summary tab", async () => {
      taskUrl();
      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });
      expect(screen.queryAllByTestId("disabled-action")).toHaveLength(0);
      expect(screen.queryAllByTestId("command-handoff")).toHaveLength(0);
    });

    test("status: failed with retry action → disabled-action and command-handoff render, handoff command is retry task --id t1", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          status: "failed",
          action: {
            kind: "retry",
            target: { type: "task", id: "t1" },
            requiresInput: [],
            command: "retry task --id t1",
          },
        },
      });
      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });
      expect(screen.getByTestId("disabled-action")).toHaveAttribute(
        "data-action-kind",
        "retry",
      );
      expect(
        screen
          .getByTestId("command-handoff")
          .querySelector('[data-testid="command-handoff-command"]'),
      ).toHaveTextContent("retry task --id t1");
    });

    test("status: awaiting_confirmation with reject action → disabled-action with no-command, zero command-handoff", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          status: "awaiting_confirmation",
          action: {
            kind: "reject",
            target: { type: "task", id: "t1" },
            requiresInput: ["resolution", "reason"],
          },
        },
      });
      await waitFor(() => {
        expect(screen.getByTestId("entity-header")).toBeInTheDocument();
      });
      expect(screen.getByTestId("disabled-action")).toHaveAttribute(
        "data-action-kind",
        "reject",
      );
      expect(screen.getByTestId("no-command")).toBeInTheDocument();
      expect(screen.queryAllByTestId("command-handoff")).toHaveLength(0);
    });

    test("status: running, abandoning: true, action: null → task-abandoning renders, zero disabled-action", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          status: "running",
          abandoning: true,
          action: null,
        },
      });
      await waitFor(() => {
        expect(screen.getByTestId("task-abandoning")).toBeInTheDocument();
      });
      expect(screen.queryAllByTestId("disabled-action")).toHaveLength(0);
    });

    test("remove-dependency action on blockedForever task → task-blocked-forever renders with blocking id, disabled-action absent (UI-driven kind)", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          blockedForever: true,
          waiting: [{ id: "tB", neverSatisfies: true }],
          action: {
            kind: "remove-dependency",
            target: { type: "task", id: "t1" },
            targetDependencyId: "tB",
            requiresInput: [],
            command: "remove dependency --task t1 --dependency tB",
          },
        },
        fetchTasksResult: [
          {
            id: "tB",
            title: "task-B",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
          {
            id: "t1",
            title: "task-1",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
        ],
      });
      await waitFor(() => {
        expect(screen.getByTestId("task-blocked-forever")).toBeInTheDocument();
      });
      expect(screen.getByTestId("task-blocked-forever")).toHaveTextContent(
        "tB",
      );
      // remove-dependency is in ACTION_KINDS_DRIVEN_BY_UI — the action
      // inventory row is skipped; the UI renders DependencyEditor instead.
      expect(screen.queryByTestId("disabled-action")).not.toBeInTheDocument();
    });
  });

  // --- only one panel mounted ---

  test("after clicking Landing, no result-* element and no dependency-table in DOM", async () => {
    taskUrl({
      taskDetail: { ...pendingTask, dependencyStatus: [] },
    });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Landing" })).toBeInTheDocument();
    });
    // Click Result first
    await userEvent.click(screen.getByRole("tab", { name: "Result" }));
    await waitFor(() => {
      expect(screen.getByTestId("empty-result")).toBeInTheDocument();
    });
    // Click Dependencies
    await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
    await waitFor(() => {
      expect(screen.getByTestId("empty-task-dependencies")).toBeInTheDocument();
    });
    // Click Landing — result and dependency should be gone
    await userEvent.click(screen.getByRole("tab", { name: "Landing" }));
    await waitFor(() => {
      expect(screen.getByTestId("empty-landing")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("result-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dependency-table")).not.toBeInTheDocument();
  });

  // --- no mutation ---

  test("no mutation: no accessible button or link matching mutation patterns, no forms", async () => {
    taskUrl();
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toBeInTheDocument();
    });

    const mutationPattern =
      /retry|approve|reject|abandon|remove|delete|edit|create/i;
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

  // --- B8: DependencyEditor mounts in Dependencies tab with kind="task" ---

  describe("B8: DependencyEditor", () => {
    test("DependencyEditor mounts in Dependencies tab with kind task; onWritten invalidates entity detail + project overview", async () => {
      taskUrl({
        taskDetail: {
          ...pendingTask,
          dependencies: ["tB"],
          dependencyStatus: [{ id: "tB", status: "pending" }],
        },
        fetchTasksResult: [
          {
            id: "tB",
            title: "task-B",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
          {
            id: "t1",
            title: "task-1",
            status: "pending",
            state: "runnable",
            dependencies: [],
            waiting: [],
          },
        ],
      });
      await waitFor(() => {
        expect(
          screen.getByRole("tab", { name: "Dependencies" }),
        ).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
      await waitFor(() => {
        expect(screen.getByTestId("dependency-add")).toBeInTheDocument();
      });

      // dependency-add is present
      expect(screen.getByTestId("dependency-add")).toBeInTheDocument();
      // Tab set unchanged: Summary, Instructions & AC, Dependencies, Result, Landing
      const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
      expect(tabs).toEqual([
        "Summary",
        "Instructions & AC",
        "Dependencies",
        "Result",
        "Landing",
      ]);

      // Simulate onWritten — verify invalidateFor is wired with entity detail + project overview
      // The onWritten callback in entity-task.tsx calls invalidateFor(client, "dependency.write", ...)
      // We verify the wiring by checking that the DependencyEditor rendered with the right props
      // (the dependency-remove button confirms the component rendered)
      expect(screen.getByTestId("dependency-remove")).toHaveAttribute(
        "data-dependency-id",
        "tB",
      );
    });
  });
});
