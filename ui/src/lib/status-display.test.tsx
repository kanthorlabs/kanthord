import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EntityStatus } from "./status-display";

afterEach(() => {
  cleanup();
});

describe("EntityStatus", () => {
  test("axis=task value=pending → StatusChip with data-axis=task", () => {
    render(<EntityStatus axis="task" value="pending" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip).toHaveAttribute("data-axis", "task");
    expect(chip).toHaveAttribute("data-value", "pending");
  });

  test('axis=task value=unknown → status-raw with text "unknown", no status-chip', () => {
    render(<EntityStatus axis="task" value="unknown" />);
    expect(screen.getByTestId("status-raw")).toHaveTextContent("unknown");
    expect(screen.queryByTestId("status-chip")).not.toBeInTheDocument();
  });

  test("axis=initiative value=landed → StatusChip with data-axis=initiative", () => {
    render(<EntityStatus axis="initiative" value="landed" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip).toHaveAttribute("data-axis", "initiative");
    expect(chip).toHaveAttribute("data-value", "landed");
  });

  test('axis=initiative value=weird → status-raw with text "weird"', () => {
    render(<EntityStatus axis="initiative" value="weird" />);
    expect(screen.getByTestId("status-raw")).toHaveTextContent("weird");
    expect(screen.queryByTestId("status-chip")).not.toBeInTheDocument();
  });
});
