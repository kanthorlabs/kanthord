// Story 04 — ProjectOverviewPage: initiative cards, decisions, digest, truncated state.
// Mock pattern from operations.test.tsx: vi.mock("@/lib/api-client"), wrap in QueryClient + MemoryRouter.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ProjectOverviewPage } from "./project-overview";
import { fetchProjectOverview } from "@/lib/api-client";
import type { ProjectOverviewDto } from "@/lib/dto";

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>(
      "@/lib/api-client",
    );
  return {
    ...actual,
    fetchProjectOverview: vi.fn(),
  };
});

const fetchProjectOverviewMock = vi.mocked(fetchProjectOverview);

function renderOverview(data: ProjectOverviewDto) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[`/project/${data.projectId}/overview`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path="/project/:id/overview"
            element={<ProjectOverviewPage />}
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

/** Standard fixture: two initiatives, one lane, three decisions, a digest with events. */
const fixture: ProjectOverviewDto = {
  projectId: "p1",
  initiatives: [
    {
      id: "i1",
      name: "Initiative Alpha",
      status: "building",
      paused: false,
      taskCounts: {
        pending: 2,
        running: 1,
        completed: 3,
        failed: 0,
        awaiting_confirmation: 0,
        discarded: 0,
      },
      needsHuman: false,
      action: null,
    },
    {
      id: "i2",
      name: "Initiative Beta",
      status: "landed",
      paused: true,
      taskCounts: {
        pending: 0,
        running: 0,
        completed: 5,
        failed: 1,
        awaiting_confirmation: 0,
        discarded: 0,
      },
      needsHuman: true,
      action: {
        kind: "merge",
        target: { type: "objective", id: "o1" },
        requiresInput: [],
      },
    },
  ],
  lanes: [{ repositoryId: "r1", objectiveIds: ["o1"], initiativeIds: ["i1"] }],
  decisions: [
    {
      action: {
        kind: "approve",
        target: { type: "task", id: "t1" },
        requiresInput: [],
        command: "kanthord approve t1",
      },
      initiativeId: "i1",
      objectiveId: "o1",
      taskId: "t1",
      downstream: 3,
      actionableSince: Date.now(),
    },
    {
      action: {
        kind: "reject",
        target: { type: "objective", id: "o2" },
        requiresInput: [],
      },
      initiativeId: "i1",
      objectiveId: "o2",
      taskId: null,
      downstream: 1,
      actionableSince: null,
    },
    {
      action: {
        kind: "retry",
        target: { type: "initiative", id: "i1" },
        requiresInput: [],
      },
      initiativeId: "i1",
      objectiveId: null,
      taskId: null,
      downstream: 0,
      actionableSince: null,
    },
  ],
  digest: {
    since: null,
    latest: "01ABCDEF00000000000000000",
    totalCount: 5,
    byType: { "task.created": 3, "task.completed": 2 },
    events: [
      { id: "e1", type: "task.created", taskId: "t1" },
      { id: "e2", type: "task.created", taskId: "t2" },
      { id: "e3", type: "task.completed", taskId: "t3" },
    ],
    hasMore: true,
    pageCursor: "cursor-1",
  },
};

describe("ProjectOverviewPage", () => {
  test("two initiatives render two cards with data-initiative-id and name", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getAllByTestId("overview-initiative-card")).toHaveLength(2);
    });

    const cards = screen.getAllByTestId("overview-initiative-card");
    expect(cards[0]).toHaveAttribute("data-initiative-id", "i1");
    expect(cards[0]).toHaveTextContent("Initiative Alpha");
    expect(cards[1]).toHaveAttribute("data-initiative-id", "i2");
    expect(cards[1]).toHaveTextContent("Initiative Beta");
  });

  test("card renders six task counts with correct testids", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getAllByTestId("overview-initiative-card")).toHaveLength(2);
    });

    // Initiative Alpha (first card): pending=2, running=1, completed=3, failed=0, awaiting_confirmation=0, discarded=0
    const firstCard = screen.getAllByTestId("overview-initiative-card")[0]!;
    const alpha = within(firstCard);
    expect(alpha.getByTestId("count-pending")).toHaveTextContent("2");
    expect(alpha.getByTestId("count-running")).toHaveTextContent("1");
    expect(alpha.getByTestId("count-completed")).toHaveTextContent("3");
    expect(alpha.getByTestId("count-failed")).toHaveTextContent("0");
    // Component maps key "awaiting_confirmation" (underscore), matching the DTO type.
    expect(alpha.getByTestId("count-awaiting-confirmation")).toHaveTextContent(
      "0",
    );
    expect(alpha.getByTestId("count-discarded")).toHaveTextContent("0");
  });

  test("DOM order: initiatives section, decisions section, digest section", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getAllByTestId("overview-initiative-card")).toHaveLength(2);
    });

    const firstCard = screen.getAllByTestId("overview-initiative-card")[0]!;
    const decisions = screen.getByTestId("overview-decisions");
    const digest = screen.getByTestId("overview-digest");

    // Initiatives before decisions
    expect(
      firstCard.compareDocumentPosition(decisions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Decisions before digest
    expect(
      decisions.compareDocumentPosition(digest) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("digest.hasMore=true renders digest-truncated; hasMore=false does not", async () => {
    // hasMore = true
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getByTestId("digest-truncated")).toBeInTheDocument();
    });
    expect(screen.getByTestId("digest-truncated")).toHaveTextContent(
      "digest data truncated",
    );
    cleanup();

    // hasMore = false
    const noMore: ProjectOverviewDto = {
      ...fixture,
      digest: { ...fixture.digest, hasMore: false },
    };
    fetchProjectOverviewMock.mockResolvedValue(noMore);
    renderOverview(noMore);

    await waitFor(() => {
      expect(screen.getByTestId("overview-digest")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("digest-truncated")).not.toBeInTheDocument();
  });

  test("decision with taskId links to task path", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getByTestId("overview-decisions")).toBeInTheDocument();
    });

    const taskLink = screen.getByText(/task\s+t1/i).closest("a");
    expect(taskLink).toHaveAttribute(
      "href",
      "/project/p1/overview#/project/p1/initiative/i1/objective/o1/task/t1",
    );
  });

  test("decision with objectiveId (no taskId) links to objective path", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getByTestId("overview-decisions")).toBeInTheDocument();
    });

    const objLink = screen.getByText(/objective\s+o2/i).closest("a");
    expect(objLink).toHaveAttribute(
      "href",
      "/project/p1/overview#/project/p1/initiative/i1/objective/o2",
    );
  });

  test("decision with neither taskId nor objectiveId links to initiative path", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getByTestId("overview-decisions")).toBeInTheDocument();
    });

    const initLink = screen.getByText(/initiative\s+i1/i).closest("a");
    expect(initLink).toHaveAttribute(
      "href",
      "/project/p1/overview#/project/p1/initiative/i1",
    );
  });

  test("decision with action.command renders CommandHandoff; without renders none", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getByTestId("overview-decisions")).toBeInTheDocument();
    });

    // First decision has command: "kanthord approve t1"
    expect(screen.getByTestId("command-handoff")).toHaveTextContent(
      "kanthord approve t1",
    );

    // Only one CommandHandoff (the other two decisions have no command)
    expect(screen.getAllByTestId("command-handoff")).toHaveLength(1);
  });

  test("no act control: no approve/reject/retry buttons", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getByTestId("overview-decisions")).toBeInTheDocument();
    });

    const buttons = screen.queryAllByRole("button", {
      name: /approve|reject|retry|resume|halt/i,
    });
    expect(buttons).toHaveLength(0);
  });

  test("empty initiatives renders empty state, not error", async () => {
    const empty: ProjectOverviewDto = {
      ...fixture,
      initiatives: [],
    };
    fetchProjectOverviewMock.mockResolvedValue(empty);
    renderOverview(empty);

    await waitFor(() => {
      expect(screen.getByTestId("async-empty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("async-empty")).toHaveTextContent(
      "No initiatives results",
    );
    expect(screen.queryByTestId("async-error")).not.toBeInTheDocument();
    // Decisions and digest still render
    expect(screen.getByTestId("overview-decisions")).toBeInTheDocument();
    expect(screen.getByTestId("overview-digest")).toBeInTheDocument();
  });

  test("lanes are not rendered; graph link exists", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getAllByTestId("overview-initiative-card")).toHaveLength(2);
    });

    // No r1 text in the DOM (lanes stay unrendered)
    expect(screen.queryByText("r1")).not.toBeInTheDocument();
    // Graph link exists
    expect(
      screen.getByRole("link", { name: /lanes are on the graph/i }),
    ).toHaveAttribute("href", "/project/p1/graph");
  });

  test("FreshnessBar: shows Updated HH:MM after query resolves", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    // After query resolves — freshness shows Updated HH:MM
    await waitFor(() => {
      const el = screen.getByTestId("freshness-updated");
      expect(el.textContent).toMatch(/^Updated \d{2}:\d{2}$/);
    });
  });

  test("FreshnessBar: clicking refresh calls fetchProjectOverview again", async () => {
    const user = userEvent.setup();
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    // Wait for the page to be fully rendered with data
    await waitFor(() => {
      expect(screen.getAllByTestId("overview-initiative-card")).toHaveLength(2);
    });

    // Record the call count after mount (includes initial query + poll probes)
    const callsBeforeRefresh = fetchProjectOverviewMock.mock.calls.length;
    expect(callsBeforeRefresh).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByTestId("freshness-refresh"));

    await waitFor(() => {
      expect(fetchProjectOverviewMock.mock.calls.length).toBeGreaterThan(
        callsBeforeRefresh,
      );
    });
  });

  test("decision 8: no rename/delete control; create-initiative renders for new initiatives", async () => {
    fetchProjectOverviewMock.mockResolvedValue(fixture);
    renderOverview(fixture);

    await waitFor(() => {
      expect(screen.getAllByTestId("overview-initiative-card")).toHaveLength(2);
    });

    // No rename/delete controls
    const deleteButtons = screen.queryAllByRole("button", {
      name: /rename|delete/i,
    });
    expect(deleteButtons).toHaveLength(0);

    const deleteLinks = screen.queryAllByRole("link", {
      name: /rename|delete/i,
    });
    expect(deleteLinks).toHaveLength(0);

    // Create-initiative button is present (026.4 S5)
    expect(screen.getByTestId("create-initiative")).toHaveTextContent(
      "New initiative",
    );
  });
});
