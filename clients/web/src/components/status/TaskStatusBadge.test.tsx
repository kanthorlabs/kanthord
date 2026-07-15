/**
 * Story 001 T2 — TaskStatusBadge component tests.
 *
 * Asserts the task-domain→tone→badge-variant mapping (DESIGN §4):
 *   pending  → neutral  → secondary
 *   running  → info     → default
 *   done     → success  → success
 *   error    → danger   → destructive
 *   halted   → warning  → warning
 *   unknown  → neutral  → secondary   (fallback)
 *
 * Badge data-variant comes from the vendored badge.tsx (data-variant prop).
 * Selection via registry locators only (DESIGN §8).
 *
 * RED: fails because TaskStatusBadge module does not exist yet and
 * locators.status.taskBadge is not yet in the registry.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskStatusBadge } from "@/components/status/TaskStatusBadge";
import { locators } from "@/locators";

describe("TaskStatusBadge — DESIGN §4 domain→tone→variant mapping", () => {
  it("pending status renders the secondary variant (neutral tone)", () => {
    render(<TaskStatusBadge status="pending" />);
    const badge = screen.getByTestId(locators.status.taskBadge);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-variant", "secondary");
  });

  it("running status renders the default variant (info tone)", () => {
    render(<TaskStatusBadge status="running" />);
    const badge = screen.getByTestId(locators.status.taskBadge);
    expect(badge).toHaveAttribute("data-variant", "default");
  });

  it("done status renders the success variant (success tone)", () => {
    render(<TaskStatusBadge status="done" />);
    const badge = screen.getByTestId(locators.status.taskBadge);
    expect(badge).toHaveAttribute("data-variant", "success");
  });

  it("error status renders the destructive variant (danger tone)", () => {
    render(<TaskStatusBadge status="error" />);
    const badge = screen.getByTestId(locators.status.taskBadge);
    expect(badge).toHaveAttribute("data-variant", "destructive");
  });

  it("halted status renders the warning variant (warning tone)", () => {
    render(<TaskStatusBadge status="halted" />);
    const badge = screen.getByTestId(locators.status.taskBadge);
    expect(badge).toHaveAttribute("data-variant", "warning");
  });

  it("unknown status falls back to secondary variant (neutral tone)", () => {
    render(<TaskStatusBadge status="unknown-task-status" />);
    const badge = screen.getByTestId(locators.status.taskBadge);
    expect(badge).toHaveAttribute("data-variant", "secondary");
  });

  it("renders the status text as badge content", () => {
    render(<TaskStatusBadge status="done" />);
    const badge = screen.getByTestId(locators.status.taskBadge);
    expect(badge).toHaveTextContent("done");
  });
});
