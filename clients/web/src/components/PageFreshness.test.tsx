import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageFreshness } from "@/components/PageFreshness";
import { locators } from "@/locators";

describe("PageFreshness — DESIGN §6 + §7", () => {
  it("renders the client fetch time as Updated HH:MM and uses the vendored Button", () => {
    render(
      <PageFreshness
        fetchedAt={new Date("2026-07-15T14:05:00")}
        onRefresh={async () => {}}
      />,
    );

    expect(screen.getByTestId(locators.pageFreshness.updated)).toHaveTextContent("Updated 14:05");
    expect(screen.getByTestId(locators.pageFreshness.refresh)).toHaveAttribute("data-slot", "button");
  });

  it("invokes an async refresh exactly once and disables the control while it is pending", async () => {
    const user = userEvent.setup();
    let completeRefresh: (() => void) | undefined;
    const onRefresh = vi.fn(
      () => new Promise<void>((resolve) => {
        completeRefresh = resolve;
      }),
    );

    render(
      <PageFreshness
        fetchedAt={new Date("2026-07-15T14:05:00")}
        onRefresh={onRefresh}
      />,
    );

    const refresh = screen.getByTestId(locators.pageFreshness.refresh);
    await user.click(refresh);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(refresh).toBeDisabled();
    expect(screen.getByTestId(locators.pageFreshness.spinner)).toBeInTheDocument();

    completeRefresh?.();
    await waitFor(() => expect(refresh).not.toBeDisabled());
    expect(screen.queryByTestId(locators.pageFreshness.spinner)).not.toBeInTheDocument();
  });

  it("does not poll", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn(async () => {});

    render(
      <PageFreshness
        fetchedAt={new Date("2026-07-15T14:05:00")}
        onRefresh={onRefresh}
      />,
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
