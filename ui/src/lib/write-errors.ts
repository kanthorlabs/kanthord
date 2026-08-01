// ui/src/lib/write-errors.ts — dependency error code → message table (EPIC 026, decision 10).
// Each server error code maps to its own message; no code falls through to a generic string.

import { ApiError } from "./api-client";

export const DEPENDENCY_ERROR_CODES = [
  "cycle_detected",
  "unknown_reference",
  "wrong_type_reference",
  "unknown_dependency",
  "sequencing_scope",
  "sequencing_locked",
  "dependencies_locked",
] as const;

export type DependencyErrorCode = (typeof DEPENDENCY_ERROR_CODES)[number];

export const DEPENDENCY_ERROR_MESSAGE: Readonly<
  Record<DependencyErrorCode, string>
> = {
  cycle_detected: "That edge would close a cycle.",
  unknown_reference: "That item no longer exists.",
  wrong_type_reference: "That id is a different kind of item.",
  unknown_dependency: "That task is not in this initiative.",
  sequencing_scope: "Both items must be in the same parent.",
  sequencing_locked: "Work already started, so the order is locked.",
  dependencies_locked:
    "This task already started, so its dependencies are locked.",
};

/**
 * Resolve the display message for a dependency ApiError.
 *
 * 1. Known dependency code → the pinned client-authored message.
 * 2. Non-blank server message → the server's own text.
 * 3. Transport-defect fallback → `(status)` text.
 */
export function dependencyErrorMessage(error: ApiError): string {
  if (Object.hasOwn(DEPENDENCY_ERROR_MESSAGE, error.code)) {
    return DEPENDENCY_ERROR_MESSAGE[error.code as DependencyErrorCode];
  }
  if (error.message.trim() !== "") {
    return error.message;
  }
  return `The server refused this edge (${error.status}).`;
}
