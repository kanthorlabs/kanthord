/**
 * Story 001 T2 — FeatureDetail component tests (drill-down).
 *
 * Fake-client convention: wrap component in DaemonClientProvider with an inline
 * fake implementing getFeature only (T1 pattern).
 *
 * Asserts (golden GetFeatureResponse fixture, values field-by-field):
 *   - Task statuses for each task in each story rendered
 *   - DAG progress numbers (satisfied/total nodes and edges)
 *   - In-flight broker ops (opId, verb, state)
 *   - STATE view content rendered in the STATE tab panel
 *   - JOURNAL view content rendered in the JOURNAL tab panel
 *   - Plan view is READ-ONLY: no input, textarea, contentEditable, or save control
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because FeatureDetail and DaemonClientProvider modules do not exist
 * yet, and locators.features.detail.* / locators.detailPage.* are not yet in the
 * registry.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureDetail } from "@/features/FeatureDetail";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Golden fixture (field-by-field values the tests pin)
// ---------------------------------------------------------------------------

const GOLDEN_FEATURE = {
  featureId: "feat-001",
  status: "running",
  phase: "coding",
  stories: [
    {
      storyId: "story-001",
      status: "running",
      tasks: [
        {
          taskId: "task-001",
          status: "done",
          exitGatePassed: true,
          attempt: BigInt(1),
        },
        {
          taskId: "task-002",
          status: "running",
          exitGatePassed: false,
          attempt: BigInt(2),
        },
      ],
    },
  ],
  dag: {
    totalNodes: BigInt(5),
    satisfiedNodes: BigInt(2),
    totalEdges: BigInt(4),
    satisfiedEdges: BigInt(3),
  },
  inFlightOps: [
    {
      opId: "op-001",
      verb: "github.commit",
      state: "in_flight",
      correlation: "corr-abc-123",
      featureId: "feat-001",
      expiresAt: BigInt(1721000000000),
      expiring: false,
    },
  ],
  stateView: "# Feature State\nStatus: running\nPhase: coding",
  journalView: "## Journal\n2026-07-15 - session started",
};

function makeDetailClient(fixture: typeof GOLDEN_FEATURE): DaemonClient {
  return {
    getFeature: async (_req: unknown) => fixture,
  } as unknown as DaemonClient;
}

function makeHangingDetailClient(): DaemonClient {
  return {
    getFeature: () => new Promise(() => { /* never resolves */ }),
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeatureDetail — drill-down surface (Story 001 T2)", () => {
  describe("loading state", () => {
    it("renders the loading state while detail data is fetching", () => {
      render(
        <DaemonClientProvider client={makeHangingDetailClient()}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.dataStates.loading)
      ).toBeInTheDocument();
    });
  });

  describe("task statuses (field-by-field from golden fixture)", () => {
    it("renders the tasks section", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.detail.tasks);
      expect(
        screen.getByTestId(locators.features.detail.tasks)
      ).toBeInTheDocument();
    });

    it("renders a row for task-001 with its status", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      const row = await screen.findByTestId(locators.features.detail.taskRow("task-001"));
      expect(row).toBeInTheDocument();
      expect(row).toHaveTextContent("task-001");
      expect(row).toHaveTextContent("done");
    });

    it("renders a row for task-002 with its status", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      const row = await screen.findByTestId(locators.features.detail.taskRow("task-002"));
      expect(row).toBeInTheDocument();
      expect(row).toHaveTextContent("task-002");
      expect(row).toHaveTextContent("running");
    });
  });

  describe("DAG progress (field-by-field from golden fixture)", () => {
    it("renders the DAG progress section", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.detail.dag);
      expect(
        screen.getByTestId(locators.features.detail.dag)
      ).toBeInTheDocument();
    });

    it("renders satisfied nodes count", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      const dagSection = await screen.findByTestId(locators.features.detail.dag);
      // satisfiedNodes=2, totalNodes=5
      expect(dagSection).toHaveTextContent("2");
      expect(dagSection).toHaveTextContent("5");
    });

    it("renders satisfied edges count", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      const dagSection = await screen.findByTestId(locators.features.detail.dag);
      // satisfiedEdges=3, totalEdges=4
      expect(dagSection).toHaveTextContent("3");
      expect(dagSection).toHaveTextContent("4");
    });
  });

  describe("in-flight ops (field-by-field from golden fixture)", () => {
    it("renders the ops section", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.detail.ops);
      expect(
        screen.getByTestId(locators.features.detail.ops)
      ).toBeInTheDocument();
    });

    it("renders a row for op-001 with its verb and state", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      const opRow = await screen.findByTestId(locators.features.detail.opRow("op-001"));
      expect(opRow).toBeInTheDocument();
      expect(opRow).toHaveTextContent("github.commit");
      expect(opRow).toHaveTextContent("in_flight");
    });
  });

  describe("STATE view (read-only plan content)", () => {
    it("renders STATE view content in the STATE tab panel", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      // Navigate to the STATE tab
      const stateTrigger = await screen.findByTestId(
        locators.detailPage.tabTrigger("state")
      );
      await user.click(stateTrigger);

      const stateView = screen.getByTestId(locators.features.detail.stateView);
      expect(stateView).toHaveTextContent("Feature State");
      expect(stateView).toHaveTextContent("Status: running");
    });
  });

  describe("JOURNAL view (read-only plan content)", () => {
    it("renders JOURNAL view content in the JOURNAL tab panel", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      // Navigate to the JOURNAL tab
      const journalTrigger = await screen.findByTestId(
        locators.detailPage.tabTrigger("journal")
      );
      await user.click(journalTrigger);

      const journalView = screen.getByTestId(locators.features.detail.journalView);
      expect(journalView).toHaveTextContent("Journal");
      expect(journalView).toHaveTextContent("2026-07-15");
    });
  });

  // S2 regression — DESIGN §8 Table rule: testid must be on the table root itself
  describe("table root testids (DESIGN §8 table placement — S2)", () => {
    it("tasks table root element carries the detail tasks table testid", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      // Wait for the tasks section to appear so the table is fully rendered
      await screen.findByTestId(locators.features.detail.tasks);
      // locators.features.detail.tasksTable does not exist yet — RED
      // SE must add: locators.features.detail.tasksTable and the testid on the tasks <Table> root
      expect(
        screen.getByTestId(locators.features.detail.tasksTable as unknown as string)
      ).toBeInTheDocument();
    });

    it("ops table root element carries the detail ops table testid", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      // Wait for the ops section to appear so the table is fully rendered
      await screen.findByTestId(locators.features.detail.ops);
      // locators.features.detail.opsTable does not exist yet — RED
      // SE must add: locators.features.detail.opsTable and the testid on the ops <Table> root
      expect(
        screen.getByTestId(locators.features.detail.opsTable as unknown as string)
      ).toBeInTheDocument();
    });
  });

  describe("read-only enforcement — no edit affordance (DESIGN §6)", () => {
    it("renders no input element anywhere on the detail surface", async () => {
      const { container } = render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      // Wait for data to load
      await screen.findByTestId(locators.features.detail.tasks);
      expect(container.querySelector("input")).toBeNull();
    });

    it("renders no textarea element anywhere on the detail surface", async () => {
      const { container } = render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.detail.tasks);
      expect(container.querySelector("textarea")).toBeNull();
    });

    it("renders no contentEditable element anywhere on the detail surface", async () => {
      const { container } = render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.detail.tasks);
      expect(container.querySelector("[contenteditable]")).toBeNull();
    });

    it("renders no save control anywhere on the detail surface", async () => {
      render(
        <DaemonClientProvider client={makeDetailClient(GOLDEN_FEATURE)}>
          <FeatureDetail featureId="feat-001" />
        </DaemonClientProvider>
      );
      await screen.findByTestId(locators.features.detail.tasks);
      // No button with save/Save/edit/Edit text
      expect(
        screen.queryByRole("button", { name: /save/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /edit/i })
      ).not.toBeInTheDocument();
    });
  });
});
