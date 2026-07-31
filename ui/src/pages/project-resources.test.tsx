// Story 06 — ProjectResourcesPage: four URL-addressable typed tabs.
// Tests routing, per-type columns, detail pane publication labels, unknown type, caching, search, no polling.
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
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { fetchResources, fetchResource } from "@/lib/api-client";
import type {
  RepositoryResourceDto,
  CredentialResourceDto,
  NotificationResourceDto,
  FilesystemResourceDto,
} from "@/lib/dto";

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
  };
});

const fetchResourcesMock = vi.mocked(fetchResources);
const fetchResourceMock = vi.mocked(fetchResource);

const REPO_FIXTURE: RepositoryResourceDto = {
  type: "repository",
  id: "r1",
  name: "main-repo",
  remoteUrl: "https://github.com/x/y",
  branch: "main",
  path: "/home/user/project",
  auth: { kind: "ambient" },
  publication: null,
};

const CRED_FIXTURE: CredentialResourceDto = {
  type: "credential",
  id: "c1",
  name: "aws-key",
  provider: "aws",
};

const NOTIF_FIXTURE: NotificationResourceDto = {
  type: "notification",
  id: "n1",
  name: "slack-alerts",
  provider: "slack",
  destination: "#alerts",
};

const FS_FIXTURE: FilesystemResourceDto = {
  type: "filesystem",
  id: "f1",
  name: "local-fs",
  path: "/data",
};

// Mock resolve per type — called by the hook/page for each type
function mockResourcesForType(type: string, data: unknown[]) {
  fetchResourcesMock.mockImplementation(
    async (_projectId: string, resType: string) => {
      if (resType === type) return data as never;
      return [] as never;
    },
  );
}

