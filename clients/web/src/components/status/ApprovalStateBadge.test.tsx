/**
 * Story 004 T1 — ApprovalStateBadge component tests (DESIGN §4).
 *
 * Domain → Tone → BadgeVariant mapping (DESIGN §4 + design/status.ts):
 *   "parked"  → warning tone → warning variant
 *     (approval is waiting — notable but not alarming; TONE_BADGE_VARIANT: warning → warning)
 *   "expired" → neutral tone → secondary variant
 *     (terminal state — de-emphasised; TONE_BADGE_VARIANT: neutral → secondary)
 *
 * The badge is unit-tested with the exact state values the Story names
 * (DESIGN §4 rule). Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/components/status/ApprovalStateBadge.tsx does not exist
 *   - locators.status.approvalStateBadge is not in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalStateBadge } from "@/components/status/ApprovalStateBadge";
import { locators } from "@/locators";

describe("ApprovalStateBadge — DESIGN §4 domain→tone→variant mapping", () => {
  describe("'parked' state → warning tone → warning variant", () => {
    it("parked renders with the warning variant", () => {
      render(<ApprovalStateBadge state="parked" />);
      const badge = screen.getByTestId(locators.status.approvalStateBadge);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-variant", "warning");
    });

    it("parked badge carries the state label as content", () => {
      render(<ApprovalStateBadge state="parked" />);
      const badge = screen.getByTestId(locators.status.approvalStateBadge);
      expect(badge).toHaveTextContent("parked");
    });
  });

  describe("'expired' state → neutral tone → secondary variant", () => {
    it("expired renders with the secondary variant", () => {
      render(<ApprovalStateBadge state="expired" />);
      const badge = screen.getByTestId(locators.status.approvalStateBadge);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-variant", "secondary");
    });

    it("expired badge carries the state label as content", () => {
      render(<ApprovalStateBadge state="expired" />);
      const badge = screen.getByTestId(locators.status.approvalStateBadge);
      expect(badge).toHaveTextContent("expired");
    });
  });

  describe("parked and expired are visually distinct", () => {
    it("parked and expired render different badge variants", () => {
      const { rerender } = render(<ApprovalStateBadge state="parked" />);
      const parkedVariant = screen
        .getByTestId(locators.status.approvalStateBadge)
        .getAttribute("data-variant");

      rerender(<ApprovalStateBadge state="expired" />);
      const expiredVariant = screen
        .getByTestId(locators.status.approvalStateBadge)
        .getAttribute("data-variant");

      expect(parkedVariant).not.toBe(expiredVariant);
    });
  });
});
