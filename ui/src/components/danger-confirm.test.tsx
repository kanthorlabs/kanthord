// S7 — DangerConfirm: AlertDialog wrapper requiring explicit confirm step.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { DangerConfirm } from "./danger-confirm";

afterEach(() => {
  cleanup();
});

function renderDangerConfirm(onConfirm = vi.fn()) {
  return render(
    <DangerConfirm
      trigger={<button>Remove dependency</button>}
      title="Remove dependency?"
      description="This will remove the dependency from the task."
      confirmLabel="Remove"
      onConfirm={onConfirm}
    />,
  );
}

describe("DangerConfirm", () => {
  test("at rest: trigger is visible, accept is not", () => {
    renderDangerConfirm();
    expect(screen.getByText("Remove dependency")).toBeInTheDocument();
    expect(
      screen.queryByTestId("danger-confirm-accept"),
    ).not.toBeInTheDocument();
  });

  test("after clicking trigger: accept, cancel, title and description visible; onConfirm not called", () => {
    const onConfirm = vi.fn();
    renderDangerConfirm(onConfirm);

    fireEvent.click(screen.getByText("Remove dependency"));

    expect(screen.getByTestId("danger-confirm-accept")).toBeInTheDocument();
    expect(screen.getByTestId("danger-confirm-cancel")).toBeInTheDocument();
    expect(screen.getByText("Remove dependency?")).toBeInTheDocument();
    expect(
      screen.getByText("This will remove the dependency from the task."),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("clicking accept calls onConfirm exactly once", () => {
    const onConfirm = vi.fn();
    renderDangerConfirm(onConfirm);

    fireEvent.click(screen.getByText("Remove dependency"));
    fireEvent.click(screen.getByTestId("danger-confirm-accept"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("clicking cancel does not call onConfirm and accept leaves document", () => {
    const onConfirm = vi.fn();
    renderDangerConfirm(onConfirm);

    fireEvent.click(screen.getByText("Remove dependency"));
    fireEvent.click(screen.getByTestId("danger-confirm-cancel"));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("danger-confirm-accept"),
    ).not.toBeInTheDocument();
  });

  test("accept is not a DOM sibling of the trigger (portalled)", () => {
    renderDangerConfirm();

    fireEvent.click(screen.getByText("Remove dependency"));

    const trigger = screen.getByTestId("danger-confirm-trigger");
    const accept = screen.getByTestId("danger-confirm-accept");
    // AlertDialogContent portals to document.body, so trigger's parent
    // should not contain the accept button
    expect(trigger.parentElement).not.toContainElement(accept);
  });

  test("accept button carries destructive variant", () => {
    renderDangerConfirm();

    fireEvent.click(screen.getByText("Remove dependency"));

    expect(screen.getByTestId("danger-confirm-accept")).toHaveAttribute(
      "data-variant",
      "destructive",
    );
  });
});
