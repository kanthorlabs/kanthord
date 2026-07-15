import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import { FeatureSummary } from "@/metrics/FeatureSummary";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

const EXAMPLE_SUMMARY = {
  featureId: "feature-summary-target",
  headline: 4,
  byConfirmedType: {
    approval: 2,
    clarification: 1,
    correction: 1,
    rework: 0,
    takeover: 0,
    external: 0,
  },
  excluded: 1,
  netCost: 11,
};

const EMPTY_SUMMARY = {
  featureId: "feature-summary-target",
  headline: 0,
  byConfirmedType: {
    approval: 0,
    clarification: 0,
    correction: 0,
    rework: 0,
    takeover: 0,
    external: 0,
  },
  excluded: 0,
  netCost: 0,
};

function renderSummary(client: DaemonClient, featureId = "feature-summary-target") {
  return render(
    <DaemonClientProvider client={client}>
      <FeatureSummary featureId={featureId} />
    </DaemonClientProvider>,
  );
}

describe("FeatureSummary — per-feature metrics (Story 007 T1)", () => {
  it("renders a summary-specific card loading state while the summary is pending", () => {
    const client = {
      getFeatureSummary: () => new Promise(() => {}),
    } as unknown as DaemonClient;

    renderSummary(client);

    expect(
      screen.getByTestId(locators.metrics.featureSummary.loading),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(locators.dataStates.loading)).not.toBeInTheDocument();
  });

  it("renders the Epic 029 fixture headline, included-type breakdown, and separately located excluded count", async () => {
    let requestedFeatureId: string | undefined;
    const client = {
      getFeatureSummary: async (request: { featureId: string }) => {
        requestedFeatureId = request.featureId;
        return EXAMPLE_SUMMARY;
      },
    } as unknown as DaemonClient;

    renderSummary(client);

    const headline = await screen.findByTestId(
      locators.metrics.featureSummary.headline,
    );
    expect(requestedFeatureId).toBe("feature-summary-target");
    expect(headline).toHaveTextContent("4 human interactions, $11");
    expect(screen.getByTestId(locators.metrics.featureSummary.root)).toBeInTheDocument();
    expect(screen.getByTestId(locators.metrics.featureSummary.breakdownTable)).toBeInTheDocument();
    expect(
      screen.getByTestId(locators.metrics.featureSummary.breakdownRow("approval")),
    ).toHaveTextContent("2");
    expect(
      screen.getByTestId(locators.metrics.featureSummary.breakdownRow("clarification")),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId(locators.metrics.featureSummary.breakdownRow("correction")),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId(locators.metrics.featureSummary.breakdownRow("rework")),
    ).toHaveTextContent("0");
    expect(
      screen.getByTestId(locators.metrics.featureSummary.breakdownRow("takeover")),
    ).toHaveTextContent("0");
    expect(
      screen.getByTestId(locators.metrics.featureSummary.breakdownRow("external")),
    ).toHaveTextContent("0");
    expect(screen.getByTestId(locators.metrics.featureSummary.excluded)).toHaveTextContent(
      "Excluded: 1",
    );
  });

  it("renders the explicit empty summary with zeros", async () => {
    const client = {
      getFeatureSummary: async () => EMPTY_SUMMARY,
    } as unknown as DaemonClient;

    renderSummary(client);

    expect(
      await screen.findByTestId(locators.metrics.featureSummary.empty),
    ).toBeInTheDocument();
    expect(screen.getByTestId(locators.metrics.featureSummary.headline)).toHaveTextContent(
      "0 human interactions, $0",
    );
    expect(
      screen.getByTestId(locators.metrics.featureSummary.breakdownRow("approval")),
    ).toHaveTextContent("0");
    expect(screen.getByTestId(locators.metrics.featureSummary.excluded)).toHaveTextContent(
      "Excluded: 0",
    );
  });

  it("renders an error rather than the empty summary when getFeatureSummary rejects", async () => {
    const client = {
      getFeatureSummary: async () => {
        throw new Error("summary unavailable");
      },
    } as unknown as DaemonClient;

    renderSummary(client);

    expect(
      await screen.findByTestId(locators.metrics.featureSummary.error),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(locators.metrics.featureSummary.empty),
    ).not.toBeInTheDocument();
  });

  it("clears rendered feature A data while feature B is loading after a route change", async () => {
    let resolveA: ((value: typeof EXAMPLE_SUMMARY) => void) | undefined;
    let resolveB: ((value: typeof EMPTY_SUMMARY) => void) | undefined;
    const client = {
      getFeatureSummary: async (request: { featureId: string }) =>
        new Promise<typeof EXAMPLE_SUMMARY | typeof EMPTY_SUMMARY>((resolve) => {
          if (request.featureId === "feature-a") {
            resolveA = resolve;
          } else {
            resolveB = resolve;
          }
        }),
    } as unknown as DaemonClient;

    const result = renderSummary(client, "feature-a");
    expect(screen.getByTestId(locators.metrics.featureSummary.loading)).toBeInTheDocument();

    await act(async () => {
      resolveA?.({ ...EXAMPLE_SUMMARY, featureId: "feature-a" });
    });
    expect(await screen.findByTestId(locators.metrics.featureSummary.headline)).toHaveTextContent(
      "4 human interactions, $11",
    );

    result.rerender(
      <DaemonClientProvider client={client}>
        <FeatureSummary featureId="feature-b" />
      </DaemonClientProvider>,
    );
    expect(screen.getByTestId(locators.metrics.featureSummary.loading)).toBeInTheDocument();
    expect(screen.queryByTestId(locators.metrics.featureSummary.headline)).not.toBeInTheDocument();

    await act(async () => {
      resolveB?.({ ...EMPTY_SUMMARY, featureId: "feature-b" });
    });
    expect(await screen.findByTestId(locators.metrics.featureSummary.empty)).toBeInTheDocument();
    expect(screen.getByTestId(locators.metrics.featureSummary.headline)).toHaveTextContent(
      "0 human interactions, $0",
    );
  });
});
