/**
 * Story 004 T1 — ApprovalActions component tests.
 *
 * Behavioral contract (Story 004 ACs):
 *
 *   PARKED STATE (github.merge approval waiting):
 *   - Renders the verb (e.g. "github.merge") and target from the VM
 *   - ApprovalStateBadge renders the "parked" state
 *   - The approve trigger button is ENABLED
 *   - Clicking the trigger opens the ConfirmActionDialog (DESIGN §7 destructive/
 *     irreversible verbs always go through alert-dialog)
 *   - Cancelling the dialog → respondToApproval is NOT called (no side-effect)
 *   - Confirming → respondToApproval called with { id: vm.id, approve: true }
 *   - After successful approval → success state element rendered (item leaves
 *     the parked state; the operation proceeded)
 *   - The expired alert is NOT rendered for a parked item
 *
 *   EXPIRED STATE:
 *   - ApprovalStateBadge renders the "expired" state (distinct from parked)
 *   - The approve trigger button is DISABLED — the UI blocks submission
 *   - The expired alert element is rendered
 *   - respondToApproval is NOT called (clicking the disabled trigger cannot
 *     open the dialog; the fake client receives zero calls)
 *
 * Fake-client convention (established Story 001 pattern): wrap in
 * <DaemonClientProvider client={fake}> with an inline DaemonClient fake.
 * The approve action calls client.respondToApproval (RespondToApproval RPC).
 * Confirm/cancel buttons use the shared ConfirmActionDialog locators
 * (locators.confirmDialog.{confirm,cancel}) per DESIGN §8.
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/approvals/ApprovalActions.tsx does not exist
 *   - clients/web/src/approvals/approval-vm.ts does not exist
 *   - locators.approvals.{approveTrigger, expiredAlert, successState, verb, target}
 *     are not in the registry
 *   - locators.status.approvalStateBadge is not in the registry
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalActions } from "@/approvals/ApprovalActions";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import type { DaemonClient } from "@/lib/client";
import { locators } from "@/locators";
import type { ApprovalItemVM } from "@/approvals/approval-vm";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARKED_VM: ApprovalItemVM = {
  id: "item-approval-001",
  verb: "github.merge",
  target: "acme/repo#42",
  state: "parked",
};

const EXPIRED_VM: ApprovalItemVM = {
  id: "item-approval-002",
  verb: "github.merge",
  target: "acme/repo#43",
  state: "expired",
  expiresAt: 1752451200000n,
};

// ---------------------------------------------------------------------------
// Fake clients
// ---------------------------------------------------------------------------

interface CallRecord {
  method: string;
  args: unknown;
}

function makeApprovalClient(callLog: CallRecord[]): DaemonClient {
  return {
    respondToApproval: async (req: unknown) => {
      callLog.push({ method: "respondToApproval", args: req });
      return { status: "resolved" };
    },
  } as unknown as DaemonClient;
}

/**
 * Fake for the expired path: callLog-based so the test can assert zero calls
 * after interaction with a disabled trigger.
 */
