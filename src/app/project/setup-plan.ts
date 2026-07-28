// src/app/project/setup-plan.ts — EPIC 015 Story 1
// Pure reconciliation engine for the guided setup wizard. No I/O, no clock, no
// id generation — every outcome is decided by reading the observed facts and
// the answers the user has provided. The wizard's step executor consumes the
// `SetupPlan` value verbatim; the only verbs it understands are
// create / skip / drift / ambiguous.
//
// Why pure: the same answers + the same observed state must always produce
// the same plan, so the wizard can be replayed (a rerun after fixing a
// drift), reasoned about in tests, and never accidentally re-bill a provider
// because of an ordering bug. Anything that needs the database lives in
// `ObserveSetupFacts` (sibling file); anything that needs the filesystem
// lives in the step executor.

// ── Type definitions ────────────────────────────────────────────────────────

export type RepositoryAuthMode = "ambient" | "https-token" | "ssh-agent";
export type ProviderRoute = "oauth" | "apiKey" | "custom";
export type ProviderApi = "openai-completions" | "openai-responses";

/**
 * The concrete auth value handed to `AddResource` and to EPIC 014's
 * `RepositoryProbe`. Exported from the app layer on purpose: `src/apps/cli/`
 * may import `app/` but never `domain/`, so this is how the coordinator names
 * the shape without mirroring `RepositoryAuth` a second time.
 */
export type RepositoryAuthValue =
  | { kind: "ambient" }
  | { kind: "https-token"; credentialId: string }
  | { kind: "ssh-agent" };

export interface SetupAnswers {
  project: { name: string };
  repository: {
    name: string;
    remoteUrl: string;
    branch: string;
    /** Always absolute — Story 2 resolves it before building this value. */
    path: string;
    auth: RepositoryAuthMode;
  };
  /** Present if and only if `repository.auth === "https-token"`. */
  credential?: { name: string; provider: string; valueFile: string };
  provider:
    | {
        route: "oauth";
        name: string;
        provider: string;
        model: string;
        oauthMethod: string;
      }
    | {
        route: "apiKey";
        name: string;
        provider: string;
        model: string;
        valueFile: string;
        confirmCost: true;
      }
    | {
        route: "custom";
        name: string;
        provider: string;
        model: string;
        valueFile: string;
        confirmCost: true;
        baseUrl: string;
        api: ProviderApi;
      };
  graph:
    | { skip: true }
    | { skip: false; packagePath: string; bind: Record<string, string> };
}

export type SetupObject =
  "project" | "credential" | "repository" | "provider" | "graph";

export interface DriftField {
  field: string;
  expected: string;
  actual: string;
}

export type StepOutcome =
  | { kind: "create" }
  | { kind: "skip"; reason: string }
  | {
      kind: "drift";
      object: SetupObject;
      targetId: string;
      fields: DriftField[];
    }
  | { kind: "ambiguous"; object: SetupObject; candidates: string[] };

export interface ObservedProject {
  id: string;
  name: string;
}
export interface ObservedCredential {
  id: string;
  name: string;
  provider: string;
}
export interface ObservedRepository {
  id: string;
  name: string;
  remoteUrl: string;
  branch: string;
  path: string;
  auth: RepositoryAuthValue;
}
export interface ObservedProvider {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  api: ProviderApi | null;
  state: "active" | "logged_out";
  assignedToProject: boolean;
}
export interface ObservedInitiative {
  id: string;
  name: string;
}

export interface ObservedFacts {
  /** Every project whose name equals `answers.project.name`, ids ascending. */
  projectsByName: ObservedProject[];
  /**
   * The four lists below are scoped to `projectsByName[0]` and MUST be empty
   * when `projectsByName.length !== 1`. Each is sorted by `id` ascending.
   */
  credentialsByName: ObservedCredential[];
  repositoriesByName: ObservedRepository[];
  providersByName: ObservedProvider[];
  initiatives: ObservedInitiative[];
}

