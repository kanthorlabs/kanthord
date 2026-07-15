/**
 * Story 003 T1 — EscalationSeverityBadge component tests (DESIGN §4).
 *
 * Domain → Tone → BadgeVariant mapping:
 *   severity "high"   → danger   → destructive
 *   severity "medium" → warning  → warning
 *   severity "low"    → info     → default
 *   severity "" (unknown) → neutral → secondary  (fallback)
 *
 * Type-based distinct rendering (DESIGN §4, daily-usage Input 2):
 *   type "unclassified-artifact-change" → visually distinct badge
 *     (locators.status.unclassifiedBadge, NOT locators.status.severityBadge)
 *   all other types → normal severity badge (locators.status.severityBadge)
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/components/status/EscalationSeverityBadge.tsx does not exist
 *   - locators.status.severityBadge is not in the registry
 *   - locators.status.unclassifiedBadge is not in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EscalationSeverityBadge } from "@/components/status/EscalationSeverityBadge";
import { locators } from "@/locators";

describe("EscalationSeverityBadge — DESIGN §4 domain→tone→variant mapping", () => {
  describe("severity → badge variant (normal escalation types)", () => {
    it("severity 'high' renders the destructive variant (danger tone)", () => {
      render(<EscalationSeverityBadge type="write-access-request" severity="high" />);
      const badge = screen.getByTestId(locators.status.severityBadge);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-variant", "destructive");
    });

    it("severity 'medium' renders the warning variant (warning tone)", () => {
      render(<EscalationSeverityBadge type="write-access-request" severity="medium" />);
      const badge = screen.getByTestId(locators.status.severityBadge);
      expect(badge).toHaveAttribute("data-variant", "warning");
    });

    it("severity 'low' renders the default variant (info tone)", () => {
      render(<EscalationSeverityBadge type="write-access-request" severity="low" />);
      const badge = screen.getByTestId(locators.status.severityBadge);
      expect(badge).toHaveAttribute("data-variant", "default");
    });

    it("unknown severity falls back to secondary variant (neutral tone)", () => {
      render(<EscalationSeverityBadge type="write-access-request" severity="" />);
      const badge = screen.getByTestId(locators.status.severityBadge);
      expect(badge).toHaveAttribute("data-variant", "secondary");
    });

    it("severity text is rendered as badge content", () => {
      render(<EscalationSeverityBadge type="write-access-request" severity="high" />);
      const badge = screen.getByTestId(locators.status.severityBadge);
      expect(badge).toHaveTextContent("high");
    });

    it("does NOT render the unclassified badge for normal escalation types", () => {
      render(<EscalationSeverityBadge type="write-access-request" severity="high" />);
      expect(
        screen.queryByTestId(locators.status.unclassifiedBadge)
      ).not.toBeInTheDocument();
    });
  });

  describe("type 'unclassified-artifact-change' renders a distinct badge", () => {
    it("unclassified-artifact-change renders with the unclassified badge testid", () => {
      render(
        <EscalationSeverityBadge
          type="unclassified-artifact-change"
          severity="medium"
        />
      );
      expect(
        screen.getByTestId(locators.status.unclassifiedBadge)
      ).toBeInTheDocument();
    });

    it("unclassified-artifact-change does NOT render the standard severity badge", () => {
      render(
        <EscalationSeverityBadge
          type="unclassified-artifact-change"
          severity="medium"
        />
      );
      expect(
        screen.queryByTestId(locators.status.severityBadge)
      ).not.toBeInTheDocument();
    });

    it("unclassified badge carries the type label in its content", () => {
      render(
        <EscalationSeverityBadge
          type="unclassified-artifact-change"
          severity="medium"
        />
      );
      const badge = screen.getByTestId(locators.status.unclassifiedBadge);
      expect(badge).toHaveTextContent("unclassified-artifact-change");
    });
  });
});
