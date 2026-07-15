/**
 * Story 006 T1 — BreakerStateBadge component tests (DESIGN §4 domain badge).
 *
 * BreakerStateBadge maps circuit-breaker domain states to the visual vocabulary
 * (DESIGN §4): a domain badge composite beside BudgetRow entries.
 *
 * Domain → tone → badge-variant mapping:
 *   closed    → success  → success       (circuit healthy/normal)
 *   open      → danger   → destructive   (circuit tripped/budget exceeded)
 *   half-open → warning  → warning       (circuit testing recovery)
 *   unknown   → neutral  → secondary     (fallback for any unrecognised state)
 *
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because:
 *   - clients/web/src/components/status/BreakerStateBadge.tsx does not exist
 *   - locators.status.breakerStateBadge is not yet in the registry
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BreakerStateBadge } from "@/components/status/BreakerStateBadge";
import { locators } from "@/locators";

describe("BreakerStateBadge — DESIGN §4 domain→tone→variant mapping (Story 006 T1)", () => {
  it("closed state renders the success variant (success tone)", () => {
    render(<BreakerStateBadge state="closed" />);
    const badge = screen.getByTestId(locators.status.breakerStateBadge);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-variant", "success");
  });

  it("open state renders the destructive variant (danger tone)", () => {
    render(<BreakerStateBadge state="open" />);
    const badge = screen.getByTestId(locators.status.breakerStateBadge);
    expect(badge).toHaveAttribute("data-variant", "destructive");
  });

  it("half-open state renders the warning variant (warning tone)", () => {
    render(<BreakerStateBadge state="half-open" />);
    const badge = screen.getByTestId(locators.status.breakerStateBadge);
    expect(badge).toHaveAttribute("data-variant", "warning");
  });

  it("unknown state falls back to secondary variant (neutral tone)", () => {
    render(<BreakerStateBadge state="unknown-breaker-state" />);
    const badge = screen.getByTestId(locators.status.breakerStateBadge);
    expect(badge).toHaveAttribute("data-variant", "secondary");
  });

  it("renders the state text as badge content — closed", () => {
    render(<BreakerStateBadge state="closed" />);
    expect(screen.getByTestId(locators.status.breakerStateBadge)).toHaveTextContent("closed");
  });

  it("renders the state text as badge content — open", () => {
    render(<BreakerStateBadge state="open" />);
    expect(screen.getByTestId(locators.status.breakerStateBadge)).toHaveTextContent("open");
  });

  it("renders the state text as badge content — half-open", () => {
    render(<BreakerStateBadge state="half-open" />);
    expect(screen.getByTestId(locators.status.breakerStateBadge)).toHaveTextContent("half-open");
  });
});
