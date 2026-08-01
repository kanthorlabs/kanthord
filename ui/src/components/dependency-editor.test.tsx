// Story 07 Verify — dependency-editor: error codes, precondition note, option filtering.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DependencyEditor } from "./dependency-editor";
import type { DependencyCandidate } from "./dependency-editor";
import * as apiClient from "@/lib/api-client";

const mockAdd = vi.fn();
const mockRemove = vi.fn();

vi.mock("@/lib/api-client", () => ({
  get addDependency() {
    return (...args: unknown[]) => mockAdd(...args);
  },
  get removeDependency() {
    return (...args: unknown[]) => mockRemove(...args);
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    requestId?: string;
    constructor(
      status: number,
      code: string,
      message: string,
      requestId?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.requestId = requestId;
    }
  },
}));

const CANDIDATES: readonly DependencyCandidate[] = [
  { id: "t1", label: "Task A" },
  { id: "t2", label: "Task B" },
  { id: "t3", label: "Task C" },
];

describe("DependencyEditor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("dependency-add reveals options that exclude sourceId and existing deps, keep order", async () => {
    const user = userEvent.setup();
    mockAdd.mockResolvedValue(undefined);
    const onWritten = vi.fn();

    render(
      <DependencyEditor
        kind="task"
        sourceId="t2"
        sourceLabel="Task B"
        dependencies={["t1"]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={onWritten}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));

    // Options: t3 only (t2 is sourceId, t1 is already a dependency)
    const options = screen.getAllByTestId("dependency-option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAttribute("data-option-id", "t3");
    expect(options[0]!.textContent).toBe("Task C");
  });

  test("for kind: 'task' each option carries data-option-id and data-task-id", async () => {
    const user = userEvent.setup();
    mockAdd.mockResolvedValue(undefined);

    render(
      <DependencyEditor
        kind="task"
        sourceId="t3"
        sourceLabel="Task C"
        dependencies={[]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));

    const options = screen.getAllByTestId("dependency-option");
    for (const opt of options) {
      expect(opt).toHaveAttribute("data-option-id");
      expect(opt).toHaveAttribute("data-task-id");
    }
  });

  test("for kind: 'initiative' options carry data-option-id but not data-task-id", async () => {
    const user = userEvent.setup();
    mockAdd.mockResolvedValue(undefined);

    render(
      <DependencyEditor
        kind="initiative"
        sourceId="i1"
        sourceLabel="Init A"
        dependencies={[]}
        candidates={[
          { id: "i2", label: "Init B" },
          { id: "i3", label: "Init C" },
        ]}
        labelOf={(id) => id}
        onWritten={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));

    const options = screen.getAllByTestId("dependency-option");
    for (const opt of options) {
      expect(opt).toHaveAttribute("data-option-id");
      expect(opt).not.toHaveAttribute("data-task-id");
    }
  });

  test("clicking an option calls addDependency then onWritten", async () => {
    const user = userEvent.setup();
    mockAdd.mockResolvedValue(undefined);
    const onWritten = vi.fn();

    render(
      <DependencyEditor
        kind="task"
        sourceId="t3"
        sourceLabel="Task C"
        dependencies={[]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={onWritten}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));
    // Click the first option (t1 after filtering out sourceId t3)
    await user.click(screen.getByText("Task A"));

    expect(mockAdd).toHaveBeenCalledWith("task", "t3", "t1");
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  test("409 cycle_detected renders dependency-error with pinned message and data-code", async () => {
    const user = userEvent.setup();
    mockAdd.mockRejectedValue(
      new apiClient.ApiError(
        409,
        "cycle_detected",
        "That edge would close a cycle.",
      ),
    );

    render(
      <DependencyEditor
        kind="task"
        sourceId="t3"
        sourceLabel="Task C"
        dependencies={[]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));
    await user.click(screen.getByText("Task A"));

    const errEl = screen.getByTestId("dependency-error");
    expect(errEl.textContent).toBe("That edge would close a cycle.");
    expect(errEl).toHaveAttribute("data-code", "cycle_detected");
  });

  test("400 sequencing_scope renders its own distinct message — not the same as cycle_detected", async () => {
    const user = userEvent.setup();
    mockAdd
      .mockRejectedValueOnce(
        new apiClient.ApiError(
          409,
          "cycle_detected",
          "That edge would close a cycle.",
        ),
      )
      .mockRejectedValueOnce(
        new apiClient.ApiError(
          400,
          "sequencing_scope",
          "Both items must be in the same parent.",
        ),
      );

    const { unmount } = render(
      <DependencyEditor
        kind="task"
        sourceId="t3"
        sourceLabel="Task C"
        dependencies={[]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));
    await user.click(screen.getByText("Task A"));
    const msg1 = screen.getByTestId("dependency-error").textContent;

    unmount();

    render(
      <DependencyEditor
        kind="task"
        sourceId="t3"
        sourceLabel="Task C"
        dependencies={[]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));
    await user.click(screen.getByText("Task A"));
    const msg2 = screen.getByTestId("dependency-error").textContent;

    expect(msg1).not.toBe(msg2);
  });

  test("dependency-remove swaps to confirm; DELETE fires only on Confirm", async () => {
    const user = userEvent.setup();
    mockRemove.mockResolvedValue(undefined);
    const onWritten = vi.fn();

    render(
      <DependencyEditor
        kind="task"
        sourceId="t1"
        sourceLabel="Task A"
        dependencies={["t2"]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={onWritten}
      />,
    );

    // Click Remove
    await user.click(screen.getByTestId("dependency-remove"));

    // Confirm panel visible
    const confirm = screen.getByTestId("dependency-remove-confirm");
    expect(confirm.textContent).toContain("Task B");
    expect(confirm.textContent).toContain("Task A");

    // Confirm button fires delete — it's the first button inside the confirm span
    const buttons = confirm.querySelectorAll("button");
    const confirmBtn = buttons[0]! as HTMLButtonElement;
    await user.click(confirmBtn);
    expect(mockRemove).toHaveBeenCalledWith("task", "t1", "t2");
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  test("Cancel restores the button and issues no request", async () => {
    const user = userEvent.setup();
    const onWritten = vi.fn();

    render(
      <DependencyEditor
        kind="task"
        sourceId="t1"
        sourceLabel="Task A"
        dependencies={["t2"]}
        candidates={CANDIDATES}
        labelOf={(id) => CANDIDATES.find((c) => c.id === id)?.label ?? id}
        onWritten={onWritten}
      />,
    );

    await user.click(screen.getByTestId("dependency-remove"));
    expect(screen.getByTestId("dependency-remove-confirm")).toBeDefined();

    await user.click(screen.getByTestId("dependency-remove-cancel"));
    expect(screen.queryByTestId("dependency-remove-confirm")).toBeNull();
    expect(screen.getByTestId("dependency-remove")).toBeDefined();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(onWritten).not.toHaveBeenCalled();
  });

  test("dependency-precondition-note is present", () => {
    render(
      <DependencyEditor
        kind="task"
        sourceId="t1"
        sourceLabel="Task A"
        dependencies={[]}
        candidates={[]}
        labelOf={(id) => id}
        onWritten={vi.fn()}
      />,
    );

    const note = screen.getByTestId("dependency-precondition-note");
    expect(note.textContent).toContain("not version-checked");
  });

  test("no danger-confirm-dialog and no sonner toast is rendered", async () => {
    const user = userEvent.setup();
    render(
      <DependencyEditor
        kind="task"
        sourceId="t1"
        sourceLabel="Task A"
        dependencies={[]}
        candidates={CANDIDATES}
        labelOf={(id) => id}
        onWritten={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId("dependency-add"));
    expect(screen.queryByTestId("danger-confirm-dialog")).toBeNull();
    // Sonner toast element
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });
});
