// Story 04 Verify — create-project: submit sends name, invalidates, error renders.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateProject } from "./create-project";
import * as apiClient from "@/lib/api-client";
import * as invalidation from "@/lib/invalidation";

vi.mock("@/lib/api-client", () => ({
  createProject: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    requestId?: string;
    constructor(
      status: number,
      code: string,
      message: string,
      requestId?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.requestId = requestId;
    }
  },
}));

vi.mock("@/lib/invalidation", () => ({
  invalidateFor: vi.fn().mockResolvedValue(undefined),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("CreateProject", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("typing a name and submitting calls createProject once with the trimmed name", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(apiClient.createProject);
    createProjectMock.mockResolvedValue({
      data: { id: "p1" },
      location: "/api/project/p1",
    });

    render(<CreateProject />, { wrapper: makeWrapper() });

    // Open the sheet
    await user.click(screen.getByRole("button", { name: "New project" }));

    // Type a name
    const input = screen.getByTestId("create-project-name");
    await user.type(input, "  My Project  ");

    // Submit
    await user.click(screen.getByTestId("create-project-submit"));

    expect(createProjectMock).toHaveBeenCalledTimes(1);
    expect(createProjectMock).toHaveBeenCalledWith("My Project");
  });

  test("blank or whitespace-only name issues no request", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(apiClient.createProject);

    render(<CreateProject />, { wrapper: makeWrapper() });
    await user.click(screen.getByRole("button", { name: "New project" }));

    // Type only spaces and submit
    await user.type(screen.getByTestId("create-project-name"), "   ");
    await user.click(screen.getByTestId("create-project-submit"));

    // The handler returns early — no request
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  test("409 duplicate_name renders create-project-error with server message", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(apiClient.createProject);
    const ApiError = apiClient.ApiError;
    createProjectMock.mockRejectedValue(
      new ApiError(
        409,
        "duplicate_name",
        "A project with this name already exists",
      ),
    );

    render(<CreateProject />, { wrapper: makeWrapper() });
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByTestId("create-project-name"), "Dup");
    await user.click(screen.getByTestId("create-project-submit"));

    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.getByTestId("create-project-error")).toBeDefined();
      });
    });

    expect(screen.getByTestId("create-project-error").textContent).toContain(
      "A project with this name already exists",
    );
    // Sheet should still be open (input still rendered)
    expect(screen.getByTestId("create-project-name")).toBeDefined();
  });

  test("success calls invalidateFor with project.create", async () => {
    const user = userEvent.setup();
    const createProjectMock = vi.mocked(apiClient.createProject);
    const invalidateForMock = vi.mocked(invalidation.invalidateFor);
    createProjectMock.mockResolvedValue({
      data: { id: "p1" },
      location: "/api/project/p1",
    });

    render(<CreateProject />, { wrapper: makeWrapper() });
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByTestId("create-project-name"), "New");
    await user.click(screen.getByTestId("create-project-submit"));

    await act(async () => {
      await vi.waitFor(() => {
        expect(invalidateForMock).toHaveBeenCalled();
      });
    });

    expect(invalidateForMock).toHaveBeenCalledWith(
      expect.anything(),
      "project.create",
      {},
    );
  });
});
