import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HelloBanner } from "@/components/HelloBanner.tsx";
import { locators } from "@/locators.ts";

describe("HelloBanner (SU7 bootstrap hello-world)", () => {
  it("renders the label and a token-styled action button", () => {
    render(<HelloBanner label="kanthord control plane" />);
    expect(screen.getByTestId(locators.helloBanner.title)).toHaveTextContent("kanthord control plane");
    const action = screen.getByTestId(locators.helloBanner.action);
    expect(action).toBeInTheDocument();
    // Semantic-token styling (DESIGN §3): the vendored Button carries the
    // primary-token classes, not a raw palette class.
    expect(action.className).toContain("bg-primary");
  });
});
