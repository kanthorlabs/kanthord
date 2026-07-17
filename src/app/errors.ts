// Domain errors that surface through the app boundary to the CLI. Re-exported
// here so `app/errors.ts` is the single error catalog the CLI maps, keeping
// `apps/` importing `app/` rather than reaching into `domain/` directly.
export { CycleError } from "../domain/graph.ts";
export { DependenciesLockedError } from "../domain/task.ts";

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
