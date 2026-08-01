// Story 05 Verify — create-objective: submit sends name+initiativeId, invalidates, error renders.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateObjective } from "./create-objective";
import * as apiClient from "@/lib/api-client";
import * as invalidation from "@/lib/invalidation";

const mockCreate = vi.fn();

vi.mock("@/lib/api-client", () => ({
  get createObjective() {
    return (...args: unknown[]) => mockCreate(...args);
  },
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

describe("CreateObjective", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("submit sends name only — no paused, no after", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({
      data: { id: "o1" },
      location: "/api/objective/o1",
    });

    render(<CreateObjective projectId="p1" initiativeId="i1" />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "New objective" }));
    await user.type(
      screen.getByTestId("create-objective-name"),
      "My Objective",
    );
    await user.click(screen.getByTestId("create-objective-submit"));

    await act(async () => {
      await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    });

    expect(mockCreate).toHaveBeenCalledWith("i1", "My Objective");
  });

  test("blank name issues no request", async () => {
    const user = userEvent.setup();
    render(<CreateObjective projectId="p1" initiativeId="i1" />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "New objective" }));

    // Type only spaces and submit
    await user.type(screen.getByTestId("create-objective-name"), "   ");
    await user.click(screen.getByTestId("create-objective-submit"));

    // Handler returns early — no request
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("server error renders create-objective-error and keeps Sheet open", async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      new apiClient.ApiError(409, "duplicate_name", "Name already exists"),
    );

    render(<CreateObjective projectId="p1" initiativeId="i1" />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "New objective" }));
    await user.type(screen.getByTestId("create-objective-name"), "Dup");
    await user.click(screen.getByTestId("create-objective-submit"));

    await act(async () => {
      await vi.waitFor(() =>
        expect(screen.getByTestId("create-objective-error")).toBeDefined(),
      );
    });

    expect(screen.getByTestId("create-objective-error").textContent).toContain(
      "Name already exists",
    );
    expect(screen.getByTestId("create-objective-name")).toBeDefined();
  });

  test("success calls invalidateFor with objective.create and context", async () => {
    const user = userEvent.setup();
    const invalidateForMock = vi.mocked(invalidation.invalidateFor);
    mockCreate.mockResolvedValue({
      data: { id: "o1" },
      location: "/api/objective/o1",
    });

    render(<CreateObjective projectId="p1" initiativeId="i1" />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "New objective" }));
    await user.type(screen.getByTestId("create-objective-name"), "New");
    await user.click(screen.getByTestId("create-objective-submit"));

    await act(async () => {
      await vi.waitFor(() => expect(invalidateForMock).toHaveBeenCalled());
    });

    expect(invalidateForMock).toHaveBeenCalledWith(
      expect.anything(),
      "objective.create",
      { projectId: "p1", initiativeId: "i1" },
    );
  });
});
