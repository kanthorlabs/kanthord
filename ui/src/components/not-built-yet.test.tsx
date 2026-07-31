// S4 — NotBuiltYet: honest unavailable state placeholder.
// Renders the exact sentence, carries data-epic, no link, no progressbar.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { NotBuiltYet } from "./not-built-yet";

afterEach(() => {
  cleanup();
});

describe("NotBuiltYet", () => {
  test("renders the exact sentence with surface and epic", () => {
    render(<NotBuiltYet surface="Inbox" epic="026.7" />);
    const el = screen.getByTestId("not-built-yet");
    expect(el.textContent).toBe(
      "Inbox is not built yet. EPIC 026.7 builds it.",
    );
    expect(el.getAttribute("data-epic")).toBe("026.7");
  });

  test("a different surface and epic renders the matching sentence", () => {
    render(<NotBuiltYet surface="Graph" epic="026.6" />);
    const el = screen.getByTestId("not-built-yet");
    expect(el.textContent).toBe(
      "Graph is not built yet. EPIC 026.6 builds it.",
    );
    expect(el.getAttribute("data-epic")).toBe("026.6");
  });

  test("contains no link and no progressbar", () => {
    render(<NotBuiltYet surface="Inbox" epic="026.7" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });
});
