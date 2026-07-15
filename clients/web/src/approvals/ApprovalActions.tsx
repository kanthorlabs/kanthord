/**
 * ApprovalActions — Story 004 T1 approval-tier verb actions component.
 *
 * Renders context (verb + target) and an approve action for a parked or
 * expired approval-tier operation (e.g. github.merge).
 *
 * PARKED: enabled approve trigger → ConfirmActionDialog (DESIGN §7 destructive
 * verbs always go through alert-dialog) → respondToApproval on confirm →
 * successState on API resolution. On rejection → inline errorState (B4).
 *
 * EXPIRED: expiredAlert rendered, approve trigger disabled — no API call
 * possible (Epic 017/026 expiry contract; ring-1 enforces server-side).
 *
 * Semantic tokens only (DESIGN §3). Domain state via ApprovalStateBadge
 * composite (DESIGN §4). Locators from registry only (DESIGN §8).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { ApprovalStateBadge } from "@/components/status/ApprovalStateBadge";
import { useDaemonClient } from "@/auth/DaemonClientProvider";
import { locators } from "@/locators";
import type { ApprovalItemVM } from "./approval-vm";

interface ApprovalActionsProps {
  vm: ApprovalItemVM;
  onSuccess?: () => void | Promise<void>;
}

export function ApprovalActions({ vm, onSuccess }: ApprovalActionsProps) {
  const client = useDaemonClient();
  const [approved, setApproved] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null); // B4

  const handleApprove = async () => {
    setApprovalError(null);
    try {
      await client.respondToApproval({
        id: vm.id,
        approve: true,
        reason: "",
        confirmedCategory: "",
      });
      await onSuccess?.();
      setApproved(true);
    } catch (err: unknown) {
      // B4: surface rejection inline; do NOT set success state on failure
      setApprovalError(err instanceof Error ? err.message : "Approval failed");
    }
  };

  return (
    <div>
      <span data-testid={locators.approvals.verb}>{vm.verb}</span>
      <span data-testid={locators.approvals.target}>{vm.target}</span>

      <ApprovalStateBadge state={vm.state} />

      {/* B4: inline error state when respondToApproval rejects */}
      {approvalError !== null && (
        <div
          data-testid={locators.approvals.errorState}
          className="text-sm text-destructive"
        >
          {approvalError}
        </div>
      )}

      {vm.state === "expired" && (
        <>
          <Alert data-testid={locators.approvals.expiredAlert}>
            <AlertDescription>This approval has expired.</AlertDescription>
          </Alert>
          <Button
            data-testid={locators.approvals.approveTrigger}
            disabled
          >
            Approve
          </Button>
        </>
      )}

      {vm.state === "parked" && !approved && (
        <ConfirmActionDialog
          trigger={
            <Button data-testid={locators.approvals.approveTrigger}>
              Approve
            </Button>
          }
          title="Approve action"
          description="Are you sure you want to approve this action?"
          onConfirm={handleApprove}
        />
      )}

      {vm.state === "parked" && approved && (
        <div data-testid={locators.approvals.successState}>
          Approved successfully
        </div>
      )}
    </div>
  );
}
