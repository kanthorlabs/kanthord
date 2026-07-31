// S5 — AsyncBoundary: presentational component over the seven-state union.
// Each state renders exactly one element with its own test id.
// Uses ROLE_CLASS for role-based styling; resolved renders children only.
import type { ReactElement, ReactNode } from "react";

import type { AsyncState } from "@/lib/async-state";
import type { Role } from "@/lib/status-role";
import { ROLE_CLASS } from "@/lib/status-role";
import { cn } from "@/lib/utils";

// State → role mapping (resolved has no role).
const STATE_ROLE: Record<Exclude<AsyncState, "resolved">, Role> = {
  loading: "neutral",
  empty: "neutral",
  error: "danger",
  missing: "attention",
  expired: "attention",
  truncated: "attention",
};

export interface AsyncBoundaryProps {
  readonly state: AsyncState;
  readonly what?: string;
  readonly message?: string;
  readonly children?: ReactNode;
}

export function AsyncBoundary({
  state,
  what,
  message,
  children,
}: AsyncBoundaryProps): ReactElement {
  // Resolved: render children, no data-role.
  if (state === "resolved") {
    return <div data-testid="async-resolved">{children ?? what ?? "Done"}</div>;
  }

  const role = STATE_ROLE[state];
  const roleClass = ROLE_CLASS[role];

  switch (state) {
    case "loading":
      return (
        <div
          data-testid="async-loading"
          data-role={role}
          className={cn(roleClass)}
        >
          Loading {what}…
        </div>
      );
    case "empty":
      return (
        <div
          data-testid="async-empty"
          data-role={role}
          className={cn(roleClass)}
        >
          No {what} results
        </div>
      );
    case "error":
      return (
        <div
          data-testid="async-error"
          data-role={role}
          role="alert"
          className={cn(roleClass)}
        >
          Error loading {what}
          {message ? `: ${message}` : ""}
        </div>
      );
    case "missing":
      return (
        <div
          data-testid="async-missing"
          data-role={role}
          className={cn(roleClass)}
        >
          {what} not found
        </div>
      );
    case "expired":
      return (
        <div
          data-testid="async-expired"
          data-role={role}
          className={cn(roleClass)}
        >
          {what} data expired
        </div>
      );
    case "truncated":
      return (
        <div
          data-testid="async-truncated"
          data-role={role}
          className={cn(roleClass)}
        >
          {what} data truncated
        </div>
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
