import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureDetail } from "@/features/FeatureDetail";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

const GOLDEN_FEATURE = {
  featureId: "feat-001",
  status: "running",
  phase: "coding",
  stories: [
    {
      storyId: "story-001",
      status: "running",
      tasks: [
        { taskId: "task-001", status: "done", exitGatePassed: true, attempt: 1n },
        { taskId: "task-002", status: "running", exitGatePassed: false, attempt: 2n },
      ],
    },
  ],
  dag: { totalNodes: 5n, satisfiedNodes: 2n, totalEdges: 4n, satisfiedEdges: 3n },
  inFlightOps: [
    {
      opId: "op-001",
      verb: "github.commit",
      state: "in_flight",
      correlation: "corr-abc-123",
      featureId: "feat-001",
      expiresAt: 1_721_000_000_000n,
      expiring: false,
    },
  ],
  stateView: "# Feature State\nStatus: running\nPhase: coding",
  journalView: "## Journal\n2026-07-15 - session started",
};

const PENDING_REPLAN = {
  proposalId: "replan-proposal-detail",
  featureId: GOLDEN_FEATURE.featureId,
  baseGeneration: 4n,
  baseCompileHash: "detail-base-hash",
  createdAt: 1_721_000_000_000n,
  edits: [{ path: "stories/001-task.md", newContent: "revised task" }],
  displayFiles: [{
    path: "stories/001-task.md",
    lines: [{ kind: "add", content: "revised task" }],
  }],
};

function summaryClient(): DaemonClient {
  return {
    getFeatureSummary: async () => ({
      featureId: GOLDEN_FEATURE.featureId,
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
    }),
  } as unknown as DaemonClient;
}

function renderDetail(data = GOLDEN_FEATURE) {
  return render(
    <DaemonClientProvider client={summaryClient()}>
      <FeatureDetail featureId="feat-001" data={data as never} />
    </DaemonClientProvider>,
  );
}

describe("FeatureDetail — drill-down surface (Story 001 T2)", () => {
  describe("loading state", () => {
    it("renders the loading state while detail data is fetching", () => {
      render(<FeatureDetail featureId="feat-001" loading />);
      expect(screen.getByTestId(locators.dataStates.loading)).toBeInTheDocument();
    });
  });

  describe("task statuses (field-by-field from golden fixture)", () => {
    it("renders the tasks section", () => {
      renderDetail();
      expect(screen.getByTestId(locators.features.detail.tasks)).toBeInTheDocument();
    });

    it("renders a row for task-001 with its status", () => {
      renderDetail();
      const row = screen.getByTestId(locators.features.detail.taskRow("task-001"));
      expect(row).toHaveTextContent("task-001");
      expect(row).toHaveTextContent("done");
    });

    it("renders a row for task-002 with its status", () => {
      renderDetail();
      const row = screen.getByTestId(locators.features.detail.taskRow("task-002"));
      expect(row).toHaveTextContent("task-002");
      expect(row).toHaveTextContent("running");
    });
  });

  describe("DAG progress (field-by-field from golden fixture)", () => {
    it("renders the DAG progress section", () => {
      renderDetail();
      expect(screen.getByTestId(locators.features.detail.dag)).toBeInTheDocument();
    });

    it("renders satisfied nodes count", () => {
      renderDetail();
      const dag = screen.getByTestId(locators.features.detail.dag);
      expect(dag).toHaveTextContent("2");
      expect(dag).toHaveTextContent("5");
    });

    it("renders satisfied edges count", () => {
      renderDetail();
      const dag = screen.getByTestId(locators.features.detail.dag);
      expect(dag).toHaveTextContent("3");
      expect(dag).toHaveTextContent("4");
    });
  });

  describe("in-flight ops (field-by-field from golden fixture)", () => {
    it("renders the ops section", () => {
      renderDetail();
      expect(screen.getByTestId(locators.features.detail.ops)).toBeInTheDocument();
    });

    it("renders a row for op-001 with its verb and state", () => {
      renderDetail();
      const row = screen.getByTestId(locators.features.detail.opRow("op-001"));
      expect(row).toHaveTextContent("github.commit");
      expect(row).toHaveTextContent("in_flight");
    });
  });

  describe("STATE view (read-only plan content)", () => {
    it("renders STATE view content in the STATE tab panel", async () => {
      const user = userEvent.setup();
      renderDetail();
      await user.click(screen.getByTestId(locators.detailPage.tabTrigger("state")));
      const stateView = screen.getByTestId(locators.features.detail.stateView);
      expect(stateView).toHaveTextContent("Feature State");
      expect(stateView).toHaveTextContent("Status: running");
    });
  });

  describe("JOURNAL view (read-only plan content)", () => {
    it("renders JOURNAL view content in the JOURNAL tab panel", async () => {
      const user = userEvent.setup();
      renderDetail();
      await user.click(screen.getByTestId(locators.detailPage.tabTrigger("journal")));
      const journalView = screen.getByTestId(locators.features.detail.journalView);
      expect(journalView).toHaveTextContent("Journal");
      expect(journalView).toHaveTextContent("2026-07-15");
    });
  });

  describe("Controls tab", () => {
    it("mounts sign-off, task halt, and the pending replan approval for the selected feature", async () => {
      const user = userEvent.setup();
      render(
        <DaemonClientProvider client={summaryClient()}>
          <FeatureDetail
            featureId={GOLDEN_FEATURE.featureId}
            data={GOLDEN_FEATURE as never}
            pendingReplanProposal={PENDING_REPLAN}
            actor="operator@kanthord"
          />
        </DaemonClientProvider>,
      );

      await user.click(screen.getByTestId(locators.detailPage.tabTrigger("controls")));

      expect(screen.getByTestId(locators.planFlows.signOff.trigger)).toBeInTheDocument();
      expect(screen.getByTestId(locators.planFlows.halt.trigger)).toBeInTheDocument();
      expect(screen.getByTestId(locators.planFlows.replan.baseGeneration)).toHaveTextContent("4");
    });
  });

  describe("table root testids (DESIGN §8 table placement — S2)", () => {
    it("tasks table root element carries the detail tasks table testid", () => {
      renderDetail();
      expect(screen.getByTestId(locators.features.detail.tasksTable)).toBeInTheDocument();
    });

    it("ops table root element carries the detail ops table testid", () => {
      renderDetail();
      expect(screen.getByTestId(locators.features.detail.opsTable)).toBeInTheDocument();
    });
  });

  describe("read-only enforcement — no edit affordance (DESIGN §6)", () => {
    it("renders no input element anywhere on the detail surface", () => {
      const { container } = renderDetail();
      expect(container.querySelector("input")).toBeNull();
    });

    it("renders no textarea element anywhere on the detail surface", () => {
      const { container } = renderDetail();
      expect(container.querySelector("textarea")).toBeNull();
    });

    it("renders no contentEditable element anywhere on the detail surface", () => {
      const { container } = renderDetail();
      expect(container.querySelector("[contenteditable]")).toBeNull();
    });

    it("renders no save control anywhere on the detail surface", () => {
      renderDetail();
      expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    });
  });
});
