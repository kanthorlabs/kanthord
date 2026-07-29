// src/app/ai-provider/errors.ts — AI-provider specific errors (008.1 Story C/D).

export { UnknownReferenceError } from "../../app/errors.ts";

export { LoggedOutProviderError } from "../../domain/errors.ts";

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
 * Thrown when login is attempted for a provider that does not support OAuth
 * (008.3 Story E). Message must hint at `register ai-provider --value-file`.
 */
export class NonOAuthProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(
      `provider "${providerId}" does not support OAuth login. Use \`register ai-provider --value-file\` for API-key providers.`,
    );
    this.name = "NonOAuthProviderError";
    this.providerId = providerId;
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

/**
 * Thrown when a provider is already assigned to a project (008.2 Story B).
 */
export class DuplicateAssignmentError extends Error {
  readonly projectId: string;
  readonly providerId: string;

  constructor(projectId: string, providerId: string) {
    super(
      `duplicate assignment: provider ${providerId} is already assigned to project ${projectId}`,
    );
    this.name = "DuplicateAssignmentError";
    this.projectId = projectId;
    this.providerId = providerId;
  }
}

/**
 * Thrown when the base-url targets an insecure endpoint (plain http://,
 * loopback, or private IP) and --allow-insecure was not passed.
 */
export class InsecureEndpointError extends Error {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    super(
      `insecure endpoint ${baseUrl} — pass --allow-insecure to register a custom provider at a private or plain-http URL`,
    );
    this.name = "InsecureEndpointError";
    this.baseUrl = baseUrl;
  }
}

/**
 * Thrown when a provider is assigned to one or more projects and is removed
 * without --cascade or --replacement (008.2 Story E).
 */
export class AssignedProviderError extends Error {
  readonly id: string;
  readonly assignedCount: number;

  constructor(id: string, assignedCount: number) {
    super(
      `cannot remove provider ${id}: it is assigned to ${assignedCount} project(s). Use --cascade or --replacement`,
    );
    this.name = "AssignedProviderError";
    this.id = id;
    this.assignedCount = assignedCount;
  }
}

/**
 * Thrown when an invalid api flavor is provided for a custom OpenAI-compatible
 * provider. The allowlist is "openai-completions" / "openai-responses".
 */
export class InvalidApiFlavorError extends Error {
  readonly flavor: string;

  constructor(flavor: string) {
    super(`invalid api flavor: "${flavor}"`);
    this.name = "InvalidApiFlavorError";
    this.flavor = flavor;
  }
}

/**
 * Thrown when --rank is invalid (e.g. negative or NaN) (008.2 HUMAN_REVIEW B3).
 */
export class InvalidRankError extends Error {
  readonly rank: number;

  constructor(rank: number) {
    super("invalid rank: --rank must be a non-negative integer");
    this.name = "InvalidRankError";
    this.rank = rank;
  }
}

/**
 * Thrown when a custom register call has no --custom-provider-id.
 */
export class MissingCustomProviderIdError extends Error {
  constructor() {
    super("custom-provider-id is required for custom providers");
    this.name = "MissingCustomProviderIdError";
  }
}

/**
 * Thrown when both --cascade and --replacement are passed together
 * to remove ai-provider (008.2 HUMAN_REVIEW S1).
 */
export class AmbiguousFlagsError extends Error {
  readonly id: string;
  readonly flag1: string;
  readonly flag2: string;

  constructor(id: string, flag1: string, flag2: string) {
    super(
      `cannot remove provider ${id}: --${flag1} and --${flag2} are mutually exclusive`,
    );
    this.name = "AmbiguousFlagsError";
    this.id = id;
    this.flag1 = flag1;
    this.flag2 = flag2;
  }
}

/**
 * Thrown when a custom register call has no --base-url.
 */
export class MissingBaseUrlError extends Error {
  constructor() {
    super("base-url is required for custom providers");
    this.name = "MissingBaseUrlError";
  }
}

/**
 * Thrown when a numeric CLI flag (e.g. --context-window, --max-tokens)
 * receives a non-numeric or non-positive value.
 */
export class InvalidNumericFlagError extends Error {
  readonly flag: string;
  readonly value: unknown;

  constructor(flag: string, value: unknown) {
    super(`invalid numeric flag --${flag}: "${value}"`);
    this.name = "InvalidNumericFlagError";
    this.flag = flag;
    this.value = value;
  }
}

/**
 * Thrown when `update ai-provider` is called with no field to change
 * (018 S3).
 */
export class NoUpdateFieldsError extends Error {
  constructor() {
    super("update ai-provider requires at least one field to change");
    this.name = "NoUpdateFieldsError";
  }
}

/**
 * Thrown when a builtin-provider (`api === null`) update patch includes a
 * custom-only field (`api`, `baseUrl`, `contextWindow`, `maxTokens`) (018 S3).
 */
export class BuiltinProviderFieldError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(
      `--${field} is only valid for a custom provider (registered with --api)`,
    );
    this.name = "BuiltinProviderFieldError";
    this.field = field;
  }
}

/**
 * Thrown when `updateCredentialCAS` reports `{applied:false}` — the
 * credential version changed between the read and the write (018 S3).
 */
export class StaleCredentialError extends Error {
  readonly id: string;

  constructor(id: string) {
    super(
      `credential for ai-provider ${id} changed concurrently — retry the update`,
    );
    this.name = "StaleCredentialError";
    this.id = id;
  }
}