function renderWithRouter(initialEntries: string[], queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const routes = [
    {
      path: "/project/:id/resource/:type",
      async lazy() {
        const { ProjectResourcesPage } = await import("./project-resources");
        return { Component: ProjectResourcesPage };
      },
    },
    {
      path: "/project/:id/resource",
      async lazy() {
        const mod = await import("react-router-dom");
        return {
          Component: () => (
            <mod.Navigate to="/project/p1/resource/repository" replace />
          ),
        };
      },
    },
    {
      path: "/project/:id",
      async lazy() {
        // Simple wrapper that renders Outlet
        const { Outlet } = await import("react-router-dom");
        return { Component: Outlet };
      },
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectResourcesPage", () => {
  test("[data-testid='resource-tabs'] a is exactly 4 with correct labels and hrefs", async () => {
    mockResourcesForType("repository", []);
    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-tabs")).toBeInTheDocument();
    });

    const links = screen.getByTestId("resource-tabs").querySelectorAll("a");
    expect(links).toHaveLength(4);

    const expected = [
      { label: "Repositories", href: "/project/p1/resource/repository" },
      { label: "Credentials", href: "/project/p1/resource/credential" },
      { label: "Notifications", href: "/project/p1/resource/notification" },
      { label: "Filesystems", href: "/project/p1/resource/filesystem" },
    ];

    links.forEach((link, i) => {
      expect(link).toHaveTextContent(expected[i]!.label);
      expect(link.getAttribute("href")).toBe(expected[i]!.href);
    });
  });

  test("active tab carries aria-current='page'", async () => {
    mockResourcesForType("repository", []);
    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-tabs")).toBeInTheDocument();
    });

    const activeLink = screen
      .getByTestId("resource-tabs")
      .querySelector('a[aria-current="page"]');
    expect(activeLink).toBeInTheDocument();
    expect(activeLink).toHaveTextContent("Repositories");
  });

  test("repository tab renders header cells: Name, Branch, Remote, Path, Auth, Publication", async () => {
    mockResourcesForType("repository", [REPO_FIXTURE]);
    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const headerRow = screen
      .getByTestId("resource-table")
      .querySelector("thead tr")!;
    const headers = headerRow.querySelectorAll("th");
    const headerTexts = Array.from(headers).map((th) => th.textContent);
    expect(headerTexts).toEqual([
      "Name",
      "Branch",
      "Remote",
      "Path",
      "Auth",
      "Publication",
    ]);
  });

  test("repository row renders [data-testid='resource-col-branch'] once with branch text", async () => {
    mockResourcesForType("repository", [REPO_FIXTURE]);
    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const branchCells = screen.getAllByTestId("resource-col-branch");
    expect(branchCells).toHaveLength(1);
    expect(branchCells[0]).toHaveTextContent("main");
  });

  test("credential tab renders header cells: Name, Provider", async () => {
    mockResourcesForType("credential", [CRED_FIXTURE]);
    renderWithRouter(["/project/p1/resource/credential"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const headerRow = screen
      .getByTestId("resource-table")
      .querySelector("thead tr")!;
    const headers = headerRow.querySelectorAll("th");
    const headerTexts = Array.from(headers).map((th) => th.textContent);
    expect(headerTexts).toEqual(["Name", "Provider"]);
  });

  test("credential tab renders zero [data-testid='resource-col-branch']", async () => {
    mockResourcesForType("credential", [CRED_FIXTURE]);
    renderWithRouter(["/project/p1/resource/credential"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("resource-col-branch")).not.toBeInTheDocument();
  });

  test("notification tab renders header cells: Name, Provider, Destination", async () => {
    mockResourcesForType("notification", [NOTIF_FIXTURE]);
    renderWithRouter(["/project/p1/resource/notification"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const headerRow = screen
      .getByTestId("resource-table")
      .querySelector("thead tr")!;
    const headers = headerRow.querySelectorAll("th");
    const headerTexts = Array.from(headers).map((th) => th.textContent);
    expect(headerTexts).toEqual(["Name", "Provider", "Destination"]);
  });

  test("filesystem tab renders header cells: Name, Path", async () => {
    mockResourcesForType("filesystem", [FS_FIXTURE]);
    renderWithRouter(["/project/p1/resource/filesystem"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const headerRow = screen
      .getByTestId("resource-table")
      .querySelector("thead tr")!;
    const headers = headerRow.querySelectorAll("th");
    const headerTexts = Array.from(headers).map((th) => th.textContent);
    expect(headerTexts).toEqual(["Name", "Path"]);
  });

  test("unknown type renders [data-testid='async-missing'], no resource-table, zero fetchResources calls", async () => {
    mockResourcesForType("not-a-type", []);
    renderWithRouter(["/project/p1/resource/not-a-type"]);

    await waitFor(() => {
      expect(screen.getByTestId("async-missing")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("resource-table")).not.toBeInTheDocument();
    expect(fetchResourcesMock).not.toHaveBeenCalled();
  });

  test("#/project/p1/resource redirects to #/project/p1/resource/repository", async () => {
    mockResourcesForType("repository", []);
    renderWithRouter(["/project/p1/resource"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-tabs")).toBeInTheDocument();
    });

    // The repository tab should be active
    const activeLink = screen
      .getByTestId("resource-tabs")
      .querySelector('a[aria-current="page"]');
    expect(activeLink).toHaveTextContent("Repositories");
  });

  test("switching credential → repository → credential: cached tab not refetched on return", async () => {
    mockResourcesForType("repository", [REPO_FIXTURE]);
    fetchResourcesMock.mockImplementation(
      async (_projectId: string, type: string) => {
        if (type === "repository") return [REPO_FIXTURE];
        if (type === "credential") return [CRED_FIXTURE];
        return [];
      },
    );

    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    // 1 call for repository
    const repoCalls = fetchResourcesMock.mock.calls.filter(
      ([, type]) => type === "repository",
    );
    expect(repoCalls).toHaveLength(1);

    // Navigate to credential tab — find the link and click it
    const credLink = screen
      .getByTestId("resource-tabs")
      .querySelector('a[href="/project/p1/resource/credential"]');
    fireEvent.click(credLink!);

    await waitFor(() => {
      expect(screen.getByText("aws-key")).toBeInTheDocument();
    });

    const credCalls = fetchResourcesMock.mock.calls.filter(
      ([, type]) => type === "credential",
    );
    expect(credCalls).toHaveLength(1);

    // Navigate back to repository — should NOT re-fetch (cached)
    const repoLink = screen
      .getByTestId("resource-tabs")
      .querySelector('a[href="/project/p1/resource/repository"]');
    fireEvent.click(repoLink!);

    await waitFor(() => {
      expect(screen.getByText("main-repo")).toBeInTheDocument();
    });

    // Repository should still have been called only once (from mount)
    const repoCallsAfterReturn = fetchResourcesMock.mock.calls.filter(
      ([, type]) => type === "repository",
    );
    expect(repoCallsAfterReturn).toHaveLength(1);
  });

  test("no polling: after 3 * POLL_INTERVAL_MS on a mounted tab, fetchResources still called once", async () => {
    vi.useFakeTimers();
    mockResourcesForType("repository", [REPO_FIXTURE]);
    fetchResourcesMock.mockImplementation(async () => [REPO_FIXTURE]);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithRouter(["/project/p1/resource/repository"], client);

    // Advance timers enough for the query to resolve and the table to render
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Keep advancing until the table appears (waitFor with fake timers needs timer advancement)
    for (let i = 0; i < 20; i++) {
      if (screen.queryByTestId("resource-table")) break;
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
    }

    expect(screen.getByTestId("resource-table")).toBeInTheDocument();

    const initialCalls = fetchResourcesMock.mock.calls.length;

    // Advance 3 poll intervals (15s each = 45s total)
    await act(async () => {
      vi.advanceTimersByTime(3 * 15_000);
    });

    // fetchResources should still have been called only once — no refetchInterval
    expect(fetchResourcesMock).toHaveBeenCalledTimes(initialCalls);
  }, 10_000);

  test("typing 'k1' on credential tab calls fetchResources with name param after debounce", async () => {
    fetchResourcesMock.mockImplementation(
      async (_projectId: string, type: string, _name?: string) => {
        if (type === "credential") {
          return [
            { ...CRED_FIXTURE, name: "aws-key" },
            { ...CRED_FIXTURE, id: "c2", name: "gcp-key", provider: "gcp" },
          ] as CredentialResourceDto[];
        }
        return [];
      },
    );

    renderWithRouter(["/project/p1/resource/credential"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    // Switch to fake timers for debounce
    vi.useFakeTimers();

    const input = screen.getByTestId("collection-search");
    fireEvent.change(input, { target: { value: "k1" } });

    // Before debounce: no new call
    const callsBefore = fetchResourcesMock.mock.calls.length;

    // After debounce: call with name param
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(fetchResourcesMock.mock.calls.length).toBeGreaterThan(callsBefore);
    const lastCall = fetchResourcesMock.mock.calls.at(-1);
    expect(lastCall![0]).toBe("p1");
    expect(lastCall![1]).toBe("credential");
    expect(lastCall![2]).toBe("k1");
  });

  test("search on credential tab never calls fetchResources with another type", async () => {
    fetchResourcesMock.mockImplementation(
      async (_projectId: string, type: string) => {
        if (type === "credential") return [CRED_FIXTURE];
        return [];
      },
    );

    renderWithRouter(["/project/p1/resource/credential"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    vi.useFakeTimers();
    fetchResourcesMock.mockClear();

    const input = screen.getByTestId("collection-search");
    fireEvent.change(input, { target: { value: "k1" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // All calls should be for credential type only
    const nonCredCalls = fetchResourcesMock.mock.calls.filter(
      ([, type]) => type !== "credential",
    );
    expect(nonCredCalls).toHaveLength(0);
  });

  test("no client-side filter: mock returns two unfiltered rows for search, both render", async () => {
    fetchResourcesMock.mockImplementation(
      async (_projectId: string, type: string) => {
        if (type === "credential")
          return [
            { ...CRED_FIXTURE, id: "c1", name: "aws-key" },
            { ...CRED_FIXTURE, id: "c2", name: "gcp-key", provider: "gcp" },
          ];
        return [];
      },
    );

    renderWithRouter(["/project/p1/resource/credential"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const input = screen.getByTestId("collection-search");
    fireEvent.change(input, { target: { value: "k1" } });

    await waitFor(() => {
      const rows = screen
        .getByTestId("resource-table")
        .querySelectorAll("tbody tr");
      expect(rows).toHaveLength(2);
    });
  });

  test("credential fixture carrying extra 'value: secret' renders nothing containing secret", async () => {
    fetchResourcesMock.mockImplementation(
      async (_projectId: string, type: string) => {
        if (type === "credential")
          return [
            {
              ...CRED_FIXTURE,
              value: "s3cr3t",
            } as unknown as CredentialResourceDto,
          ];
        return [];
      },
    );

    renderWithRouter(["/project/p1/resource/credential"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
  });

  test("decision 8: no create, rename, delete, rotate or reclone button or link", async () => {
    mockResourcesForType("repository", [REPO_FIXTURE]);
    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const buttons = screen.queryAllByRole("button", {
      name: /new|create|rename|delete|rotate|reclone/i,
    });
    expect(buttons).toHaveLength(0);

    const links = screen.queryAllByRole("link", {
      name: /new|create|rename|delete|rotate|reclone/i,
    });
    expect(links).toHaveLength(0);
  });

  test("detail pane for repository with published@abc123 publication", async () => {
    const repoWithPub: RepositoryResourceDto = {
      ...REPO_FIXTURE,
      publication: { state: "published", remoteOID: "abc123" },
    };

    fetchResourcesMock.mockImplementation(async () => [repoWithPub]);
    fetchResourceMock.mockImplementation(async () => ({
      ...repoWithPub,
      publication: { state: "published", remoteOID: "abc123" },
    }));

    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    // Click the row to open detail pane
    const row = screen
      .getByTestId("resource-table")
      .querySelector("tr[data-resource-id]");
    fireEvent.click(row!);

    await waitFor(() => {
      expect(screen.getByTestId("detail-pane")).toBeInTheDocument();
    });

    expect(screen.getByTestId("detail-pane")).toHaveTextContent(
      "published@abc123",
    );
  });

  test("detail pane for repository with unpublished publication", async () => {
    const repoUnpub: RepositoryResourceDto = {
      ...REPO_FIXTURE,
      publication: { state: "unpublished", remoteOID: null },
    };

    fetchResourcesMock.mockImplementation(async () => [repoUnpub]);
    fetchResourceMock.mockImplementation(async () => ({
      ...repoUnpub,
      publication: { state: "unpublished", remoteOID: null },
    }));

    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const row = screen
      .getByTestId("resource-table")
      .querySelector("tr[data-resource-id]");
    fireEvent.click(row!);

    await waitFor(() => {
      expect(screen.getByTestId("detail-pane")).toBeInTheDocument();
    });

    expect(screen.getByTestId("detail-pane")).toHaveTextContent("unpublished");
  });

  test("list row with publication: null renders '—'", async () => {
    mockResourcesForType("repository", [REPO_FIXTURE]);
    renderWithRouter(["/project/p1/resource/repository"]);

    await waitFor(() => {
      expect(screen.getByTestId("resource-table")).toBeInTheDocument();
    });

    const row = screen.getByTestId("resource-table").querySelector("tbody tr")!;
    expect(row).toHaveTextContent("—");
  });
});
