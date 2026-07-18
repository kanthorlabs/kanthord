/**
 * Story 09 — Named import/apply errors with rich provenance (B7/B15).
 *
 * Each class carries `sourcePath` (the offending file) plus node-specific
 * context so the caller can emit an itemized, actionable error message.
 */

// ---------------------------------------------------------------------------
// CrossInitiativeError — a node references an objective/initiative that
// belongs to a different initiative than the package scope (B5/B15).
// ---------------------------------------------------------------------------

export class CrossInitiativeError extends Error {
  readonly sourcePath: string;
  readonly ref: string;
  readonly expectedInitiativeId: string;
  readonly actualInitiativeId: string;

  constructor(
    sourcePath: string,
    ref: string,
    expectedInitiativeId: string,
    actualInitiativeId: string,
  ) {
    super(
      `${sourcePath}: ref "${ref}" belongs to initiative ${actualInitiativeId}` +
        ` but the package scope is initiative ${expectedInitiativeId}`,
    );
    this.name = "CrossInitiativeError";
    this.sourcePath = sourcePath;
    this.ref = ref;
    this.expectedInitiativeId = expectedInitiativeId;
    this.actualInitiativeId = actualInitiativeId;
  }
}

// ---------------------------------------------------------------------------
// UnknownNodeError — a ref or ULID resolves to neither a package node nor a
// DB row (B6 — ULID-shaped-but-unknown is always an error, never demoted).
// ---------------------------------------------------------------------------

export class UnknownNodeError extends Error {
  readonly sourcePath: string;
  readonly ref: string;

  constructor(sourcePath: string, ref: string) {
    super(`${sourcePath}: unknown node ref/id "${ref}"`);
    this.name = "UnknownNodeError";
    this.sourcePath = sourcePath;
    this.ref = ref;
  }
}

// ---------------------------------------------------------------------------
// DuplicateRefError — the same ref appears in two distinct package files in
// the same namespace (objective or task), violating B6.
// ---------------------------------------------------------------------------

export class DuplicateRefError extends Error {
  readonly sourcePath: string;
  readonly otherSourcePath: string;
  readonly ref: string;

  constructor(sourcePath: string, otherSourcePath: string, ref: string) {
    super(
      `Duplicate ref "${ref}": defined in both ${sourcePath} and ${otherSourcePath}`,
    );
    this.name = "DuplicateRefError";
    this.sourcePath = sourcePath;
    this.otherSourcePath = otherSourcePath;
    this.ref = ref;
  }
}

// ---------------------------------------------------------------------------
// CreateModeIdError — a persisted `id` was found in a package submitted under
// `--create` mode; create mode requires all nodes to be id-less.
// ---------------------------------------------------------------------------

export class CreateModeIdError extends Error {
  readonly sourcePath: string;
  readonly id: string;

  constructor(sourcePath: string, id: string) {
    super(
      `${sourcePath}: persisted id "${id}" found under --create mode.` +
        ` Use --apply to update an existing graph.`,
    );
    this.name = "CreateModeIdError";
    this.sourcePath = sourcePath;
    this.id = id;
  }
}

// ---------------------------------------------------------------------------
// DriftConflictError — the apply was rejected because the manifest baseline
// sha for a node no longer matches the live DB sha (B4/B7/B15).
// ---------------------------------------------------------------------------

export class DriftConflictError extends Error {
  readonly sourcePath: string;
  readonly ref: string;
  readonly expectedSha: string;
  readonly actualSha: string;

  constructor(
    sourcePath: string,
    ref: string,
    expectedSha: string,
    actualSha: string,
  ) {
    super(
      `${sourcePath}: drift detected on "${ref}" — ` +
        `expected sha ${expectedSha.slice(0, 8)}… but DB has ${actualSha.slice(0, 8)}…`,
    );
    this.name = "DriftConflictError";
    this.sourcePath = sourcePath;
    this.ref = ref;
    this.expectedSha = expectedSha;
    this.actualSha = actualSha;
  }
}