function makeZeroCallClient(callLog: CallRecord[]): DaemonClient {
  return {
    respondToApproval: async (req: unknown) => {
      callLog.push({ method: "respondToApproval", args: req });
      return { status: "resolved" };
    },
  } as unknown as DaemonClient;
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderActions(vm: ApprovalItemVM, client: DaemonClient) {
  return render(
    <DaemonClientProvider client={client}>
      <ApprovalActions vm={vm} />
    </DaemonClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalActions — approval-tier verb actions (Story 004 T1)", () => {
  describe("parked github.merge — context + enabled approve path", () => {
    it("renders the verb from the VM", () => {
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      expect(screen.getByTestId(locators.approvals.verb)).toHaveTextContent(
        "github.merge",
      );
    });

    it("renders the target from the VM", () => {
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      expect(screen.getByTestId(locators.approvals.target)).toHaveTextContent(
        "acme/repo#42",
      );
    });

    it("the approve trigger button is enabled for a parked item", () => {
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      const trigger = screen.getByTestId(locators.approvals.approveTrigger);
      expect(trigger).not.toBeDisabled();
    });

    it("cancelling the confirm dialog does not call respondToApproval", async () => {
      const user = userEvent.setup();
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      await user.click(screen.getByTestId(locators.approvals.approveTrigger));
      await user.click(screen.getByTestId(locators.confirmDialog.cancel));
      expect(callLog).toHaveLength(0);
    });

    it("confirming calls respondToApproval with approve=true", async () => {
      const user = userEvent.setup();
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      await user.click(screen.getByTestId(locators.approvals.approveTrigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await waitFor(() => expect(callLog).toHaveLength(1));
      const call = callLog[0] as {
        method: string;
        args: { approve: boolean; confirmedCategory: string };
      };
      expect(call.method).toBe("respondToApproval");
      expect(call.args.approve).toBe(true);
      expect(call.args.confirmedCategory).toBe("approval");
    });

    it("confirming calls respondToApproval with the VM id", async () => {
      const user = userEvent.setup();
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      await user.click(screen.getByTestId(locators.approvals.approveTrigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      await waitFor(() => expect(callLog).toHaveLength(1));
      const call = callLog[0] as { method: string; args: { id: string } };
      expect(call.args.id).toBe("item-approval-001");
    });

    it("success state renders after the approval is confirmed", async () => {
      const user = userEvent.setup();
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      await user.click(screen.getByTestId(locators.approvals.approveTrigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));
      const successEl = await screen.findByTestId(locators.approvals.successState);
      expect(successEl).toBeInTheDocument();
    });

    it("does not render the expired alert for a parked item", () => {
      const callLog: CallRecord[] = [];
      renderActions(PARKED_VM, makeApprovalClient(callLog));
      expect(
        screen.queryByTestId(locators.approvals.expiredAlert),
      ).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Error handling — respondToApproval rejects (B4, reviewer blocker)
  // -----------------------------------------------------------------------

  describe("error handling — respondToApproval rejects (B4)", () => {
    it("calls respondToApproval, renders inline error state, and does NOT show success when the call rejects", async () => {
      // handleApprove has no try/catch; locators.approvals.errorState does not
      // exist yet — both are part of the failing state the SE must fix.
      const user = userEvent.setup();
      const spy = vi.fn().mockRejectedValue(new Error("server error"));
      const client: DaemonClient = {
        respondToApproval: spy,
      } as unknown as DaemonClient;

      renderActions(PARKED_VM, client);

      await user.click(screen.getByTestId(locators.approvals.approveTrigger));
      await user.click(screen.getByTestId(locators.confirmDialog.confirm));

      // The mutation must have been attempted.
      await waitFor(() => expect(spy).toHaveBeenCalledOnce());

      // locators.approvals.errorState is the new locator the SE must add.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorEl = await screen.findByTestId((locators.approvals as any).errorState);
      expect(errorEl).toBeInTheDocument();

      // Success state must NOT appear when the call rejected.
      expect(
        screen.queryByTestId(locators.approvals.successState)
      ).not.toBeInTheDocument();
    });
  });

  describe("expired github.merge — disabled approve + expired state rendering", () => {
    it("the approve trigger button is disabled for an expired item", () => {
      const callLog: CallRecord[] = [];
      renderActions(EXPIRED_VM, makeZeroCallClient(callLog));
      const trigger = screen.getByTestId(locators.approvals.approveTrigger);
      expect(trigger).toBeDisabled();
    });

    it("renders the expired alert for an expired item", () => {
      const callLog: CallRecord[] = [];
      renderActions(EXPIRED_VM, makeZeroCallClient(callLog));
      expect(screen.getByTestId(locators.approvals.expiredAlert)).toBeInTheDocument();
    });

    it("renders ApprovalStateBadge with the expired (secondary) variant", () => {
      const callLog: CallRecord[] = [];
      renderActions(EXPIRED_VM, makeZeroCallClient(callLog));
      const badge = screen.getByTestId(locators.status.approvalStateBadge);
      expect(badge).toHaveAttribute("data-variant", "secondary");
    });

    it("respondToApproval is never called for an expired item — clicking the disabled trigger is a no-op", async () => {
      const user = userEvent.setup();
      const callLog: CallRecord[] = [];
      renderActions(EXPIRED_VM, makeZeroCallClient(callLog));
      const trigger = screen.getByTestId(locators.approvals.approveTrigger);
      expect(trigger).toBeDisabled();
      // Clicking a disabled button must not open the dialog or invoke the client.
      await user.click(trigger);
      // The ConfirmActionDialog content portal must not be in the DOM.
      expect(
        screen.queryByTestId(locators.confirmDialog.content),
      ).not.toBeInTheDocument();
      // The client received zero calls.
      expect(callLog).toHaveLength(0);
    });
  });
});