export interface SetupPlan {
  project: StepOutcome;
  /** `undefined` iff `answers.repository.auth !== "https-token"`. */
  credential: StepOutcome | undefined;
  repository: StepOutcome;
  provider: StepOutcome;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Stable ascending sort by `id` (ULIDs sort lexicographically by time). */
function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Render an observed `RepositoryAuth` to the canonical comparison string.
 * The two non-`https-token` kinds have no parameters; `https-token` always
 * shows the credential id, even when the caller cannot — that's the whole
 * point of the reconciliation: the observed side is the source of truth.
 */
function renderActualAuth(auth: RepositoryAuthValue): string {
  switch (auth.kind) {
    case "ambient":
      return "ambient";
    case "ssh-agent":
      return "ssh-agent";
    case "https-token":
      return `https-token(credentialId=${auth.credentialId})`;
  }
}

/**
 * Render the answers' auth kind to the canonical comparison string. The
 * expected side is purely a kind unless a credential was observed; in that
 * case we lift `credentialsByName[0].id` because the answer file never
 * carries an id, only a `valueFile` and a name. The expected rendering
 * intentionally uses the observed id — when both render to the same string
 * the field is equal, when they differ the field is drift.
 */
function renderExpectedAuth(
  answersAuth: RepositoryAuthMode,
  observedAuth: RepositoryAuthValue,
): string {
  if (answersAuth === "ambient") return "ambient";
  if (answersAuth === "ssh-agent") return "ssh-agent";
  // https-token — expected carries no id, so render the observed id verbatim
  // only when the observed side is also https-token (the paired case). When
  // the observed kind differs, the non-paired side renders as the bare kind
  // (Story 1 rule 3.4), never `https-token(credentialId=)`.
  if (observedAuth.kind !== "https-token") return "https-token";
  return `https-token(credentialId=${observedAuth.credentialId})`;
}

function renderExpectedRoute(answers: SetupAnswers): "custom" | "builtin" {
  return answers.provider.route === "custom" ? "custom" : "builtin";
}

function renderActualRoute(api: ProviderApi | null): "custom" | "builtin" {
  return api !== null ? "custom" : "builtin";
}

// ── Per-object planners ─────────────────────────────────────────────────────

function planProject(
  projectsByName: readonly ObservedProject[],
  answers: SetupAnswers,
): StepOutcome {
  if (projectsByName.length === 0) return { kind: "create" };
  if (projectsByName.length === 1) {
    return {
      kind: "skip",
      reason: `project "${answers.project.name}" exists (${projectsByName[0]!.id})`,
    };
  }
  return {
    kind: "ambiguous",
    object: "project",
    candidates: sortById(projectsByName).map((p) => p.id),
  };
}

function planCredential(
  credentialsByName: readonly ObservedCredential[],
  answers: SetupAnswers,
): StepOutcome | undefined {
  if (answers.repository.auth !== "https-token") return undefined;
  if (credentialsByName.length === 0) return { kind: "create" };
  if (credentialsByName.length === 1) {
    return {
      kind: "skip",
      reason: `credential "${answers.credential?.name ?? ""}" exists (${credentialsByName[0]!.id})`,
    };
  }
  return {
    kind: "ambiguous",
    object: "credential",
    candidates: sortById(credentialsByName).map((c) => c.id),
  };
}

function planRepository(
  facts: ObservedFacts,
  answers: SetupAnswers,
): StepOutcome {
  const repos = facts.repositoriesByName;
  if (repos.length === 0) return { kind: "create" };
  if (repos.length > 1) {
    return {
      kind: "ambiguous",
      object: "repository",
      candidates: sortById(repos).map((r) => r.id),
    };
  }
  // Exactly one observed — compare the four fields in the fixed order
  // remoteUrl, branch, path, auth.
  const observed = repos[0]!;
  const fields: DriftField[] = [];

  // 1. remoteUrl
  if (observed.remoteUrl !== answers.repository.remoteUrl) {
    fields.push({
      field: "remoteUrl",
      expected: answers.repository.remoteUrl,
      actual: observed.remoteUrl,
    });
  }

  // 2. branch
  if (observed.branch !== answers.repository.branch) {
    fields.push({
      field: "branch",
      expected: answers.repository.branch,
      actual: observed.branch,
    });
  }

  // 3. path
  if (observed.path !== answers.repository.path) {
    fields.push({
      field: "path",
      expected: answers.repository.path,
      actual: observed.path,
    });
  }

  // 4. auth — the only field that can drift without a string difference.
  // When both sides are https-token and exactly one credential is observed,
  // the answer file does not carry a credential id, only a name and a
  // valueFile; the expected lifts `credentialsByName[0].id`. Strings are
  // then compared: equal → field is equal, different → drift. The previous
  // design always pushed drift in this branch, which broke Story 4's
  // "rerun is a no-op" contract — the comparison is now string-based.
  const observedCredentialId = facts.credentialsByName[0]?.id;
  if (
    answers.repository.auth === "https-token" &&
    observed.auth.kind === "https-token" &&
    facts.credentialsByName.length === 1
  ) {
    const expectedAuthStr = `https-token(credentialId=${observedCredentialId})`;
    const actualAuthStr = `https-token(credentialId=${observed.auth.credentialId})`;
    if (expectedAuthStr !== actualAuthStr) {
      fields.push({
        field: "auth",
        expected: expectedAuthStr,
        actual: actualAuthStr,
      });
    }
  } else {
    const expectedAuthStr = renderExpectedAuth(
      answers.repository.auth,
      observed.auth,
    );
    const actualAuthStr = renderActualAuth(observed.auth);
    if (expectedAuthStr !== actualAuthStr) {
      fields.push({
        field: "auth",
        expected: expectedAuthStr,
        actual: actualAuthStr,
      });
    }
  }

  if (fields.length === 0) {
    return {
      kind: "skip",
      reason: `repository "${answers.repository.name}" matches (${observed.id})`,
    };
  }
  return {
    kind: "drift",
    object: "repository",
    targetId: observed.id,
    fields,
  };
}

function planProvider(
  providersByName: readonly ObservedProvider[],
  answers: SetupAnswers,
): StepOutcome {
  if (providersByName.length === 0) return { kind: "create" };
  if (providersByName.length > 1) {
    return {
      kind: "ambiguous",
      object: "provider",
      candidates: sortById(providersByName).map((p) => p.id),
    };
  }
  const observed = providersByName[0]!;
  const fields: DriftField[] = [];

  // 1. model
  if (observed.model !== answers.provider.model) {
    fields.push({
      field: "model",
      expected: answers.provider.model,
      actual: observed.model,
    });
  }

  // 2. baseUrl — expected is the answer's value when the route is `custom`,
  // else the literal "null" (the database has no row for builtin providers).
  const expectedBaseUrl =
    answers.provider.route === "custom" ? answers.provider.baseUrl : "null";
  const actualBaseUrl = observed.baseUrl ?? "null";
  if (expectedBaseUrl !== actualBaseUrl) {
    fields.push({
      field: "baseUrl",
      expected: expectedBaseUrl,
      actual: actualBaseUrl,
    });
  }

  // 3. route — custom vs builtin only; oauth and apiKey share storage and
  // are not compared at this layer.
  const expectedRoute = renderExpectedRoute(answers);
  const actualRoute = renderActualRoute(observed.api);
  if (expectedRoute !== actualRoute) {
    fields.push({
      field: "route",
      expected: expectedRoute,
      actual: actualRoute,
    });
  }

  if (fields.length > 0) {
    return {
      kind: "drift",
      object: "provider",
      targetId: observed.id,
      fields,
    };
  }

  // Equivalent — but a logged-out provider is unusable, and an unassigned
  // provider is a no-op for the project. Both are reported as `create` so
  // the executor registers / re-registers / assigns, not as a skip.
  if (observed.state === "logged_out") {
    return { kind: "create" };
  }
  if (!observed.assignedToProject) {
    return { kind: "create" };
  }
  return {
    kind: "skip",
    reason: `provider "${answers.provider.name}" matches and is assigned (${observed.id})`,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Reconcile the user's requested setup against observed state, returning a
 * `SetupPlan` that decides each step (project / credential / repository /
 * provider) as `create` / `skip` / `drift` / `ambiguous`. See Story 1
 * "## Change" for the rules; the tests in `setup-plan.test.ts` are the
 * executable contract.
 */
export function planSetup(
  facts: ObservedFacts,
  answers: SetupAnswers,
): SetupPlan {
  return {
    project: planProject(facts.projectsByName, answers),
    credential: planCredential(facts.credentialsByName, answers),
    repository: planRepository(facts, answers),
    provider: planProvider(facts.providersByName, answers),
  };
}

/**
 * Reconcile the package import against the project's existing initiatives.
 * Distinct from `planSetup` because the graph step uses a different
 * multiplicity semantics (initiative name, not alias+resource).
 */
export function planGraph(
  initiatives: readonly ObservedInitiative[],
  answers: SetupAnswers,
  /** The `name` of the initiative declared by the package; `undefined` when `answers.graph.skip`. */
  packageInitiativeName: string | undefined,
): StepOutcome {
  if (answers.graph.skip === true) {
    return { kind: "skip", reason: "graph.skip=true" };
  }
  if (packageInitiativeName === undefined) {
    throw new Error(
      "planGraph: packageInitiativeName is required when graph.skip is false",
    );
  }
  const sorted = sortById(initiatives);
  const matches = sorted.filter((i) => i.name === packageInitiativeName);
  if (matches.length === 1) {
    return {
      kind: "skip",
      reason: `initiative "${packageInitiativeName}" exists (${matches[0]!.id})`,
    };
  }
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      object: "graph",
      candidates: matches.map((m) => m.id),
    };
  }
  // matches.length === 0 — only meaningful when initiatives already exist:
  // a fresh project creates the graph; a project with the wrong initiative
  // drifts on the package path so the user can fix the answers.
  if (sorted.length === 0) return { kind: "create" };
  return {
    kind: "drift",
    object: "graph",
    targetId: sorted[0]!.id,
    fields: [
      {
        field: "graph.packagePath",
        expected: packageInitiativeName,
        actual: sorted.map((i) => i.name).join(", "),
      },
    ],
  };
}
