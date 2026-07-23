// Domain errors that surface through the app boundary to the CLI. Re-exported
// here so `app/errors.ts` is the single error catalog the CLI maps, keeping
// `apps/` importing `app/` rather than reaching into `domain/` directly.
export { CycleError } from "../domain/graph.ts";
export { DependenciesLockedError } from "../domain/task.ts";
export type { TaskStatus } from "../domain/task.ts";
// EmbeddedCredentialError lives in domain; re-exported here so apps/ can
// catch it without importing domain directly.
export { EmbeddedCredentialError } from "../domain/resource.ts";
// Agent errors are owned by the agent-runner port; re-exported here so
// `apps/` (which may not import adapter ports directly) can reference them.
export { UnknownAgentError } from "../agent-runner/port.ts";
// Model-catalog error — re-exported so apps/ can catch it via app/ only.
export { UnknownModelError } from "../model-catalog/port.ts";
// Landing types and errors — re-exported so apps/ can reference them without
// importing the landing port directly.
export type { RepositoryLanding, LandingCandidate } from "../landing/port.ts";
export {
  LandingConflictError,
  LandingCASMismatchError,
} from "../landing/port.ts";

import type { TaskStatus } from "../domain/task.ts";

export class TaskNotAwaitingConfirmationError extends Error {
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus) {
    super(
      `task ${taskId} is not awaiting confirmation; current status: ${status}`,
    );
    this.name = "TaskNotAwaitingConfirmationError";
    this.taskId = taskId;
    this.status = status;
  }
}

export class ProposalWorkspaceMissingError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(
      `DB integrity error: task ${taskId} has proposalCommit set but workspace is missing`,
    );
    this.name = "ProposalWorkspaceMissingError";
    this.taskId = taskId;
  }
}

export class UnknownReferenceError extends Error {
  readonly kind: string;
  readonly id: string;

  constructor(kind: string, id: string) {
    super(`no ${kind} with id ${id}`);
    this.name = "UnknownReferenceError";
    this.kind = kind;
    this.id = id;
  }
}

export class WrongTypeReferenceError extends Error {
  readonly expected: string;
  readonly actual: string;
  readonly id: string;

  constructor(expected: string, actual: string, id: string) {
    super(`${id} is a ${actual}, expected a ${expected}`);
    this.name = "WrongTypeReferenceError";
    this.expected = expected;
    this.actual = actual;
    this.id = id;
  }
}

export class DuplicateNameError extends Error {
  readonly kind: string;
  readonly scope: string;
  readonly errorName: string;

  constructor(kind: string, scope: string, errorName: string) {
    super(`a ${kind} named ${errorName} already exists in ${scope}`);
    this.name = "DuplicateNameError";
    this.kind = kind;
    this.scope = scope;
    this.errorName = errorName;
  }
}

export class AmbiguousNameError extends Error {
  readonly kind: string;
  readonly errorName: string;
  readonly ids: string[];

  constructor(kind: string, errorName: string, ids: string[]) {
    super(`multiple ${kind} named ${errorName}: ${ids.join(", ")}`);
    this.name = "AmbiguousNameError";
    this.kind = kind;
    this.errorName = errorName;
    this.ids = ids;
  }
}
