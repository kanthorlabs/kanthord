// Story S2 — StatusChip over the role map
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { StatusChip, type StatusChipProps } from "./status-chip";
import {
  TASK_STATUS_ROLE,
  INITIATIVE_STATUS_ROLE,
  DEPENDENCY_STATE_ROLE,
  EXECUTION_STATE_ROLE,
  READINESS_CHECK_STATUS_ROLE,
  PROBE_STATUS_ROLE,
  roleForBlockedForever,
} from "@/lib/status-role";

afterEach(() => {
  cleanup();
});

/** All 27 rows from the story table. */
const ALL_ROWS: Array<{
  axis: StatusChipProps["axis"];
  value: string | boolean;
  expectedRole: string;
  expectedLabel: string;
  expectedDataValue: string;
}> = [
  // task
  {
    axis: "task",
    value: "pending",
    expectedRole: TASK_STATUS_ROLE.pending,
    expectedLabel: "Pending",
    expectedDataValue: "pending",
  },
  {
    axis: "task",
    value: "running",
    expectedRole: TASK_STATUS_ROLE.running,
    expectedLabel: "Running",
    expectedDataValue: "running",
  },
  {
    axis: "task",
    value: "completed",
    expectedRole: TASK_STATUS_ROLE.completed,
    expectedLabel: "Completed",
    expectedDataValue: "completed",
  },
  {
    axis: "task",
    value: "failed",
    expectedRole: TASK_STATUS_ROLE.failed,
    expectedLabel: "Failed",
    expectedDataValue: "failed",
  },
  {
    axis: "task",
    value: "awaiting_confirmation",
    expectedRole: TASK_STATUS_ROLE.awaiting_confirmation,
    expectedLabel: "Awaiting confirmation",
    expectedDataValue: "awaiting_confirmation",
  },
  {
    axis: "task",
    value: "discarded",
    expectedRole: TASK_STATUS_ROLE.discarded,
    expectedLabel: "Discarded",
    expectedDataValue: "discarded",
  },
  // initiative
  {
    axis: "initiative",
    value: "building",
    expectedRole: INITIATIVE_STATUS_ROLE.building,
    expectedLabel: "Building",
    expectedDataValue: "building",
  },
  {
    axis: "initiative",
    value: "landed",
    expectedRole: INITIATIVE_STATUS_ROLE.landed,
    expectedLabel: "Landed",
    expectedDataValue: "landed",
  },
  {
    axis: "initiative",
    value: "discarded",
    expectedRole: INITIATIVE_STATUS_ROLE.discarded,
    expectedLabel: "Discarded",
    expectedDataValue: "discarded",
  },
  // dependency
  {
    axis: "dependency",
    value: "ready",
    expectedRole: DEPENDENCY_STATE_ROLE.ready,
    expectedLabel: "Ready",
    expectedDataValue: "ready",
  },
  {
    axis: "dependency",
    value: "blocked",
    expectedRole: DEPENDENCY_STATE_ROLE.blocked,
    expectedLabel: "Blocked",
    expectedDataValue: "blocked",
  },
  // execution
  {
    axis: "execution",
    value: "runnable",
    expectedRole: EXECUTION_STATE_ROLE.runnable,
    expectedLabel: "Runnable",
    expectedDataValue: "runnable",
  },
  {
    axis: "execution",
    value: "paused",
    expectedRole: EXECUTION_STATE_ROLE.paused,
    expectedLabel: "Paused",
    expectedDataValue: "paused",
  },
  // blockedForever
  {
    axis: "blockedForever",
    value: true,
    expectedRole: roleForBlockedForever(true),
    expectedLabel: "Blocked forever",
    expectedDataValue: "true",
  },
  {
    axis: "blockedForever",
    value: false,
    expectedRole: roleForBlockedForever(false),
    expectedLabel: "Not blocked forever",
    expectedDataValue: "false",
  },
  // readiness
  {
    axis: "readiness",
    value: "ok",
    expectedRole: READINESS_CHECK_STATUS_ROLE.ok,
    expectedLabel: "OK",
    expectedDataValue: "ok",
  },
  {
    axis: "readiness",
    value: "unverified",
    expectedRole: READINESS_CHECK_STATUS_ROLE.unverified,
    expectedLabel: "Unverified",
    expectedDataValue: "unverified",
  },
  {
    axis: "readiness",
    value: "missing",
    expectedRole: READINESS_CHECK_STATUS_ROLE.missing,
    expectedLabel: "Missing",
    expectedDataValue: "missing",
  },
  {
    axis: "readiness",
    value: "paused",
    expectedRole: READINESS_CHECK_STATUS_ROLE.paused,
    expectedLabel: "Paused",
    expectedDataValue: "paused",
  },
  {
    axis: "readiness",
    value: "blocked",
    expectedRole: READINESS_CHECK_STATUS_ROLE.blocked,
    expectedLabel: "Blocked",
    expectedDataValue: "blocked",
  },
  {
    axis: "readiness",
    value: "failed",
    expectedRole: READINESS_CHECK_STATUS_ROLE.failed,
    expectedLabel: "Failed",
    expectedDataValue: "failed",
  },
  {
    axis: "readiness",
    value: "unsupported",
    expectedRole: READINESS_CHECK_STATUS_ROLE.unsupported,
    expectedLabel: "Unsupported",
    expectedDataValue: "unsupported",
  },
  {
    axis: "readiness",
    value: "running",
    expectedRole: READINESS_CHECK_STATUS_ROLE.running,
    expectedLabel: "Running",
    expectedDataValue: "running",
  },
  {
    axis: "readiness",
    value: "stopped",
    expectedRole: READINESS_CHECK_STATUS_ROLE.stopped,
    expectedLabel: "Stopped",
    expectedDataValue: "stopped",
  },
  {
    axis: "readiness",
    value: "multiple",
    expectedRole: READINESS_CHECK_STATUS_ROLE.multiple,
    expectedLabel: "Multiple",
    expectedDataValue: "multiple",
  },
  // probe
  {
    axis: "probe",
    value: "ok",
    expectedRole: PROBE_STATUS_ROLE.ok,
    expectedLabel: "Probe OK",
    expectedDataValue: "ok",
  },
  {
    axis: "probe",
    value: "failed",
    expectedRole: PROBE_STATUS_ROLE.failed,
    expectedLabel: "Probe failed",
    expectedDataValue: "failed",
  },
];

