// src/domain/errors.ts — Domain-level errors for cross-cutting concerns
// (008.1 S12: DuplicateNameError moved here so adapters can import it
// without violating the adapter→app boundary rule).

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

export class LoggedOutProviderError extends Error {
  readonly id: string;
  readonly operation: string;

  constructor(id: string, operation: string) {
    super(`${operation}: provider ${id} is logged_out`);
    this.name = "LoggedOutProviderError";
    this.id = id;
    this.operation = operation;
  }
}
