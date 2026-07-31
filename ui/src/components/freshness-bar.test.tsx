// S6 — FreshnessBar: prop-driven, no clock, explicit "not updated yet" for null.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { FreshnessBar } from "./freshness-bar";

afterEach(() => {
  cleanup();
});

describe("FreshnessBar", () => {
  test("updatedAt=null renders 'not updated yet'", () => {
    render(<FreshnessBar updatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByTestId("freshness-updated")).toHaveTextContent(
      "not updated yet",
    );
  });

  test("updatedAt=9:05 renders 'Updated 09:05' with zero padding", () => {
    render(
      <FreshnessBar
        updatedAt={new Date(2026, 6, 31, 9, 5)}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("freshness-updated")).toHaveTextContent(
      "Updated 09:05",
    );
  });

  test("updatedAt=23:59 renders 'Updated 23:59'", () => {
    render(
      <FreshnessBar
        updatedAt={new Date(2026, 6, 31, 23, 59)}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("freshness-updated")).toHaveTextContent(
      "Updated 23:59",
    );
  });

  test("one click on refresh calls onRefresh exactly once", () => {
    const onRefresh = vi.fn();
    render(<FreshnessBar updatedAt={null} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId("freshness-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("refreshing omitted: control is enabled", () => {
    render(<FreshnessBar updatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByTestId("freshness-refresh")).not.toBeDisabled();
  });

  test("refreshing=true: control is disabled, click does not call onRefresh", () => {
    const onRefresh = vi.fn();
    render(
      <FreshnessBar updatedAt={null} onRefresh={onRefresh} refreshing={true} />,
    );
    expect(screen.getByTestId("freshness-refresh")).toBeDisabled();
    fireEvent.click(screen.getByTestId("freshness-refresh"));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  // --- human review regression test ---

  test("S2: refresh button has accessible name and type=button", () => {
    render(<FreshnessBar updatedAt={null} onRefresh={() => {}} />);
    const btn = screen.getByTestId("freshness-refresh");
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveAttribute("aria-label");
  });
});
