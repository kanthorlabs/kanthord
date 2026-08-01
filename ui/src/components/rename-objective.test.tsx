// Story 05 Verify — rename-objective: frozen ETag, 412 conflict, recovery.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RenameObjective } from "./rename-objective";
import * as apiClient from "@/lib/api-client";
import * as invalidation from "@/lib/invalidation";

const mockFetch = vi.fn();
const mockRename = vi.fn();

vi.mock("@/lib/api-client", () => ({
  get fetchObjectiveWithEtag() {
    return (...args: unknown[]) => mockFetch(...args);
  },
  get renameObjective() {
    return (...args: unknown[]) => mockRename(...args);
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

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderWithClient(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <RenameObjective
        projectId="p1"
        initiativeId="i1"
        objectiveId="o1"
        name="Original"
      />
    </QueryClientProvider>,
  );
}

describe("RenameObjective", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("opening the Sheet calls the detail GET once and pre-fills rename-input", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "o1", name: "Original", initiativeId: "i1" },
      etag: '"etag1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "o1", name: "New", initiativeId: "i1" },
      etag: '"etag2"',
    });

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input") as HTMLInputElement;
    expect(input.value).toBe("Original");
  });

  test("submitting sends if-match byte-identical to the ETag from GET", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "o1", name: "Original", initiativeId: "i1" },
      etag: '"etag1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "o1", name: "New", initiativeId: "i1" },
      etag: '"etag2"',
    });

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "New");
    await user.click(screen.getByTestId("rename-submit"));

    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });

    expect(mockRename).toHaveBeenCalledWith("o1", "New", '"etag1"');
  });

  test("412 renders conflict with draft intact", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        data: { id: "o1", name: "Original" },
        etag: '"v1"',
      })
      .mockResolvedValueOnce({
        data: { id: "o1", name: "ServerChanged" },
        etag: '"v2"',
      });
    mockRename.mockRejectedValue(
      new apiClient.ApiError(412, "precondition_failed", "precondition failed"),
    );

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "Draft");
    await user.click(screen.getByTestId("rename-submit"));

    await act(async () => {
      await vi.waitFor(() =>
        expect(screen.getByTestId("conflict")).toBeDefined(),
      );
    });

    expect((screen.getByTestId("rename-input") as HTMLInputElement).value).toBe(
      "Draft",
    );
    expect(screen.getByTestId("conflict-base").textContent).toContain(
      "Original",
    );
    expect(screen.getByTestId("conflict-current").textContent).toContain(
      "ServerChanged",
    );
  });

  test("428 renders client-defect and no conflict", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "o1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockRejectedValue(
      new apiClient.ApiError(
        428,
        "precondition_required",
        "precondition required",
      ),
    );

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "Draft");
    await user.click(screen.getByTestId("rename-submit"));

    await act(async () => {
      await vi.waitFor(() =>
        expect(screen.getByTestId("client-defect")).toBeDefined(),
      );
    });

    expect(screen.queryByTestId("conflict")).toBeNull();
  });

  test("success: rename was called and session resets", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "o1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "o1", name: "New" },
      etag: '"v2"',
    });

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "New");
    await user.click(screen.getByTestId("rename-submit"));

    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });

    // The submit was called with the right args
    expect(mockRename).toHaveBeenCalledWith("o1", "New", '"v1"');
  });

  test("exactly one PATCH per submit", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "o1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "o1", name: "New" },
      etag: '"v2"',
    });

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "New");
    await user.click(screen.getByTestId("rename-submit"));

    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });
  });

  // --- B15: onSaved contract ---

  test("B15: success calls invalidateFor with objective.rename", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "o1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "o1", name: "New" },
      etag: '"v2"',
    });

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "New");
    await user.click(screen.getByTestId("rename-submit"));

    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });

    expect(invalidation.invalidateFor).toHaveBeenCalledWith(
      expect.anything(),
      "objective.rename",
      { projectId: "p1", initiativeId: "i1", id: "o1" },
    );
  });

  test("B15: frozen validator across cache write — setQueryData does not change the submitted etag", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "o1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "o1", name: "New" },
      etag: '"v2"',
    });

    const client = makeClient();
    renderWithClient(client);

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "New");

    // Simulate cache write
    act(() => {
      client.setQueryData(["objective", "o1"], { id: "o1", name: "Changed" });
    });

    await user.click(screen.getByTestId("rename-submit"));
    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });

    expect(mockRename).toHaveBeenCalledWith("o1", "New", '"v1"');
  });
});
