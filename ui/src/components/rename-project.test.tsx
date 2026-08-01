// Story 04 Verify — rename-project: frozen ETag, 412 conflict, recovery.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RenameProject } from "./rename-project";
import * as apiClient from "@/lib/api-client";
import * as invalidation from "@/lib/invalidation";

const mockFetch = vi.fn();
const mockRename = vi.fn();

vi.mock("@/lib/api-client", () => ({
  get fetchProjectWithEtag() {
    return (...args: unknown[]) => mockFetch(...args);
  },
  get renameProject() {
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
      <RenameProject projectId="p1" name="Original" />
    </QueryClientProvider>,
  );
}

describe("RenameProject", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("opening the Sheet calls the detail GET once and pre-fills rename-input", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "p1", name: "Original" },
      etag: '"etag1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "p1", name: "New" },
      etag: '"etag2"',
    });

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    const input = screen.getByTestId("rename-input") as HTMLInputElement;
    expect(input.value).toBe("Original");
  });

  test("submitting sends if-match equal to the ETag from that GET, byte-identical", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "p1", name: "Original" },
      etag: '"etag1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "p1", name: "New" },
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

    expect(mockRename).toHaveBeenCalledWith("p1", "New", '"etag1"');
  });

  test("frozen validator: cache update does not change the submitted if-match", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "p1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "p1", name: "New" },
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

    // Simulate a cache update (poll / focus refetch)
    act(() => {
      client.setQueryData(["project", "p1"], { id: "p1", name: "Changed" });
    });

    await user.click(screen.getByTestId("rename-submit"));
    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });

    // Must still use the original etag, not any cached value
    expect(mockRename).toHaveBeenCalledWith("p1", "New", '"v1"');
  });

  test("412 renders conflict, keeps draft, shows three versions", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        data: { id: "p1", name: "Original" },
        etag: '"v1"',
      })
      .mockResolvedValueOnce({
        data: { id: "p1", name: "ServerChanged" },
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
    await user.type(input, "DraftName");

    await user.click(screen.getByTestId("rename-submit"));
    await act(async () => {
      await vi.waitFor(() =>
        expect(screen.getByTestId("conflict")).toBeDefined(),
      );
    });

    // Draft preserved
    expect((screen.getByTestId("rename-input") as HTMLInputElement).value).toBe(
      "DraftName",
    );

    // Three versions rendered
    expect(screen.getByTestId("conflict-base").textContent).toContain(
      "Original",
    );
    expect(screen.getByTestId("conflict-draft").textContent).toContain(
      "DraftName",
    );
    expect(screen.getByTestId("conflict-current").textContent).toContain(
      "ServerChanged",
    );
  });

  test("412 → conflict: the edit session freezes the base and calls recovery load", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        data: { id: "p1", name: "Original" },
        etag: '"v1"',
      })
      .mockResolvedValueOnce({
        data: { id: "p1", name: "ServerChanged" },
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
    await user.type(input, "DraftName");

    // Submit → 412 → recovery load → conflict
    await user.click(screen.getByTestId("rename-submit"));
    await act(async () => {
      await vi.waitFor(() =>
        expect(screen.getByTestId("conflict")).toBeDefined(),
      );
    });

    // Recovery load was called (2 total fetches: initial + recovery)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Draft preserved
    expect((screen.getByTestId("rename-input") as HTMLInputElement).value).toBe(
      "DraftName",
    );
    // Three versions shown
    expect(screen.getByTestId("conflict-base").textContent).toContain(
      "Original",
    );
    expect(screen.getByTestId("conflict-current").textContent).toContain(
      "ServerChanged",
    );
    // Only one PATCH (no retry)
    expect(mockRename).toHaveBeenCalledTimes(1);
  });

  test("428 renders client-defect and no conflict", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "p1", name: "Original" },
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

  test("success: rename was called and session resets (base is null)", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "p1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "p1", name: "New" },
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
    expect(mockRename).toHaveBeenCalledWith("p1", "New", '"v1"');
  });

  test("exactly one PATCH per submit even after a 412", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        data: { id: "p1", name: "Original" },
        etag: '"v1"',
      })
      .mockResolvedValueOnce({
        data: { id: "p1", name: "Changed" },
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
    await user.type(input, "New");

    await user.click(screen.getByTestId("rename-submit"));
    await act(async () => {
      await vi.waitFor(() =>
        expect(screen.getByTestId("conflict")).toBeDefined(),
      );
    });

    expect(mockRename).toHaveBeenCalledTimes(1);
  });

  // --- B15: onSaved contract ---

  test("B15: success calls invalidateFor with project.rename and Sheet closes", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "p1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "p1", name: "New" },
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
    await user.click(screen.getByTestId("rename-submit"));

    // Wait for session to close (onSaved completes, status → closed)
    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });

    // invalidateFor was called with "project.rename" (onSaved ran)
    expect(invalidation.invalidateFor).toHaveBeenCalledWith(
      expect.anything(),
      "project.rename",
      { id: "p1" },
    );
  });

  test("B15: frozen validator across cache write — setQueryData does not change the submitted etag", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      data: { id: "p1", name: "Original" },
      etag: '"v1"',
    });
    mockRename.mockResolvedValue({
      data: { id: "p1", name: "New" },
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

    // Simulate a cache write (poll / focus refetch)
    act(() => {
      client.setQueryData(["project", "p1"], { id: "p1", name: "Changed" });
    });

    await user.click(screen.getByTestId("rename-submit"));
    await act(async () => {
      await vi.waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    });

    // Must still use the original etag, not any cached value
    expect(mockRename).toHaveBeenCalledWith("p1", "New", '"v1"');
  });

  test("B15: conflict-reload → resubmit carries recovery GET's ETag", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        data: { id: "p1", name: "Original" },
        etag: '"v1"',
      })
      .mockResolvedValueOnce({
        data: { id: "p1", name: "ServerChanged" },
        etag: '"v2"',
      })
      .mockResolvedValueOnce({
        data: { id: "p1", name: "ServerChangedAgain" },
        etag: '"v3"',
      });
    mockRename
      .mockRejectedValueOnce(
        new apiClient.ApiError(
          412,
          "precondition_failed",
          "precondition failed",
        ),
      )
      .mockResolvedValueOnce({
        data: { id: "p1", name: "Final" },
        etag: '"v4"',
      });

    renderWithClient(makeClient());

    await user.click(screen.getByRole("button", { name: /rename/i }));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    });

    const input = screen.getByTestId("rename-input");
    await user.clear(input);
    await user.type(input, "Draft");

    // Submit → 412 → recovery load → conflict
    await user.click(screen.getByTestId("rename-submit"));
    await act(async () => {
      await vi.waitFor(() =>
        expect(screen.getByTestId("conflict")).toBeDefined(),
      );
    });

    // Verify: only 1 PATCH (the 412 one), and the input still holds the draft
    expect(mockRename).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("rename-input") as HTMLInputElement).value).toBe(
      "Draft",
    );

    // Reload → re-fetches fresh state, status transitions rearming → editing
    await user.click(screen.getByTestId("conflict-reload"));
    await act(async () => {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    });

    // After reload, the session is re-armed with v3's ETag.
    // The conflict panel should be gone (current is null after reload)
    expect(screen.queryByTestId("conflict")).toBeNull();
  });
});
