// Story 03 — ProjectsPage: table, server-side search, read-only pane.
// Mock pattern from operations.test.tsx: mock api-client, wrap in QueryClient + MemoryRouter.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

import { ProjectsPage } from "./projects";
import {
  fetchProjects,
  fetchProject,
  fetchProjectWithEtag,
} from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>(
      "@/lib/api-client",
    );
  return {
    ...actual,
    fetchProjects: vi.fn(),
    fetchProject: vi.fn(),
    fetchProjectOverview: vi.fn(),
    fetchResources: vi.fn(),
    fetchResource: vi.fn(),
    fetchProjectWithEtag: vi.fn(),
    createProject: vi.fn(),
    renameProject: vi.fn(),
  };
});

const fetchProjectsMock = vi.mocked(fetchProjects);
const fetchProjectMock = vi.mocked(fetchProject);
const fetchProjectWithEtagMock = vi.mocked(fetchProjectWithEtag);

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={["/project"]}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectsPage", () => {
  test("two projects renders 2 rows in [data-testid='project-table']", async () => {
    fetchProjectsMock.mockResolvedValue([
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
    renderWithQuery(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-table")).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId("project-table");
    expect(rows).toHaveLength(1); // one table
    const trs = screen
      .getByTestId("project-table")
      .querySelectorAll("tbody tr");
    expect(trs).toHaveLength(2);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  test("tr[data-project-id='p1'] exists", async () => {
    fetchProjectsMock.mockResolvedValue([
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
    renderWithQuery(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-table")).toBeInTheDocument();
    });
    const row = screen
      .getByTestId("project-table")
      .querySelector("tr[data-project-id='p1']");
    expect(row).toBeInTheDocument();
  });

  test("typing 'alp' calls fetchProjects with 'alp' after debounce, not before", async () => {
    fetchProjectsMock.mockResolvedValue([
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
    renderWithQuery(<ProjectsPage />);

    // Wait for initial render with real timers
    await waitFor(() => {
      expect(screen.getByTestId("project-table")).toBeInTheDocument();
    });
    expect(fetchProjectsMock).toHaveBeenCalledTimes(1);

    // Switch to fake timers for debounce testing
    vi.useFakeTimers();

    const input = screen.getByTestId("collection-search");
    fireEvent.change(input, { target: { value: "alp" } });

    // Before debounce: no second call
    expect(fetchProjectsMock).toHaveBeenCalledTimes(1);

    // After debounce: second call with "alp"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchProjectsMock).toHaveBeenCalledTimes(2);
    expect(fetchProjectsMock).toHaveBeenLastCalledWith(
      "alp",
      expect.anything(),
    );
  });

  test("no client-side filter: mock returns both projects for 'alp', table shows 2 rows", async () => {
    fetchProjectsMock.mockResolvedValue([
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
    renderWithQuery(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-table")).toBeInTheDocument();
    });

    const input = screen.getByTestId("collection-search");
    fireEvent.change(input, { target: { value: "alp" } });

    // Wait for debounce + fetch to resolve — no fake timers needed
    await waitFor(() => {
      const trs = screen
        .getByTestId("project-table")
        .querySelectorAll("tbody tr");
      expect(trs).toHaveLength(2);
    });
  });

  test("empty array renders empty state, project-table is absent", async () => {
    fetchProjectsMock.mockResolvedValue([]);
    renderWithQuery(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("async-empty")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("project-table")).not.toBeInTheDocument();
  });

  test("rejected ApiError renders error state with message", async () => {
    const error = new Error(
      "network failure",
    ) as import("@/lib/api-client").ApiError;
    Object.assign(error, {
      name: "ApiError",
      status: 503,
      code: "unavailable",
    });
    fetchProjectsMock.mockRejectedValue(error);
    renderWithQuery(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("async-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("async-error")).toHaveTextContent(
      "network failure",
    );
    expect(screen.queryByTestId("project-table")).not.toBeInTheDocument();
  });

  test("clicking a row renders [data-testid='detail-pane'] with name and id, fetchProject not called", async () => {
    fetchProjectsMock.mockResolvedValue([{ id: "p1", name: "alpha" }]);
    renderWithQuery(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-table")).toBeInTheDocument();
    });

    const row = screen
      .getByTestId("project-table")
      .querySelector("tr[data-project-id='p1']");
    fireEvent.click(row!);

    await waitFor(() => {
      expect(screen.getByTestId("detail-pane")).toBeInTheDocument();
    });
    expect(screen.getByTestId("detail-pane")).toHaveTextContent("alpha");
    expect(screen.getByTestId("detail-pane")).toHaveTextContent("p1");
    expect(fetchProjectMock).not.toHaveBeenCalled();
  });

  test("decision 8: no delete button on the page, exactly one create-project, one rename-open per row", async () => {
    fetchProjectsMock.mockResolvedValue([
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
    fetchProjectWithEtagMock.mockResolvedValue({
      data: { id: "p1", name: "alpha" },
      etag: '"v1"',
    });
    renderWithQuery(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("project-table")).toBeInTheDocument();
    });

    const createBtn = screen.getByTestId("create-project");
    expect(createBtn).toBeInTheDocument();
    expect(createBtn).toHaveTextContent("New project");

    const renameBtns = screen.getAllByTestId("rename-open");
    expect(renameBtns).toHaveLength(2);

    const deleteBtns = screen.queryAllByRole("button", {
      name: /delete|remove/i,
    });
    expect(deleteBtns).toHaveLength(0);

    const links = screen.queryAllByRole("link", {
      name: /new|create|rename|delete/i,
    });
    expect(links).toHaveLength(0);
  });
});
