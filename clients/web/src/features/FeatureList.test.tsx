/**
 * Story 001 T1 — FeatureList component tests.
 *
 * Fake-client convention (established here, reused by later stories):
 *   - Components get the daemon client via `useDaemonClient()` from
 *     `DaemonClientProvider`.
 *   - Tests wrap the component in `<DaemonClientProvider client={fake}>` where
 *     `fake` is an inline object literal cast `as unknown as DaemonClient`.
 *   - Only the methods under test are implemented on the fake.
 *
 * Asserts:
 *   - 3-feature fixture → 3 rows rendered (featureId, status, phase)
 *   - empty fixture → explicit empty state
 *   - loading state while data is fetching
 *   - error state when the client rejects
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because FeatureList and DaemonClientProvider modules do not exist
 * yet, and locators.features.list.{row,empty} are not yet in the registry.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FeatureList } from "@/features/FeatureList";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THREE_FEATURES = [
  {
    featureId: "feat-001",
    status: "running",
    phase: "coding",
    progressSummary: "2/5 tasks satisfied",
  },
  {
    featureId: "feat-002",
    status: "done",
    phase: "done",
    progressSummary: "7/7 tasks satisfied",
  },
  {
    featureId: "feat-003",
    status: "pending",
    phase: "planning",
    progressSummary: "0/3 tasks satisfied",
  },
];

function makeListClient(
  features: typeof THREE_FEATURES
): DaemonClient {
  return {
    listFeatures: async () => ({ features }),
  } as unknown as DaemonClient;
}

function makeRejectingClient(): DaemonClient {
  return {
    listFeatures: async () => {
      throw new Error("network failure");
    },
  } as unknown as DaemonClient;
}

function makeHangingClient(): DaemonClient {
  return {
    listFeatures: () => new Promise(() => { /* never resolves */ }),
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeatureList — features list surface (Story 001 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      render(
        <DaemonClientProvider client={makeHangingClient()}>
          <FeatureList />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });
  });

  describe("3-feature fixture", () => {
    it("renders exactly three rows when the fixture has three features", async () => {
      render(
        <DaemonClientProvider client={makeListClient(THREE_FEATURES)}>
          <FeatureList />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.features.list.row);
      expect(rows).toHaveLength(3);
    });

    it("first row contains the feature id", async () => {
      render(
        <DaemonClientProvider client={makeListClient(THREE_FEATURES)}>
          <FeatureList />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.features.list.row);
      expect(rows[0]).toHaveTextContent("feat-001");
    });

    it("first row contains the feature status", async () => {
      render(
        <DaemonClientProvider client={makeListClient(THREE_FEATURES)}>
          <FeatureList />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.features.list.row);
      expect(rows[0]).toHaveTextContent("running");
    });

    it("first row contains the feature phase", async () => {
      render(
        <DaemonClientProvider client={makeListClient(THREE_FEATURES)}>
          <FeatureList />
        </DaemonClientProvider>
      );
      const rows = await screen.findAllByTestId(locators.features.list.row);
      expect(rows[0]).toHaveTextContent("coding");
    });

    it("all three feature ids are present in the rendered rows", async () => {
      render(
        <DaemonClientProvider client={makeListClient(THREE_FEATURES)}>
          <FeatureList />
        </DaemonClientProvider>
      );
      // Wait for data
      await screen.findAllByTestId(locators.features.list.row);
      expect(screen.getByText("feat-001")).toBeInTheDocument();
      expect(screen.getByText("feat-002")).toBeInTheDocument();
      expect(screen.getByText("feat-003")).toBeInTheDocument();
    });
  });

  describe("empty fixture", () => {
    it("renders the explicit empty state when the API returns no features", async () => {
      render(
        <DaemonClientProvider client={makeListClient([])}>
          <FeatureList />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.list.empty);
      expect(
        screen.getByTestId(locators.features.list.empty)
      ).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", async () => {
      render(
        <DaemonClientProvider client={makeListClient([])}>
          <FeatureList />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.list.empty);
      expect(
        screen.queryAllByTestId(locators.features.list.row)
      ).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", async () => {
      render(
        <DaemonClientProvider client={makeRejectingClient()}>
          <FeatureList />
        </DaemonClientProvider>
      );
      await waitFor(() => {
        expect(
          screen.getByTestId(locators.dataStates.error)
        ).toBeInTheDocument();
      });
    });
  });

  // B2 regression — DESIGN §8 Table rule: testid must be on the table root itself
  describe("table root testid (DESIGN §8 table placement — B2)", () => {
    it("table root element carries the features list table testid", async () => {
      render(
        <DaemonClientProvider client={makeListClient(THREE_FEATURES)}>
          <FeatureList />
        </DaemonClientProvider>
      );
      // Wait for data rows to appear so the table is fully rendered
      await screen.findAllByTestId(locators.features.list.row);
      // locators.features.list.table does not exist yet — RED
      // SE must add: locators.features.list.table and the testid on the <Table> root
      expect(
        screen.getByTestId(locators.features.list.table as unknown as string)
      ).toBeInTheDocument();
    });
  });
});
