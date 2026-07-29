import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  AmbiguousNameError,
  CycleError,
  DependenciesLockedError,
  UnknownAgentError,
  TaskNotAwaitingConfirmationError,
  ProposalWorkspaceMissingError,
  EmbeddedCredentialError,
  UnknownModelError,
  ObjectiveNotAwaitingConfirmationError,
  SequencingLockedError,
  SequencingScopeError,
  StaleCandidateError,
  ImpactChangedError,
  ObjectiveNotInConflictError,
} from "../../app/errors.ts";
import { TaskNotRetryableError } from "../../app/task/retry-task.ts";
import { ObjectiveNotRetryableError } from "../../app/objective/retry-objective.ts";
import { ProposalMissingError } from "../../app/task/approve-task.ts";
import { RejectionConflictError } from "../../app/task/reject-task.ts";
import { ImportValidationError } from "../../app/resource/import-resources.ts";
import {
  CrossInitiativeError,
  UnknownNodeError,
  DuplicateRefError,
  CreateModeIdError,
  DriftConflictError,
  StaleManifestError,
  UncreatableObjectiveError,
} from "../../app/graph/import-errors.ts";
import {
  ImmutableFieldError,
  CacheConflictError,
} from "../../app/resource/update-resource.ts";
import {
  DuplicateAssignmentError,
  LoggedOutProviderError,
  DefaultNeedsReplacementError,
  SelfReplacementError,
  UnknownProviderError,
  CorruptDefaultPointerError,
  UnnecessaryReplacementError,
  InvalidEffortError,
  InvalidBaseUrlError,
  ConflictingDefaultChoiceError,
  NonOAuthProviderError,
  EmptyValueError,
  AssignedProviderError,
  InvalidRankError,
  AmbiguousFlagsError,
  InvalidApiFlavorError,
  InsecureEndpointError,
  MissingCustomProviderIdError,
  MissingBaseUrlError,
  InvalidNumericFlagError,
  NoUpdateFieldsError,
  BuiltinProviderFieldError,
  StaleCredentialError,
} from "../../app/ai-provider/errors.ts";
import {
  TaskNotAbandonableError,
  NoRunningJobError,
  AmbiguousRunningJobError,
} from "../../app/task/abandon-task.ts";
import {
  CursorNotUlidError,
  CursorAheadOfFeedError,
} from "../../app/project/ack-project.ts";

export class MissingFlagError extends Error {
  readonly flag: string;

  constructor(flag: string) {
    super(`missing required flag ${flag}`);
    this.name = "MissingFlagError";
    this.flag = flag;
  }
}

/**
 * Read a required string flag out of a parsed-args bag, or throw
 * `MissingFlagError`. Lives beside the error it throws; shared by every CLI
 * handler that has a required `--flag` (ai-provider, repo, resource,
 * project-readiness).
 */
export function requireFlag(
  args: Record<string, unknown>,
  flag: string,
): string {
  const value = args[flag];
  if (typeof value !== "string" || value === "") {
    throw new MissingFlagError(`--${flag}`);
  }
  return value;
}

export function toResult(err: unknown): { exitCode: number; stderr: string[] } {
  if (
    err instanceof UnknownReferenceError ||
    err instanceof WrongTypeReferenceError ||
    err instanceof DuplicateNameError ||
    err instanceof AmbiguousNameError ||
    err instanceof MissingFlagError ||
    err instanceof CycleError ||
    err instanceof DependenciesLockedError ||
    err instanceof TaskNotRetryableError ||
    err instanceof ObjectiveNotRetryableError ||
    err instanceof UnknownAgentError ||
    err instanceof TaskNotAwaitingConfirmationError ||
    err instanceof ObjectiveNotAwaitingConfirmationError ||
    err instanceof ObjectiveNotInConflictError ||
    err instanceof ImpactChangedError ||
    err instanceof StaleCandidateError ||
    err instanceof ProposalWorkspaceMissingError ||
    err instanceof ProposalMissingError ||
    err instanceof RejectionConflictError ||
    err instanceof ImportValidationError ||
    err instanceof CrossInitiativeError ||
    err instanceof UnknownNodeError ||
    err instanceof DuplicateRefError ||
    err instanceof CreateModeIdError ||
    err instanceof DriftConflictError ||
    err instanceof StaleManifestError ||
    err instanceof UncreatableObjectiveError ||
    err instanceof EmbeddedCredentialError ||
    err instanceof UnknownModelError ||
    err instanceof SequencingLockedError ||
    err instanceof SequencingScopeError ||
    err instanceof ImmutableFieldError ||
    err instanceof CacheConflictError ||
    err instanceof LoggedOutProviderError ||
    err instanceof DefaultNeedsReplacementError ||
    err instanceof SelfReplacementError ||
    err instanceof UnknownProviderError ||
    err instanceof CorruptDefaultPointerError ||
    err instanceof UnnecessaryReplacementError ||
    err instanceof InvalidEffortError ||
    err instanceof InvalidBaseUrlError ||
    err instanceof ConflictingDefaultChoiceError ||
    err instanceof NonOAuthProviderError ||
    err instanceof DuplicateAssignmentError ||
    err instanceof EmptyValueError ||
    err instanceof AssignedProviderError ||
    err instanceof InvalidRankError ||
    err instanceof AmbiguousFlagsError ||
    err instanceof InvalidApiFlavorError ||
    err instanceof InsecureEndpointError ||
    err instanceof MissingCustomProviderIdError ||
    err instanceof MissingBaseUrlError ||
    err instanceof InvalidNumericFlagError ||
    err instanceof NoUpdateFieldsError ||
    err instanceof BuiltinProviderFieldError ||
    err instanceof StaleCredentialError ||
    err instanceof TaskNotAbandonableError ||
    err instanceof NoRunningJobError ||
    err instanceof AmbiguousRunningJobError ||
    err instanceof CursorNotUlidError ||
    err instanceof CursorAheadOfFeedError
  ) {
    return { exitCode: 1, stderr: [`error: ${err.message}`] };
  }
  throw err;
}
