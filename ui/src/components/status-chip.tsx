import type { ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CirclePause,
  CircleSlash,
  CircleX,
  LoaderCircle,
  Play,
  TriangleAlert,
} from "lucide-react";

import type {
  DependencyState,
  ExecutionState,
  InitiativeStatus,
  ProbeStatus,
  ReadinessCheckStatus,
  Role,
  TaskStatus,
} from "@/lib/status-role";
import {
  DEPENDENCY_STATE_ROLE,
  EXECUTION_STATE_ROLE,
  INITIATIVE_STATUS_ROLE,
  PROBE_STATUS_ROLE,
  READINESS_CHECK_STATUS_ROLE,
  ROLE_CLASS,
  TASK_STATUS_ROLE,
  roleForBlockedForever,
} from "@/lib/status-role";
import { cn } from "@/lib/utils";

// --- label maps ---

const TASK_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  awaiting_confirmation: "Awaiting confirmation",
  discarded: "Discarded",
};

const INITIATIVE_LABEL: Record<InitiativeStatus, string> = {
  building: "Building",
  landed: "Landed",
  discarded: "Discarded",
};

const DEPENDENCY_LABEL: Record<DependencyState, string> = {
  ready: "Ready",
  blocked: "Blocked",
};

const EXECUTION_LABEL: Record<ExecutionState, string> = {
  runnable: "Runnable",
  paused: "Paused",
};

const BLOCKED_FOREVER_LABEL: Record<"true" | "false", string> = {
  true: "Blocked forever",
  false: "Not blocked forever",
};

const READINESS_LABEL: Record<ReadinessCheckStatus, string> = {
  ok: "OK",
  unverified: "Unverified",
  missing: "Missing",
  paused: "Paused",
  blocked: "Blocked",
  failed: "Failed",
  unsupported: "Unsupported",
  running: "Running",
  stopped: "Stopped",
  multiple: "Multiple",
};

const PROBE_LABEL: Record<ProbeStatus, string> = {
  ok: "Probe OK",
  failed: "Probe failed",
};

// --- icon maps ---

const TASK_ICON: Record<TaskStatus, LucideIcon> = {
  pending: Circle,
  running: LoaderCircle,
  completed: CircleCheck,
  failed: CircleX,
  awaiting_confirmation: CircleAlert,
  discarded: Ban,
};

const INITIATIVE_ICON: Record<InitiativeStatus, LucideIcon> = {
  building: CircleDot,
  landed: CircleCheck,
  discarded: Ban,
};

const DEPENDENCY_ICON: Record<DependencyState, LucideIcon> = {
  ready: Play,
  blocked: CircleSlash,
};

const EXECUTION_ICON: Record<ExecutionState, LucideIcon> = {
  runnable: Play,
  paused: CirclePause,
};

const BLOCKED_FOREVER_ICON: Record<"true" | "false", LucideIcon> = {
  true: Ban,
  false: Circle,
};

const READINESS_ICON: Record<ReadinessCheckStatus, LucideIcon> = {
  ok: CircleCheck,
  unverified: CircleHelp,
  missing: Circle,
  paused: CirclePause,
  blocked: CircleSlash,
  failed: CircleX,
  unsupported: Ban,
  running: LoaderCircle,
  stopped: CirclePause,
  multiple: TriangleAlert,
};

const PROBE_ICON: Record<ProbeStatus, LucideIcon> = {
  ok: CircleCheck,
  failed: CircleX,
};

// --- props ---

export type StatusChipProps = { readonly className?: string } & (
  | { readonly axis: "task"; readonly value: TaskStatus }
  | { readonly axis: "initiative"; readonly value: InitiativeStatus }
  | { readonly axis: "dependency"; readonly value: DependencyState }
  | { readonly axis: "execution"; readonly value: ExecutionState }
  | { readonly axis: "blockedForever"; readonly value: boolean }
  | { readonly axis: "readiness"; readonly value: ReadinessCheckStatus }
  | { readonly axis: "probe"; readonly value: ProbeStatus }
);

// --- component ---

export function StatusChip(props: StatusChipProps): ReactElement {
  const { axis, className } = props;

  let role: Role;
  let label: string;
  let Icon: LucideIcon;

  switch (axis) {
    case "task": {
      const { value } = props;
      role = TASK_STATUS_ROLE[value];
      label = TASK_LABEL[value];
      Icon = TASK_ICON[value];
      break;
    }
    case "initiative": {
      const { value } = props;
      role = INITIATIVE_STATUS_ROLE[value];
      label = INITIATIVE_LABEL[value];
      Icon = INITIATIVE_ICON[value];
      break;
    }
    case "dependency": {
      const { value } = props;
      role = DEPENDENCY_STATE_ROLE[value];
      label = DEPENDENCY_LABEL[value];
      Icon = DEPENDENCY_ICON[value];
      break;
    }
    case "execution": {
      const { value } = props;
      role = EXECUTION_STATE_ROLE[value];
      label = EXECUTION_LABEL[value];
      Icon = EXECUTION_ICON[value];
      break;
    }
    case "blockedForever": {
      const { value } = props;
      const key = String(value) as "true" | "false";
      role = roleForBlockedForever(value);
      label = BLOCKED_FOREVER_LABEL[key];
      Icon = BLOCKED_FOREVER_ICON[key];
      break;
    }
    case "readiness": {
      const { value } = props;
      role = READINESS_CHECK_STATUS_ROLE[value];
      label = READINESS_LABEL[value];
      Icon = READINESS_ICON[value];
      break;
    }
    case "probe": {
      const { value } = props;
      role = PROBE_STATUS_ROLE[value];
      label = PROBE_LABEL[value];
      Icon = PROBE_ICON[value];
      break;
    }
    default: {
      const _exhaustive: never = axis;
      throw new Error(`Unknown axis: ${_exhaustive}`);
    }
  }

  return (
    <span
      data-testid="status-chip"
      data-axis={axis}
      data-value={String(props.value)}
      data-role={role}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        ROLE_CLASS[role],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        data-testid="status-chip-icon"
        className="size-3.5"
      />
      {label}
    </span>
  );
}
