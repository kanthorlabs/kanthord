import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActionDto } from "@/lib/dto";

import { ActionInventory } from "./action-inventory";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderInventory(action: ActionDto | null) {
  return render(<ActionInventory action={action} />);
}

describe("ActionInventory", () => {
  test("action: null → zero disabled-action, zero command-handoff, zero no-command, zero buttons", () => {
    renderInventory(null);
    expect(screen.queryAllByTestId("disabled-action")).toHaveLength(0);
    expect(screen.queryAllByTestId("command-handoff")).toHaveLength(0);
    expect(screen.queryAllByTestId("no-command")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("remove-dependency (026.4 S7 — UI-driven kind) → row skipped, no disabled-action renders", () => {
    renderInventory({
      kind: "remove-dependency",
      target: { type: "task", id: "t1" },
      targetDependencyId: "tB",
      requiresInput: [],
      command: "remove dependency --task t1 --dependency tB",
    });
    // remove-dependency is in ACTION_KINDS_DRIVEN_BY_UI — the row is skipped
    // because the UI renders its own DependencyEditor for this action.
    expect(screen.queryByTestId("disabled-action")).not.toBeInTheDocument();
    expect(screen.queryByTestId("command-handoff")).not.toBeInTheDocument();
  });

  test("retry with command → disabled-action, button reads Retry, disabled, reason, command-handoff with exact command, zero no-command", () => {
    renderInventory({
      kind: "retry",
      target: { type: "task", id: "t1" },
      requiresInput: [],
      command: "retry task --id t1",
    });
    const section = screen.getByTestId("disabled-action");
    expect(section).toHaveAttribute("data-action-kind", "retry");
    expect(section).toHaveAttribute("data-target-type", "task");
    expect(section).toHaveAttribute("data-target-id", "t1");

    const btn = screen.getByTestId("disabled-action-button");
    expect(btn).toHaveTextContent("Retry");
    expect(btn).toBeDisabled();

    expect(screen.getByTestId("disabled-action-reason")).toHaveTextContent(
      "The daemon has no HTTP action for this yet — run it from the CLI.",
    );

    const handoff = screen.getByTestId("command-handoff");
    expect(
      handoff.querySelector('[data-testid="command-handoff-command"]'),
    ).toHaveTextContent("retry task --id t1");
    expect(screen.queryAllByTestId("no-command")).toHaveLength(0);
  });

  test("reject without command → disabled-action, requires text, no-command, zero command-handoff, no fabricated command text", () => {
    const { container } = renderInventory({
      kind: "reject",
      target: { type: "task", id: "t1" },
      requiresInput: ["resolution", "reason"],
    });
    const section = screen.getByTestId("disabled-action");
    expect(section).toHaveAttribute("data-action-kind", "reject");

    const requires = screen.getByTestId("disabled-action-requires");
    expect(requires).toHaveTextContent("resolution");
    expect(requires).toHaveTextContent("reason");

    expect(screen.getByTestId("no-command")).toBeInTheDocument();
    expect(screen.queryAllByTestId("command-handoff")).toHaveLength(0);

    // No fabricated command text anywhere
    expect(container.textContent).not.toContain("kanthord");
    expect(container.textContent).not.toContain("--json");
  });

  test("approve (objective action, never carries command) → no-command renders", () => {
    renderInventory({
      kind: "approve",
      target: { type: "objective", id: "o1" },
      requiresInput: ["expectedCommit"],
    });
    expect(screen.getByTestId("no-command")).toBeInTheDocument();
  });

  test("publish with command → button reads Publish, handoff has exact command", () => {
    renderInventory({
      kind: "publish",
      target: { type: "repository", id: "r1" },
      requiresInput: [],
      command: "publish repository --repository r1 --branch main",
    });
    expect(screen.getByTestId("disabled-action-button")).toHaveTextContent(
      "Publish",
    );
    expect(
      screen
        .getByTestId("command-handoff")
        .querySelector('[data-testid="command-handoff-command"]'),
    ).toHaveTextContent("publish repository --repository r1 --branch main");
  });

  test("resume-initiative with command → button reads Resume initiative", () => {
    renderInventory({
      kind: "resume-initiative",
      target: { type: "initiative", id: "i1" },
      requiresInput: [],
      command: "resume initiative --id i1",
    });
    expect(screen.getByTestId("disabled-action-button")).toHaveTextContent(
      "Resume initiative",
    );
  });

  test("unknown kind (teleport) → disabled-action with data-action-kind teleport, button reads teleport", () => {
    renderInventory({
      kind: "teleport",
      target: { type: "task", id: "t1" },
      requiresInput: [],
    });
    expect(screen.getByTestId("disabled-action")).toHaveAttribute(
      "data-action-kind",
      "teleport",
    );
    expect(screen.getByTestId("disabled-action-button")).toHaveTextContent(
      "teleport",
    );
  });

  test("requiresInput: [] → disabled-action-requires is absent", () => {
    renderInventory({
      kind: "retry",
      target: { type: "task", id: "t1" },
      requiresInput: [],
    });
    expect(
      screen.queryByTestId("disabled-action-requires"),
    ).not.toBeInTheDocument();
  });

  test("clicking disabled-action-button issues no fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    renderInventory({
      kind: "retry",
      target: { type: "task", id: "t1" },
      requiresInput: [],
      command: "retry task --id t1",
    });
    await userEvent.click(screen.getByTestId("disabled-action-button"));
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });
});
