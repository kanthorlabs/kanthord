import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureList } from "@/features/FeatureList";
import { locators } from "@/locators";

const THREE_FEATURES = [
  {
    featureId: "feat-001",
    name: "Feature 001",
    status: "running",
    phase: "coding",
    progressSummary: "2/5 tasks satisfied",
  },
  {
    featureId: "feat-002",
    name: "Feature 002",
    status: "done",
    phase: "done",
    progressSummary: "7/7 tasks satisfied",
  },
  {
    featureId: "feat-003",
    name: "Feature 003",
    status: "pending",
    phase: "planning",
    progressSummary: "0/3 tasks satisfied",
  },
];

function renderFeatureList(props: {
  loading?: boolean;
  error?: { message: string };
  features?: typeof THREE_FEATURES;
}) {
  return render(
    <MemoryRouter>
      <FeatureList {...props} />
    </MemoryRouter>,
  );
}

describe("FeatureList — features list surface (Story 001 T1)", () => {
  describe("loading state", () => {
    it("renders the loading state while data is fetching", () => {
      renderFeatureList({ loading: true });
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  describe("3-feature fixture", () => {
    it("renders exactly three rows when the fixture has three features", () => {
      renderFeatureList({ features: THREE_FEATURES });
      expect(screen.getAllByTestId(locators.features.list.row)).toHaveLength(3);
    });

    it("first row contains the feature id", () => {
      renderFeatureList({ features: THREE_FEATURES });
      expect(screen.getAllByTestId(locators.features.list.row)[0]).toHaveTextContent("feat-001");
    });

    it("first row contains the feature name", () => {
      renderFeatureList({ features: THREE_FEATURES });
      expect(screen.getAllByTestId(locators.features.list.row)[0]).toHaveTextContent("Feature 001");
    });

    it("first row contains the feature status", () => {
      renderFeatureList({ features: THREE_FEATURES });
      expect(screen.getAllByTestId(locators.features.list.row)[0]).toHaveTextContent("running");
    });

    it("first row contains the feature phase", () => {
      renderFeatureList({ features: THREE_FEATURES });
      expect(screen.getAllByTestId(locators.features.list.row)[0]).toHaveTextContent("coding");
    });

    it("all three feature ids are present in the rendered rows", () => {
      renderFeatureList({ features: THREE_FEATURES });
      const rows = screen.getAllByTestId(locators.features.list.row);
      expect(rows[0]).toHaveTextContent("feat-001");
      expect(rows[1]).toHaveTextContent("feat-002");
      expect(rows[2]).toHaveTextContent("feat-003");
    });
  });

  describe("empty fixture", () => {
    it("renders the explicit empty state when the API returns no features", () => {
      renderFeatureList({ features: [] });
      expect(screen.getByTestId(locators.features.list.empty)).toBeInTheDocument();
    });

    it("does not render any rows in the empty state", () => {
      renderFeatureList({ features: [] });
      expect(screen.queryAllByTestId(locators.features.list.row)).toHaveLength(0);
    });
  });

  describe("error state", () => {
    it("renders the error state when the client rejects", () => {
      renderFeatureList({ error: { message: "network failure" } });
      expect(screen.getByTestId(locators.dataStates.error)).toBeInTheDocument();
    });
  });

  describe("table root testid (DESIGN §8 table placement — B2)", () => {
    it("table root element carries the features list table testid", () => {
      renderFeatureList({ features: THREE_FEATURES });
      expect(screen.getByTestId(locators.features.list.table)).toBeInTheDocument();
    });
  });
});
