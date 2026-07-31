// EPIC 026 Verification Gate: "the health card renders the version string from a
// stubbed client, which is the DOM proof curl cannot give."
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { HealthPage } from "./health";
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
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HealthPage", () => {
  test("renders the version string the client returned", async () => {
    apiGetMock.mockResolvedValue({ status: "ok", version: "27.8.1" });

    renderWithQuery(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByTestId("health-version")).toHaveTextContent("27.8.1");
    });
    expect(screen.getByTestId("health-status")).toHaveTextContent("ok");
    expect(apiGetMock).toHaveBeenCalledWith("/healthz");
  });

  test("shows a loading placeholder before the client answers", () => {
    apiGetMock.mockReturnValue(new Promise(() => {}));

    renderWithQuery(<HealthPage />);

    expect(screen.getByTestId("health-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("health-version")).not.toBeInTheDocument();
  });

  test("a transport failure renders an alert, not a blank card", async () => {
    apiGetMock.mockRejectedValue(
      new ApiError(503, "unavailable", "daemon is not answering"),
    );

    renderWithQuery(<HealthPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "daemon is not answering",
      );
    });
  });
});
