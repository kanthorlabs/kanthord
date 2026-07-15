/**
 * ApprovalStateBadge — DESIGN §4 domain badge for approval-tier items.
 *
 * Domain → Tone → BadgeVariant mapping:
 *   "parked"  → warning tone → warning variant
 *     (approval is waiting — notable but not alarming)
 *   "expired" → neutral tone → secondary variant
 *     (terminal state — de-emphasised)
 *
 * Semantic tokens only (DESIGN §3). Domain state is never mapped to a
 * color/variant inline in a feature file (DESIGN §4 rule).
 */
import { Badge } from "@/components/ui/badge";
import { TONE_BADGE_VARIANT } from "@/design/status";
import type { Tone } from "@/design/status";
import { locators } from "@/locators";
// S2: import ApprovalState from the canonical VM module (no local redefinition)
import type { ApprovalState } from "@/approvals/approval-vm";

const APPROVAL_STATE_TONE: Record<ApprovalState, Tone> = {
  parked: "warning",   // → warning variant
  expired: "neutral",  // → secondary variant
};

interface ApprovalStateBadgeProps {
  state: ApprovalState;
}

export function ApprovalStateBadge({ state }: ApprovalStateBadgeProps) {
  const tone = APPROVAL_STATE_TONE[state];
  const variant = TONE_BADGE_VARIANT[tone];

  return (
    <Badge
      data-testid={locators.status.approvalStateBadge}
      variant={variant}
    >
      {state}
    </Badge>
  );
}
