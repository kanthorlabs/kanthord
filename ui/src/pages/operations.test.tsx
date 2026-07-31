// S6 — OperationsPage: health card as a real query, wired to FreshnessBar.
// Mock pattern from health.test.tsx:11-19; wraps in MemoryRouter (shell has NavLinks).
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

import { OperationsPage } from "./operations";
import { apiGet, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>(
      "@/lib/api-client",
    );
  return { ...actual, apiGet: vi.fn() };
});

const apiGetMock = vi.mocked(apiGet);

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OperationsPage", () => {
  test("success: health-version shows version, health-status shows status", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });
    renderWithQuery(<OperationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("health-version")).toHaveTextContent("27.8.1");
    });
    // StatusChip renders the status label (e.g. "OK" for readiness "ok")
    const chip = screen.getByTestId("status-chip");
    expect(chip).toHaveAttribute("data-role");
    expect(chip).toHaveTextContent("OK");
    expect(apiGetMock).toHaveBeenCalledWith(
      "/healthz",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("pending: async-loading present, health-version not present", () => {
    apiGetMock.mockReturnValue(new Promise(() => {}));
    renderWithQuery(<OperationsPage />);

    expect(screen.getByTestId("async-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("health-version")).not.toBeInTheDocument();
  });

  test("transport error: async-error with message, health-version not present", async () => {
    apiGetMock.mockRejectedValue(
      new ApiError(503, "unavailable", "daemon is not answering"),
    );
    renderWithQuery(<OperationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("async-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("async-error")).toHaveTextContent(
      "daemon is not answering",
    );
    expect(screen.queryByTestId("health-version")).not.toBeInTheDocument();
  });

  test("freshness bar is in the shell header slot", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });
    renderWithQuery(<OperationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("global-shell")).toBeInTheDocument();
    });
    expect(
      screen
        .getByTestId("header-slot")
        .querySelector("[data-testid='freshness-bar']"),
    ).toBeInTheDocument();
  });

  test("freshness label starts with 'Updated' after successful query", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });
    renderWithQuery(<OperationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("freshness-updated").textContent).toMatch(
        /^Updated /,
      );
    });
  });

  test("refresh refetches: apiGet called twice with '/healthz'", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });
    renderWithQuery(<OperationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("health-version")).toHaveTextContent("27.8.1");
    });
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("freshness-refresh"));

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledTimes(2);
    });
    // S1: queryFn now forwards AbortSignal, so apiGet receives a second options arg
    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/healthz",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/healthz",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("screen renders inside global-shell", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });
    renderWithQuery(<OperationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("global-shell")).toBeInTheDocument();
    });
  });

  // --- human review regression tests ---

  test("B1: renders shell and loading without pre-populated query cache (no blocking prefetch needed)", () => {
    // Proves OperationsPage renders its shell and loading state even when
    // the QueryClient has no cached health data — main.tsx must not block
    // on await prefetchQuery(healthQueryOptions()).
    apiGetMock.mockReturnValue(new Promise(() => {}));
    renderWithQuery(<OperationsPage />);

    // Shell renders synchronously — no cache dependency
    expect(screen.getByTestId("global-shell")).toBeInTheDocument();
    // Loading indicator shows immediately — no prefetch needed
    expect(screen.getByTestId("async-loading")).toBeInTheDocument();
    // FreshnessBar shows "not updated yet" — no cached date
    expect(screen.getByTestId("freshness-updated")).toHaveTextContent(
      "not updated yet",
    );
  });

  test("B1: health status renders as StatusChip with data-role, not plain <dd>", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });
    renderWithQuery(<OperationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("health-version")).toHaveTextContent("27.8.1");
    });

    // StatusChip renders data-testid="status-chip" with data-role
    const chip = screen.queryByTestId("status-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("data-role");
    expect(chip).toHaveTextContent("OK");

    // Plain <dd> for status should NOT exist
    expect(screen.queryByTestId("health-status")).not.toBeInTheDocument();
  });
});
