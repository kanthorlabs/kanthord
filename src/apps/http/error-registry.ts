// src/apps/http/error-registry.ts — maps a thrown error to a stable transport code (Story 02).
import {
  UnknownReferenceError,
  DuplicateNameError,
  ObjectiveNotInConflictError,
  WrongTypeReferenceError,
  CycleError,
  DuplicateTaskError,
  UnknownDependencyError,
  DependenciesLockedError,
  SequencingScopeError,
  SequencingLockedError,
  UnknownAgentError,
  InvalidTaskFieldError,
  EmbeddedCredentialError,
  StaleCandidateError,
  ObjectiveNotAwaitingConfirmationError,
  TaskNotAwaitingConfirmationError,
  ImpactChangedError,
  ProposalWorkspaceMissingError,
} from "../../app/errors.ts";
import { NoConflictCandidateError } from "../../app/task/get-conflict.ts";
import { RejectionConflictError } from "../../app/task/reject-task.ts";
import { TaskNotRetryableError } from "../../app/task/retry-task.ts";
import { ObjectiveNotRetryableError } from "../../app/objective/retry-objective.ts";
import {
  TaskNotAbandonableError,
  NoRunningJobError,
  AmbiguousRunningJobError,
} from "../../app/task/abandon-task.ts";
import { ProposalMissingError } from "../../app/task/approve-task.ts";
import {
  ImmutableFieldError,
  CacheConflictError,
} from "../../app/resource/update-resource.ts";
import { ImportValidationError } from "../../app/resource/import-resources.ts";
import { GraphPackageDocumentError } from "../../app/graph/decode-graph-package.ts";
import {
  CreateModeIdError,
  UnboundAliasError,
  ExecutorBindingSetError,
  UnknownNodeError,
  CrossInitiativeError,
  StaleManifestError,
  UncreatableObjectiveError,
} from "../../app/graph/import-errors.ts";
import {
  CursorNotUlidError,
  CursorAheadOfFeedError,
} from "../../app/project/ack-project.ts";
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
  { type: WrongTypeReferenceError, code: "wrong_type_reference", status: 400 },
  { type: CycleError, code: "cycle_detected", status: 409 },
  { type: DuplicateTaskError, code: "duplicate_task", status: 409 },
  { type: UnknownDependencyError, code: "unknown_dependency", status: 400 },
  { type: DependenciesLockedError, code: "dependencies_locked", status: 409 },
  { type: SequencingScopeError, code: "sequencing_scope", status: 400 },
  { type: SequencingLockedError, code: "sequencing_locked", status: 409 },
  { type: UnknownAgentError, code: "unknown_agent", status: 400 },
  { type: InvalidTaskFieldError, code: "invalid_task_field", status: 400 },
  { type: EmbeddedCredentialError, code: "embedded_credential", status: 400 },
  { type: ImmutableFieldError, code: "immutable_field", status: 409 },
  { type: CacheConflictError, code: "cache_conflict", status: 409 },
  { type: ImportValidationError, code: "import_validation", status: 400 },
  { type: CreateModeIdError, code: "create_mode_id", status: 400 },
  { type: UnboundAliasError, code: "unbound_alias", status: 400 },
  {
    type: ExecutorBindingSetError,
    code: "executor_binding_set",
    status: 400,
  },
  { type: UnknownNodeError, code: "unknown_node", status: 404 },
  { type: CrossInitiativeError, code: "cross_initiative", status: 409 },
  { type: StaleManifestError, code: "stale_manifest", status: 409 },
  {
    type: UncreatableObjectiveError,
    code: "uncreatable_objective",
    status: 409,
  },
  { type: GraphPackageDocumentError, code: "invalid_package", status: 400 },
  {
    type: CursorNotUlidError,
    code: "cursor_not_ulid",
    status: 400,
    message: "the cursor is not a ULID",
  },
  {
    type: CursorAheadOfFeedError,
    code: "cursor_ahead_of_feed",
    status: 409,
    message: "the cursor is ahead of the project event feed",
  },
  { type: StaleCandidateError, code: "stale_candidate", status: 409 },
  {
    type: ObjectiveNotAwaitingConfirmationError,
    code: "objective_not_awaiting_confirmation",
    status: 409,
  },
  {
    type: TaskNotAwaitingConfirmationError,
    code: "task_not_awaiting_confirmation",
    status: 409,
  },
  { type: ImpactChangedError, code: "impact_changed", status: 409 },
  { type: RejectionConflictError, code: "rejection_conflict", status: 409 },
  { type: TaskNotRetryableError, code: "task_not_retryable", status: 409 },
  {
    type: ObjectiveNotRetryableError,
    code: "objective_not_retryable",
    status: 409,
  },
  {
    type: TaskNotAbandonableError,
    code: "task_not_abandonable",
    status: 409,
  },
  { type: NoRunningJobError, code: "no_running_job", status: 409 },
  {
    type: AmbiguousRunningJobError,
    code: "ambiguous_running_job",
    status: 409,
  },
  { type: ProposalMissingError, code: "proposal_missing", status: 409 },
  {
    type: ProposalWorkspaceMissingError,
    code: "proposal_workspace_missing",
    status: 409,
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
  precondition_required: {
    code: "precondition_required",
    status: 428,
    message: "If-Match is required",
  },
  precondition_failed: {
    code: "precondition_failed",
    status: 412,
    message: "precondition failed",
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
