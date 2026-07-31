// S7 — CommandHandoff: renders CLI command verbatim, copyable, with handoff note.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { CommandHandoff } from "./command-handoff";

afterEach(() => {
  cleanup();
});

describe("CommandHandoff", () => {
  test("command is rendered verbatim in a code element", () => {
    render(
      <CommandHandoff
        command="kanthord approve task 01J..."
        reason="This requires direct git access."
      />,
    );
    const el = screen.getByTestId("command-handoff-command");
    expect(el).toHaveTextContent("kanthord approve task 01J...");
    expect(el.tagName).toBe("CODE");
  });

  test("shell quoting in command is preserved unchanged", () => {
    render(
      <CommandHandoff
        command='kanthord create task --title "a b"'
        reason="Creates a task with a quoted title."
      />,
    );
    const el = screen.getByTestId("command-handoff-command");
    expect(el.textContent).toBe('kanthord create task --title "a b"');
    expect(el.innerHTML).not.toContain("&quot;");
  });

  test("note contains 'not in the browser' and the reason verbatim", () => {
    render(
      <CommandHandoff
        command="kanthord approve task 01J..."
        reason="This requires direct git access."
      />,
    );
    const note = screen.getByTestId("command-handoff-note");
    expect(note.textContent).toContain("not in the browser");
    expect(note.textContent).toContain("This requires direct git access.");
  });

  test("copy button calls clipboard.writeText with the exact command", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <CommandHandoff
        command="kanthord approve task 01J..."
        reason="This requires direct git access."
      />,
    );
    fireEvent.click(screen.getByTestId("command-handoff-copy"));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("kanthord approve task 01J...");
  });

  test("click does not throw when navigator.clipboard is absent", () => {
    // delete clipboard to simulate non-secure context
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(
      <CommandHandoff
        command="kanthord approve task 01J..."
        reason="This requires direct git access."
      />,
    );
    expect(() => {
      fireEvent.click(screen.getByTestId("command-handoff-copy"));
    }).not.toThrow();

    // restore
    if (descriptor) {
      Object.defineProperty(navigator, "clipboard", descriptor);
    }
  });
});
