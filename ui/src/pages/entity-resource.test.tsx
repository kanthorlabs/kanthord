import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
} from "@/lib/api-client";
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
  };
});

const apiGetMock = vi.mocked(apiGet);
const fetchProjectsMock = vi.mocked(fetchProjects);
const fetchProjectMock = vi.mocked(fetchProject);
const fetchProjectOverviewMock = vi.mocked(fetchProjectOverview);
const fetchResourcesMock = vi.mocked(fetchResources);
const fetchResourceMock = vi.mocked(fetchResource);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.location.hash = "";
});

const ROUTE_TREE = [
  {
    path: "/project/:projectId/resource/:type/:resourceId",
    element: <EntityResourcePage />,
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

const REPO_RESOURCE = {
  type: "repository" as const,
  id: "r1",
  projectId: "p1",
  name: "repo-1",
  remoteUrl: "https://example.invalid/x.git",
  branch: "main",
  path: "/m/r1",
  auth: { kind: "ambient" as const },
  publication: null,
};

const CREDENTIAL_RESOURCE = {
  type: "credential" as const,
  id: "c1",
  projectId: "p1",
  name: "cred-1",
  provider: "github",
};

const NOTIFICATION_RESOURCE = {
  type: "notification" as const,
  id: "n1",
  projectId: "p1",
  name: "notif-1",
  provider: "slack",
  destination: "#ops",
};

const FILESYSTEM_RESOURCE = {
  type: "filesystem" as const,
  id: "f1",
  projectId: "p1",
  name: "fs-1",
  path: "/data",
};

function resourcePath(params: {
  projectId: string;
  type: string;
  resourceId: string;
}) {
  return `/project/${params.projectId}/resource/${params.type}/${params.resourceId}`;
}

function mockResource(resource: object) {
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
  fetchResourceMock.mockResolvedValue(resource as never);
  fetchResourceMock.mockResolvedValue(resource as any);
}

// --- tests ---

describe("entity-resource", () => {
  test("repository: all six rows render, auth ambient, no credential", async () => {
    mockResource(REPO_RESOURCE);
    const url = resourcePath({
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("repo-1");
    });
    // Tab strip is exactly Summary
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toHaveTextContent("Summary");
    // Six rows
    expect(screen.getByTestId("resource-name")).toHaveTextContent("repo-1");
    expect(screen.getByTestId("resource-remote-url")).toHaveTextContent(
      "https://example.invalid/x.git",
    );
    expect(screen.getByTestId("resource-branch")).toHaveTextContent("main");
    expect(screen.getByTestId("resource-path")).toHaveTextContent("/m/r1");
    expect(screen.getByTestId("resource-auth-kind")).toHaveTextContent(
      "ambient",
    );
    expect(screen.getByTestId("resource-publication")).toHaveTextContent("—");
    // No credential element
    expect(
      screen.queryByTestId("resource-auth-credential"),
    ).not.toBeInTheDocument();
  });

  test("repository with https-token auth: credential visible", async () => {
    const resource = {
      ...REPO_RESOURCE,
      auth: { kind: "https-token" as const, credentialId: "c1" },
    };
    mockResource(resource);
    const url = resourcePath({
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("resource-auth-kind")).toHaveTextContent(
        "https-token",
      );
    });
    expect(screen.getByTestId("resource-auth-credential")).toHaveTextContent(
      "c1",
    );
  });

  test("publication: published@abc123 renders correctly", async () => {
    const resource = {
      ...REPO_RESOURCE,
      publication: { state: "published" as const, remoteOID: "abc123" },
    };
    mockResource(resource);
    const url = resourcePath({
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("resource-publication")).toHaveTextContent(
        "published@abc123",
      );
    });
  });

  test("publication: unpublished renders correctly", async () => {
    const resource = {
      ...REPO_RESOURCE,
      publication: { state: "unpublished" as const, remoteOID: null },
    };
    mockResource(resource);
    const url = resourcePath({
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("resource-publication")).toHaveTextContent(
        "unpublished",
      );
    });
  });

  test("credential: name and provider only, no branch/path/publication/auth", async () => {
    mockResource(CREDENTIAL_RESOURCE);
    const url = resourcePath({
      projectId: "p1",
      type: "credential",
      resourceId: "c1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("cred-1");
    });
    expect(screen.getByTestId("resource-name")).toHaveTextContent("cred-1");
    expect(screen.getByTestId("resource-provider")).toHaveTextContent("github");
    expect(screen.queryByTestId("resource-branch")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resource-path")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("resource-publication"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("resource-auth-kind")).not.toBeInTheDocument();
  });

  test("credential with extra value key: no secret leaked", async () => {
    const resource = { ...CREDENTIAL_RESOURCE, value: "s3cr3t" };
    mockResource(resource);
    const url = resourcePath({
      projectId: "p1",
      type: "credential",
      resourceId: "c1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("cred-1");
    });
    expect(document.body.textContent).not.toContain("s3cr3t");
  });

  test("notification: provider and destination render", async () => {
    mockResource(NOTIFICATION_RESOURCE);
    const url = resourcePath({
      projectId: "p1",
      type: "notification",
      resourceId: "n1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("resource-provider")).toHaveTextContent(
        "slack",
      );
    });
    expect(screen.getByTestId("resource-destination")).toHaveTextContent(
      "#ops",
    );
  });

  test("filesystem: path renders, no provider", async () => {
    mockResource(FILESYSTEM_RESOURCE);
    const url = resourcePath({
      projectId: "p1",
      type: "filesystem",
      resourceId: "f1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("resource-path")).toHaveTextContent("/data");
    });
    expect(screen.queryByTestId("resource-provider")).not.toBeInTheDocument();
  });

  test("breadcrumb: credential shows alpha, Credentials, cred-1 in order", async () => {
    mockResource(CREDENTIAL_RESOURCE);
    const url = resourcePath({
      projectId: "p1",
      type: "credential",
      resourceId: "c1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      const bc = screen.getByTestId("breadcrumb");
      const text = bc.textContent!;
      expect(text).toContain("alpha");
      expect(text).toContain("Credentials");
      expect(text).toContain("cred-1");
      expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("Credentials"));
      expect(text.indexOf("Credentials")).toBeLessThan(text.indexOf("cred-1"));
    });
  });

  test("missing: fetchResource rejects 404 → async-missing, no scope-mismatch", async () => {
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
    fetchResourceMock.mockRejectedValue(
      new ApiError(404, "unknown_reference", "no resource"),
    );

    const url = resourcePath({
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("async-missing")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("scope-mismatch")).not.toBeInTheDocument();
  });

  test("no mutation: no edit/rename/delete/rotate/reclone/publish/create/new buttons or links, no forms", async () => {
    mockResource(REPO_RESOURCE);
    const url = resourcePath({
      projectId: "p1",
      type: "repository",
      resourceId: "r1",
    });
    renderWithQuery(
      <RouterProvider
        router={createMemoryRouter(ROUTE_TREE, { initialEntries: [url] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("entity-header")).toHaveTextContent("repo-1");
    });
    const mutationPattern =
      /edit|rename|delete|rotate|reclone|publish|create|new/i;
    const buttons = screen.queryAllByRole("button");
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
