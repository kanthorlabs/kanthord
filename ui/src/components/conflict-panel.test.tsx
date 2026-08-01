// Story 02 Verify — conflict-panel: three values, reload, client-defect.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConflictPanel, ClientDefectNotice } from "./conflict-panel";

describe("ConflictPanel", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the three values distinctly", () => {
    const onReload = vi.fn();
    render(
      <ConflictPanel
        base={{ name: "base-val" }}
        draft="my-draft"
        current={{ name: "current-val" }}
        describe={(v) =>
          typeof v === "string" ? v : (v as { name: string }).name
        }
        onReload={onReload}
        reloading={false}
      />,
    );

    expect(screen.getByTestId("conflict-base").textContent).toContain(
      "base-val",
    );
    expect(screen.getByTestId("conflict-draft").textContent).toContain(
      "my-draft",
    );
    expect(screen.getByTestId("conflict-current").textContent).toContain(
      "current-val",
    );
  });

  test("when base === current, each row still holds its own value", () => {
    const onReload = vi.fn();
    render(
      <ConflictPanel
        base={{ name: "same" }}
        draft="draft"
        current={{ name: "same" }}
        describe={(v) =>
          typeof v === "string" ? v : (v as { name: string }).name
        }
        onReload={onReload}
        reloading={false}
      />,
    );

    expect(screen.getByTestId("conflict-base").textContent).toContain("same");
    expect(screen.getByTestId("conflict-draft").textContent).toContain("draft");
    expect(screen.getByTestId("conflict-current").textContent).toContain(
      "same",
    );
    // All three are distinct elements
    expect(screen.getByTestId("conflict-base")).not.toBe(
      screen.getByTestId("conflict-draft"),
    );
    expect(screen.getByTestId("conflict-draft")).not.toBe(
      screen.getByTestId("conflict-current"),
    );
  });

  test("container carries role=alert and data-role=attention", () => {
    render(
      <ConflictPanel
        base="b"
        draft="d"
        current="c"
        describe={String}
        onReload={vi.fn()}
        reloading={false}
      />,
    );
    const container = screen.getByTestId("conflict");
    expect(container).toHaveAttribute("role", "alert");
    expect(container).toHaveAttribute("data-role", "attention");
  });

  test("clicking reload calls onReload exactly once", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(
      <ConflictPanel
        base="b"
        draft="d"
        current="c"
        describe={String}
        onReload={onReload}
        reloading={false}
      />,
    );

    await user.click(screen.getByTestId("conflict-reload"));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  test("reloading: true renders reload button disabled and further click does not call onReload", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(
      <ConflictPanel
        base="b"
        draft="d"
        current="c"
        describe={String}
        onReload={onReload}
        reloading={true}
      />,
    );

    const btn = screen.getByTestId("conflict-reload");
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe("ClientDefectNotice", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders client-defect with data-role=danger and no conflict", () => {
    render(<ClientDefectNotice requestId={undefined} />);
    const el = screen.getByTestId("client-defect");
    expect(el).toHaveAttribute("role", "alert");
    expect(el).toHaveAttribute("data-role", "danger");
    expect(el.textContent).toContain("bug in this screen");
    // Must not render conflict panel
    expect(screen.queryByTestId("conflict")).toBeNull();
  });

  test("with requestId: undefined renders no client-defect-request-id", () => {
    render(<ClientDefectNotice requestId={undefined} />);
    expect(screen.queryByTestId("client-defect-request-id")).toBeNull();
  });

  test("with requestId: defined renders the request id code element", () => {
    render(<ClientDefectNotice requestId="REQ-123" />);
    const code = screen.getByTestId("client-defect-request-id");
    expect(code.textContent).toBe("REQ-123");
  });
});
