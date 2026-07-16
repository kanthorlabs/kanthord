/**
 * Story 002 T3 — ReplanApproval flow component tests.
 *
 * Fake-client convention (established in Story 001):
 *   - Tests wrap in <DaemonClientProvider client={fake}> with an inline fake.
 *
 * ACs (PRD §7.5, Epic 026 plan.approveReplan):
 *   - Initial render: DiffPane (with the authored-file diff) + base generation
 *     value visible before approval
 *   - Approve: invokes client.approveReplan exactly once; renders the re-opened
 *     task ids from the response
 *   - Base-generation-mismatch CONFLICT (ConnectError Code.Aborted): renders the
 *     typed conflict element inline; does NOT render the re-opened tasks element;
 *     fake client call log shows exactly one attempt (no double-apply)
 *
 * Note: ReplanApproval is NOT destructive in the halt/override sense — it is an
 * approval action for a pre-reviewed diff. No ConfirmActionDialog is used; the
 * approve button invokes the mutation directly.
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/plan-flows/ReplanApproval.tsx does not exist
 *   - locators.planFlows.replan.{baseGeneration,approve,reopenedTasks,conflict}
 *     are not in clients/web/src/locators.ts
 *   - locators.diffPane.root is not in locators.ts (also needed for T3 DiffPane test)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectError, Code } from "@connectrpc/connect";
import { ReplanApproval } from "@/plan-flows/ReplanApproval";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DIFF_FILES = [
  {
    path: "stories/S2.md",
    lines: [
      { type: "ctx" as const, content: "# Story S2" },
      { type: "del" as const, content: "Old approach for story" },
      { type: "add" as const, content: "Revised approach for story" },
    ],
  },
  {
    path: "tasks/T5.md",
    lines: [
      { type: "ctx" as const, content: "## Task T5" },
      { type: "add" as const, content: "Add new sub-task dependency" },
    ],
  },
];

const BASE_GENERATION = BigInt(4);

const APPROVE_RESPONSE = {
  newGeneration: BigInt(5),
  reopenedTaskIds: ["task-003", "task-004"],
};

const PENDING_PROPOSAL = {
  proposalId: "replan-proposal-ui",
  featureId: "feat-001",
  baseGeneration: BASE_GENERATION,
  baseCompileHash: "ui-base-hash",
  createdAt: 1_721_000_000_000n,
  edits: [{ path: "stories/S2.md", newContent: "Revised approach for story" }],
  displayFiles: DIFF_FILES.map((file) => ({
    path: file.path,
    lines: file.lines.map((line) => ({ kind: line.type, content: line.content })),
  })),
};

function makeApproveClient(callLog: string[]): DaemonClient {
  return {
    approveReplan: async () => {
      callLog.push("approveReplan");
      return APPROVE_RESPONSE;
    },
  } as unknown as DaemonClient;
}

function makeConflictApproveClient(callLog: string[]): DaemonClient {
  return {
    approveReplan: async () => {
      callLog.push("approveReplan");
      throw new ConnectError(
        "base generation mismatch: expected 4, current is 6",
        Code.Aborted
      );
    },
  } as unknown as DaemonClient;
}

function makeFailedApproveClient(error: Error): DaemonClient {
  return {
    approveReplan: async () => {
      throw error;
    },
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReplanApproval — re-planning diff approval flow (Story 002 T3)", () => {
  describe("initial render — diff + base generation", () => {
    it("renders the DiffPane root before approval", () => {
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.diffPane.root)
      ).toBeInTheDocument();
    });

    it("renders the base generation value (4) before approval", () => {
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      // baseGeneration=BigInt(4) must render as "4"
      expect(
        screen.getByTestId(locators.planFlows.replan.baseGeneration)
      ).toHaveTextContent("4");
    });

    it("renders the approve trigger button before approval", () => {
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      expect(
        screen.getByTestId(locators.planFlows.replan.approve)
      ).toBeInTheDocument();
    });

    it("does not render re-opened tasks before approval", () => {
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      expect(
        screen.queryByTestId(locators.planFlows.replan.reopenedTasks)
      ).not.toBeInTheDocument();
    });
  });

  describe("approve invokes approveReplan and renders re-opened gates", () => {
    it("invokes onSuccess exactly once after a successful approval", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(
        <DaemonClientProvider client={makeApproveClient([])}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
            onSuccess={onSuccess}
          />
        </DaemonClientProvider>
      );

      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      await screen.findByTestId(locators.planFlows.replan.reopenedTasks);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    it("renders the re-opened tasks section after approve", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      const reopened = await screen.findByTestId(
        locators.planFlows.replan.reopenedTasks
      );
      expect(reopened).toBeInTheDocument();
    });

    it("re-opened tasks section contains task-003", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      const reopened = await screen.findByTestId(
        locators.planFlows.replan.reopenedTasks
      );
      expect(reopened).toHaveTextContent("task-003");
    });

    it("re-opened tasks section contains task-004", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      const reopened = await screen.findByTestId(
        locators.planFlows.replan.reopenedTasks
      );
      expect(reopened).toHaveTextContent("task-004");
    });

    it("calls exactly approveReplan on the client (no other method)", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      await screen.findByTestId(locators.planFlows.replan.reopenedTasks);
      expect(callLog).toEqual(["approveReplan"]);
    });
  });

  describe("server-stored pending proposal", () => {
    it("renders the live diff and base generation, then approves with only proposalId and actor", async () => {
      const user = userEvent.setup();
      const requests: unknown[] = [];
      const client = {
        approveReplan: async (request: { proposalId: string; actor: string }) => {
          requests.push(request);
          return APPROVE_RESPONSE;
        },
      } as unknown as DaemonClient;

      render(
        <DaemonClientProvider client={client}>
          <ReplanApproval proposal={PENDING_PROPOSAL} actor="operator@kanthord" />
        </DaemonClientProvider>,
      );

      expect(screen.getByTestId(locators.diffPane.root)).toHaveTextContent("Revised approach for story");
      expect(screen.getByTestId(locators.planFlows.replan.baseGeneration)).toHaveTextContent("4");
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      await screen.findByTestId(locators.planFlows.replan.reopenedTasks);
      expect(requests).toEqual([{ proposalId: PENDING_PROPOSAL.proposalId, actor: "operator@kanthord" }]);
    });
  });

  describe("base-generation-mismatch CONFLICT fixture (Code.Aborted)", () => {
    it("does not invoke onSuccess when approval reports a generation conflict", async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(
        <DaemonClientProvider client={makeConflictApproveClient([])}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
            onSuccess={onSuccess}
          />
        </DaemonClientProvider>
      );

      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      await screen.findByTestId(locators.planFlows.replan.conflict);
      expect(onSuccess).not.toHaveBeenCalled();
    });
    it("renders the typed conflict element on generation mismatch", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeConflictApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      const conflict = await screen.findByTestId(
        locators.planFlows.replan.conflict
      );
      expect(conflict).toBeInTheDocument();
    });

    it("conflict element contains the mismatch message text", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeConflictApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      const conflict = await screen.findByTestId(
        locators.planFlows.replan.conflict
      );
      expect(conflict).toHaveTextContent("mismatch");
    });

    it("does not render the re-opened tasks element on conflict", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeConflictApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      await screen.findByTestId(locators.planFlows.replan.conflict);
      expect(
        screen.queryByTestId(locators.planFlows.replan.reopenedTasks)
      ).not.toBeInTheDocument();
    });

    it("the fake client saw exactly one approveReplan call — no double-apply", async () => {
      const user = userEvent.setup();
      const callLog: string[] = [];
      render(
        <DaemonClientProvider client={makeConflictApproveClient(callLog)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
          />
        </DaemonClientProvider>
      );
      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      await screen.findByTestId(locators.planFlows.replan.conflict);
      // Exactly one attempt, no retry or double-apply
      expect(callLog).toEqual(["approveReplan"]);
    });
  });

  describe("generic approval failures", () => {
    it.each([
      new ConnectError("service failure", Code.Internal),
      new Error("transport failure"),
    ])("renders an inline destructive alert and does not invoke onSuccess for %p", async (error) => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      render(
        <DaemonClientProvider client={makeFailedApproveClient(error)}>
          <ReplanApproval
            featureId="feat-001"
            actor="operator@kanthord"
            baseGeneration={BASE_GENERATION}
            files={DIFF_FILES}
            onSuccess={onSuccess}
          />
        </DaemonClientProvider>
      );

      await user.click(screen.getByTestId(locators.planFlows.replan.approve));
      const failure = await screen.findByTestId(locators.planFlows.replan.error);
      expect(failure).toHaveAttribute("role", "alert");
      expect(failure).toHaveClass("text-destructive");
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });
});