describe("StatusChip", () => {
  test("renders correct data-role, className, label and icon for every axis/value row", () => {
    for (const row of ALL_ROWS) {
      const { unmount } = render(
        <StatusChip axis={row.axis as "task"} value={row.value as never} />,
      );

      const chip = screen.getByTestId("status-chip");

      // data-role equals the role S1 maps for it
      expect(chip.getAttribute("data-role")).toBe(row.expectedRole);

      // className contains text-role-<role>
      expect(chip.className).toContain(`text-role-${row.expectedRole}`);

      // text content equals the label from the table
      expect(chip.textContent).toBe(row.expectedLabel);

      // icon is in the document
      expect(screen.getByTestId("status-chip-icon")).toBeTruthy();

      unmount();
    }
  });

  test("data-axis and data-value carry the input verbatim", () => {
    render(<StatusChip axis="task" value="pending" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.getAttribute("data-axis")).toBe("task");
    expect(chip.getAttribute("data-value")).toBe("pending");
    cleanup();

    // boolean value renders as string
    render(<StatusChip axis="blockedForever" value={false} />);
    const chipBool = screen.getByTestId("status-chip");
    expect(chipBool.getAttribute("data-axis")).toBe("blockedForever");
    expect(chipBool.getAttribute("data-value")).toBe("false");
  });

  test("two values sharing one role render same data-role but different labels", () => {
    // task/pending and task/discarded both map to "neutral"
    render(<StatusChip axis="task" value="pending" />);
    const pending = screen.getByTestId("status-chip");
    const pendingRole = pending.getAttribute("data-role");
    const pendingLabel = pending.textContent;
    cleanup();

    render(<StatusChip axis="task" value="discarded" />);
    const discarded = screen.getByTestId("status-chip");
    const discardedRole = discarded.getAttribute("data-role");
    const discardedLabel = discarded.textContent;

    expect(pendingRole).toBe("neutral");
    expect(discardedRole).toBe("neutral");
    expect(pendingRole).toBe(discardedRole);
    expect(pendingLabel).not.toBe(discardedLabel);
  });

  test("a className prop is merged, not dropped", () => {
    render(<StatusChip axis="task" value="pending" className="extra-class" />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.className).toContain("extra-class");
    expect(chip.className).toContain("text-role-neutral");
  });
});
