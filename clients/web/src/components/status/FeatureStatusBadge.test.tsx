/**
 * Story 001 T1 — FeatureStatusBadge component tests.
 *
 * Asserts the domain→tone→badge-variant mapping (DESIGN §4):
 *   pending  → neutral  → secondary
 *   running  → info     → default
 *   done     → success  → success
 *   error    → danger   → destructive
 *   halted   → warning  → warning
 *   unknown  → neutral  → secondary   (fallback)
 *
 * Badge data-variant comes from the vendored badge.tsx:
 *   data-variant={variant}
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because FeatureStatusBadge module does not exist yet and
 * locators.status.featureBadge is not yet in the registry.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureStatusBadge } from "@/components/status/FeatureStatusBadge";
import { locators } from "@/locators";

describe("FeatureStatusBadge — DESIGN §4 domain→tone→variant mapping", () => {
  it("pending status renders the secondary variant (neutral tone)", () => {
    render(<FeatureStatusBadge status="pending" />);
    const badge = screen.getByTestId(locators.status.featureBadge);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-variant", "secondary");
  });

  it("running status renders the default variant (info tone)", () => {
    render(<FeatureStatusBadge status="running" />);
    const badge = screen.getByTestId(locators.status.featureBadge);
    expect(badge).toHaveAttribute("data-variant", "default");
  });

  it("done status renders the success variant (success tone)", () => {
    render(<FeatureStatusBadge status="done" />);
    const badge = screen.getByTestId(locators.status.featureBadge);
    expect(badge).toHaveAttribute("data-variant", "success");
  });

  it("error status renders the destructive variant (danger tone)", () => {
    render(<FeatureStatusBadge status="error" />);
    const badge = screen.getByTestId(locators.status.featureBadge);
    expect(badge).toHaveAttribute("data-variant", "destructive");
  });

  it("halted status renders the warning variant (warning tone)", () => {
    render(<FeatureStatusBadge status="halted" />);
    const badge = screen.getByTestId(locators.status.featureBadge);
    expect(badge).toHaveAttribute("data-variant", "warning");
  });

  it("unknown status falls back to secondary variant (neutral tone)", () => {
    render(<FeatureStatusBadge status="unknown-status-value" />);
    const badge = screen.getByTestId(locators.status.featureBadge);
    expect(badge).toHaveAttribute("data-variant", "secondary");
  });

  it("renders the status text as badge content", () => {
    render(<FeatureStatusBadge status="running" />);
    const badge = screen.getByTestId(locators.status.featureBadge);
    expect(badge).toHaveTextContent("running");
  });
});
