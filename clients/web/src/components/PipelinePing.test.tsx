import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelinePing } from "@/components/PipelinePing.tsx";
import { locators } from "@/locators.ts";

describe("PipelinePing (020.1 pipeline-ping story)", () => {
  it("renders the label text via the label locator", () => {
    render(<PipelinePing label="pipeline live" />);
    expect(
      screen.getByTestId(locators.pipelinePing.label)
    ).toHaveTextContent("pipeline live");
  });

  it("renders a badge with text 'ready' via the badge locator", () => {
    render(<PipelinePing label="pipeline live" />);
    const badge = screen.getByTestId(locators.pipelinePing.badge);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("ready");
  });

  it("badge carries a semantic-token class, not a raw palette class", () => {
    render(<PipelinePing label="pipeline live" />);
    const badge = screen.getByTestId(locators.pipelinePing.badge);
    // The default Badge variant uses bg-primary (semantic token, DESIGN §3).
    expect(badge.className).toContain("bg-primary");
  });
});
