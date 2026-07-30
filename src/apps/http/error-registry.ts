// src/apps/http/error-registry.ts — maps a thrown error to a stable transport code (Story 02).
import {
  UnknownReferenceError,
  DuplicateNameError,
  ObjectiveNotInConflictError,
} from "../../app/errors.ts";
import { NoConflictCandidateError } from "../../app/task/get-conflict.ts";
import { HttpFailure } from "./errors.ts";

export interface ErrorMapping {
  code: string;
  status: number;
  message: string;
}

/** Domain/app error classes reachable from an HTTP route, mapped explicitly. */
export const DOMAIN_ERROR_MAPPINGS: ReadonlyArray<{
  readonly type: new (...args: never[]) => Error;
  readonly code: string;
  readonly status: number;
  readonly message?: string;
}> = [
  { type: UnknownReferenceError, code: "unknown_reference", status: 404 },
  { type: DuplicateNameError, code: "duplicate_name", status: 409 },
  {
    type: NoConflictCandidateError,
    code: "no_conflict_candidate",
    status: 409,
    message: "the task has no conflicted landing candidate",
  },
  {
    type: ObjectiveNotInConflictError,
    code: "objective_not_in_conflict",
    status: 409,
    message: "the objective is not in conflict",
  },
];

export const TRANSPORT_ERRORS = {
  unauthenticated: {
    code: "unauthenticated",
    status: 401,
    message: "authentication required",
  },
  unknown_route: {
    code: "unknown_route",
    status: 404,
    message: "unknown route",
  },
  method_not_allowed: {
    code: "method_not_allowed",
    status: 405,
    message: "method not allowed",
  },
  host_not_allowed: {
    code: "host_not_allowed",
    status: 403,
    message: "host not allowed",
  },
  origin_not_allowed: {
    code: "origin_not_allowed",
    status: 403,
    message: "origin not allowed",
  },
  unsupported_media_type: {
    code: "unsupported_media_type",
    status: 415,
    message: "unsupported media type",
  },
  malformed_body: {
    code: "malformed_body",
    status: 400,
    message: "malformed request body",
  },
  body_too_large: {
    code: "body_too_large",
    status: 413,
    message: "request body too large",
  },
  invalid_input: {
    code: "invalid_input",
    status: 400,
    message: "invalid input",
  },
  internal: {
    code: "internal",
    status: 500,
    message: "internal error",
  },
} as const;

const HTTP_ERRORS_STATUS_MAP: Readonly<Record<number, ErrorMapping>> = {
  400: TRANSPORT_ERRORS.malformed_body,
  413: TRANSPORT_ERRORS.body_too_large,
  415: TRANSPORT_ERRORS.unsupported_media_type,
};

function httpErrorsStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  return undefined;
}

export function mapError(err: unknown): ErrorMapping {
  if (err instanceof HttpFailure) {
    return { code: err.code, status: err.status, message: err.message };
  }

  for (const mapping of DOMAIN_ERROR_MAPPINGS) {
    if (err instanceof mapping.type) {
      return {
        code: mapping.code,
        status: mapping.status,
        message: mapping.message ?? (err as Error).message,
      };
    }
  }

  const status = httpErrorsStatus(err);
  if (status !== undefined && status in HTTP_ERRORS_STATUS_MAP) {
    const mapped = HTTP_ERRORS_STATUS_MAP[status];
    if (mapped !== undefined) return mapped;
  }

  return TRANSPORT_ERRORS.internal;
}
