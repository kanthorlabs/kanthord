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

// ---------------------------------------------------------------------------
// StaleManifestError — the manifest's formatVersion predates the current
// content-hash change (EPIC 007.18 Story 3); its node shas were computed
// under the old status-bearing canonicalTask and cannot be trusted.
// ---------------------------------------------------------------------------

export class StaleManifestError extends Error {
  readonly formatVersion: number;
  readonly expectedVersion: number;
  readonly initiativeId: string;

  constructor(
    formatVersion: number,
    expectedVersion: number,
    initiativeId: string,
  ) {
    super(
      `manifest formatVersion ${formatVersion} is stale (expected ${expectedVersion}) — ` +
        `its node shas predate the content-hash change; re-export with: ` +
        `kanthord export initiative ${initiativeId} --out <dir>`,
    );
    this.name = "StaleManifestError";
    this.formatVersion = formatVersion;
    this.expectedVersion = expectedVersion;
    this.initiativeId = initiativeId;
  }
}

// ---------------------------------------------------------------------------
// Story 10 C1 — binding alias errors
// ---------------------------------------------------------------------------

// A declared alias has no --bind mapping (and no fallback).
export class UnboundAliasError extends Error {
  readonly alias: string;

  constructor(alias: string) {
    super(`Alias "${alias}" has no --bind mapping.`);
    this.name = "UnboundAliasError";
    this.alias = alias;
  }
}

// CLI-resolved --bind value matches more than one resource by name.
export class AmbiguousBindingNameError extends Error {
  readonly alias: string;
  readonly bindingName: string; // the resource name from --bind alias=name
  readonly count: number;

  constructor(alias: string, name: string, count: number) {
    super(
      `Ambiguous binding for alias "${alias}": name "${name}" matches ${count} resources. Use a resource id.`,
    );
    this.name = "AmbiguousBindingNameError";
    this.alias = alias;
    this.bindingName = name;
    this.count = count;
  }
}

// CLI-resolved --bind value names a resource that does not exist in the project.
export class UnknownBindingNameError extends Error {
  readonly alias: string;
  readonly bindingName: string; // the resource name from --bind alias=name

  constructor(alias: string, name: string) {
    super(
      `Unknown binding for alias "${alias}": no resource named "${name}" found in the project.`,
    );
    this.name = "UnknownBindingNameError";
    this.alias = alias;
    this.bindingName = name;
  }
}

// The resource id supplied for an alias has the wrong type.
export class IncompatibleBindingTypeError extends Error {
  readonly alias: string;
  readonly expectedType: string;
  readonly actualType: string;

  constructor(alias: string, expectedType: string, actualType: string) {
    super(
      `Binding for alias "${alias}" expects type "${expectedType}" but got "${actualType}".`,
    );
    this.name = "IncompatibleBindingTypeError";
    this.alias = alias;
    this.expectedType = expectedType;
    this.actualType = actualType;
  }
}

// The provider and credential supplied are incompatible (provider mismatch).
export class IncompatibleProviderCredentialError extends Error {
  readonly aiProviderId: string;
  readonly credentialId: string;

  constructor(aiProviderId: string, credentialId: string) {
    super(
      `AI provider "${aiProviderId}" and credential "${credentialId}" have incompatible providers.`,
    );
    this.name = "IncompatibleProviderCredentialError";
    this.aiProviderId = aiProviderId;
    this.credentialId = credentialId;
  }
}

// ---------------------------------------------------------------------------
// EPIC 007.19 Story 1 — preflight refusal of uncreatable objective refs.
// An objective ref is unresolvable when a task's objectiveRef resolves to an
// id that does not correspond to an existing objective in the DB and cannot
// be created through --apply.
// ---------------------------------------------------------------------------

export class UncreatableObjectiveError extends Error {
  readonly initiativeId: string;
  readonly unresolvable: ReadonlyArray<{
    objectiveRef: string;
    taskRefs: string[];
  }>;

  constructor(
    initiativeId: string,
    unresolvable: ReadonlyArray<{
      objectiveRef: string;
      taskRefs: string[];
    }>,
  ) {
    const refsList = unresolvable
      .map((u) => `${u.objectiveRef} (blocked tasks: ${u.taskRefs.join(", ")})`)
      .join("; ");
    super(
      `Cannot apply: uncreatable objective(s) — ${refsList}. ` +
        `To create them, run: kanthord create objective --initiative ${initiativeId}`,
    );
    this.name = "UncreatableObjectiveError";
    this.initiativeId = initiativeId;
    this.unresolvable = unresolvable;
  }
}

// One or more tasks have an executor whose required binding set is not fully
// satisfied by the resolved context. Collects ALL violations in one report.
export class ExecutorBindingSetError extends Error {
  readonly errors: Array<{ taskRef: string; agent: string; missing: string[] }>;

  constructor(
    errors: Array<{ taskRef: string; agent: string; missing: string[] }>,
  ) {
    const lines = errors
      .map(
        (e) =>
          `  task "${e.taskRef}" (executor: ${e.agent}): missing binding(s): ${e.missing.join(", ")}`,
      )
      .join("\n");
    super(`Executor binding validation failed:\n${lines}`);
    this.name = "ExecutorBindingSetError";
    this.errors = errors;
  }
}
