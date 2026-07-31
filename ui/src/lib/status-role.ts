export const ROLES = [
  "neutral",
  "active",
  "attention",
  "blocked",
  "danger",
  "success",
] as const;
export type Role = (typeof ROLES)[number];

/** `--role-neutral` … — the custom property S1 declares in ui/src/index.css. */
export function roleVar(role: Role): string {
  return `--role-${role}`;
}

/** Complete literal Tailwind classes. Never interpolate a role into a class name. */
export const ROLE_CLASS = {
  neutral: "border-role-neutral/40 bg-role-neutral/10 text-role-neutral",
  active: "border-role-active/40 bg-role-active/10 text-role-active",
  attention:
    "border-role-attention/40 bg-role-attention/10 text-role-attention",
  blocked: "border-role-blocked/40 bg-role-blocked/10 text-role-blocked",
  danger: "border-role-danger/40 bg-role-danger/10 text-role-danger",
  success: "border-role-success/40 bg-role-success/10 text-role-success",
} satisfies Record<Role, string>;

// --- seven axes ---

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_confirmation"
  | "discarded";
export const TASK_STATUS_ROLE = {
  pending: "neutral",
  running: "active",
  completed: "success",
  failed: "danger",
  awaiting_confirmation: "attention",
  discarded: "neutral",
} satisfies Record<TaskStatus, Role>;

export type InitiativeStatus = "building" | "landed" | "discarded";
export const INITIATIVE_STATUS_ROLE = {
  building: "active",
  landed: "success",
  discarded: "neutral",
} satisfies Record<InitiativeStatus, Role>;

export type DependencyState = "ready" | "blocked";
export const DEPENDENCY_STATE_ROLE = {
  ready: "success",
  blocked: "blocked",
} satisfies Record<DependencyState, Role>;

export type ExecutionState = "runnable" | "paused";
export const EXECUTION_STATE_ROLE = {
  runnable: "active",
  paused: "attention",
} satisfies Record<ExecutionState, Role>;

/** `blockedForever` is a boolean on the wire (src/apps/http/views/task.ts:68). */
export const BLOCKED_FOREVER_ROLE = {
  true: "danger",
  false: "neutral",
} satisfies Record<"true" | "false", Role>;
export function roleForBlockedForever(value: boolean): Role {
  return value ? "danger" : "neutral";
}

/** The readiness axis is ConfigCheckStatus ∪ DaemonStatus — ten members. */
export type ReadinessCheckStatus =
  | "ok"
  | "unverified"
  | "missing"
  | "paused"
  | "blocked"
  | "failed"
  | "unsupported"
  | "running"
  | "stopped"
  | "multiple";
export const READINESS_CHECK_STATUS_ROLE = {
  ok: "success",
  unverified: "attention",
  missing: "attention",
  paused: "attention",
  blocked: "blocked",
  failed: "danger",
  unsupported: "neutral",
  running: "success",
  stopped: "attention",
  multiple: "danger",
} satisfies Record<ReadinessCheckStatus, Role>;

export type ProbeStatus = "ok" | "failed";
export const PROBE_STATUS_ROLE = {
  ok: "success",
  failed: "danger",
} satisfies Record<ProbeStatus, Role>;

// --- publication (label, no role) ---

export type PublicationState = "unpublished" | "published" | "diverged";
export interface Publication {
  readonly state: PublicationState;
  readonly remoteOID: string | null;
}
/**
 * published + remoteOID → `published@<oid>`; published with a null oid →
 * `published`; any other state → the state itself.
 */
export function publicationLabel(publication: Publication): string {
  if (publication.state === "published") {
    return publication.remoteOID
      ? `published@${publication.remoteOID}`
      : "published";
  }
  return publication.state;
}
