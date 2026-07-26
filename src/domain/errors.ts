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
