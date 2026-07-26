// src/app/ai-provider/errors.ts — AI-provider specific errors (008.1 Story C/D).

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

/**
 * Thrown when an operation on the default ai-provider requires a replacement
 * id but none was provided (008.1 Story D: logout/remove of the default guard).
 */
/**
 * Thrown when --replacement is the same id as the target (self-replacement).
 * The operation must reject self-replacement because it would leave the
 * default pointing at a logged_out or deleted provider.
 */
export class SelfReplacementError extends Error {
  readonly id: string;
  readonly operation: string;

  constructor(operation: string, id: string) {
    super(`self-replacement not allowed for ${operation}: ${id}`);
    this.name = "SelfReplacementError";
    this.id = id;
    this.operation = operation;
  }
}

/**
 * Thrown when the provider kind is not in pi's pinned catalog.
 */
export class UnknownProviderError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`Unknown provider kind: "${provider}".`);
    this.name = "UnknownProviderError";
    this.provider = provider;
  }
}

/**
 * Thrown when the default pointer references a logged_out provider — a
 * corrupt invariant that logout detects before its idempotent early return.
 */
export class CorruptDefaultPointerError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(`default ai-provider ${id} is in a corrupt state: logged_out`);
    this.name = "CorruptDefaultPointerError";
    this.id = id;
  }
}

export class DefaultNeedsReplacementError extends Error {
  readonly id: string;
  readonly operation: string;

  constructor(id: string, operation: string) {
    super(
      `default ai-provider ${id} requires either --replacement <id> or --confirm-no-default for ${operation}`,
    );
    this.name = "DefaultNeedsReplacementError";
    this.id = id;
    this.operation = operation;
  }
}

/**
 * Thrown when --replacement or --confirm-no-default is provided for a
 * non-default provider (or on the last provider, where both are unnecessary).
 */
export class UnnecessaryReplacementError extends Error {
  readonly id: string;
  readonly operation: string;
  readonly flag: string;

  constructor(id: string, operation: string, flag: string) {
    super(
      `${flag} is unnecessary for ${operation} of non-default provider ${id}`,
    );
    this.name = "UnnecessaryReplacementError";
    this.id = id;
    this.operation = operation;
    this.flag = flag;
  }
}

/**
 * Thrown when both --replacement and --confirm-no-default are passed
 * together — the two escapes for acting on the current default are mutually
 * exclusive (008.1 S10).
 */
export class ConflictingDefaultChoiceError extends Error {
  readonly id: string;
  readonly operation: string;

  constructor(operation: string, id: string) {
    super(
      `${operation}: --replacement and --confirm-no-default are mutually exclusive`,
    );
    this.name = "ConflictingDefaultChoiceError";
    this.id = id;
    this.operation = operation;
  }
}

/**
 * Thrown when an invalid effort value is provided for a provider/model.
 */
export class InvalidEffortError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`invalid effort value: "${value}"`);
    this.name = "InvalidEffortError";
    this.value = value;
  }
}

/**
 * Thrown when an invalid baseUrl value is provided.
 */
export class InvalidBaseUrlError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`invalid baseUrl: "${value}"`);
    this.name = "InvalidBaseUrlError";
    this.value = value;
  }
}

/**
 * Thrown when the credential value is an empty string.
 */
export class EmptyValueError extends Error {
  constructor() {
    super("credential value must not be empty");
    this.name = "EmptyValueError";
  }
}
