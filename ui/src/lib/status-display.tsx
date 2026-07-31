// Story 01 — EntityStatus: one-place status rendering (index.md F7).
import type { ReactElement } from "react";

import type { TaskStatus, InitiativeStatus } from "@/lib/status-role";
import { TASK_STATUS_ROLE, INITIATIVE_STATUS_ROLE } from "@/lib/status-role";
import { StatusChip } from "@/components/status-chip";

export type StatusAxis = "task" | "initiative";

export interface EntityStatusProps {
  readonly axis: StatusAxis;
  readonly value: string;
}

/**
 * `StatusChip` when the value is in that axis's role map, otherwise the raw
 * string — a `dependencyStatus` of `"unknown"` (index.md F7) must render, not
 * crash.
 */
export function EntityStatus({ axis, value }: EntityStatusProps): ReactElement {
  if (axis === "task" && value in TASK_STATUS_ROLE) {
    return <StatusChip axis="task" value={value as TaskStatus} />;
  }
  if (axis === "initiative" && value in INITIATIVE_STATUS_ROLE) {
    return <StatusChip axis="initiative" value={value as InitiativeStatus} />;
  }
  return <span data-testid="status-raw">{value}</span>;
}
