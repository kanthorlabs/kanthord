import type { RepositoryAuth, ReasoningEffort } from "../../domain/resource.ts";

export interface UpdateRepositoryInput {
  [key: string]: unknown;
  id: string;
  name?: string;
  branch?: string;
  path?: string;
  remoteUrl?: string;
  auth?: RepositoryAuth;
  reclone?: boolean; // required when remoteUrl changes and home cache exists
}

export interface UpdateCredentialInput {
  [key: string]: unknown;
  id: string;
  name?: string;
  value?: string; // populated by the CLI via readCredentialValue(), never from --value
}

export interface UpdateAiProviderInput {
  [key: string]: unknown;
  id: string;
  name?: string;
  model?: string;
  effort?: ReasoningEffort | null; // null = clear
  baseUrl?: string | null; // null = clear (explicit --clear-base-url)
}

export interface UpdateNotificationInput {
  [key: string]: unknown;
  id: string;
  name?: string;
  destination?: string;
}

export interface UpdateFilesystemInput {
  [key: string]: unknown;
  id: string;
  name?: string;
  path?: string;
}

/** Thrown when the caller tries to change an immutable field. */
export class ImmutableFieldError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`field "${field}" is immutable and cannot be changed`);
    this.name = "ImmutableFieldError";
    this.field = field;
  }
}

/**
 * Thrown when a remoteUrl update is attempted but the home clone exists and
 * --reclone was not passed.
 */
export class CacheConflictError extends Error {
  readonly resourceId: string;

  constructor(resourceId: string) {
    super(
      `repository ${resourceId} has a cached home clone; pass --reclone to force update`,
    );
    this.name = "CacheConflictError";
    this.resourceId = resourceId;
  }
}
