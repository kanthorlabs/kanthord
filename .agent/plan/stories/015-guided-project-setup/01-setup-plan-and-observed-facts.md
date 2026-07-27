# Story 1 — `SetupPlan` + observed facts

Epic: `.agent/plan/epics/015-guided-project-setup.md`

## Change

### A. New file `src/app/project/setup-plan.ts` — pure, zero I/O

No `node:fs`, no `await`, no clock, no id generation. It may import
`src/domain/*` only.

Declare and export, exactly:

```ts
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

export function planSetup(
  facts: ObservedFacts,
  answers: SetupAnswers,
): SetupPlan;

export function planGraph(
  initiatives: ObservedInitiative[],
  answers: SetupAnswers,
  /** The `name` of the initiative declared by the package; `undefined` when `answers.graph.skip`. */
  packageInitiativeName: string | undefined,
): StepOutcome;
```

`planSetup` rules, evaluated in this order:

1. **project** — `projectsByName.length`: `0` → `{kind:"create"}`; `1` →
   `{kind:"skip", reason: 'project "<name>" exists (<id>)'}`; `>1` →
   `{kind:"ambiguous", object:"project", candidates: <all ids, ascending>}`.
2. **credential** — `undefined` unless `answers.repository.auth === "https-token"`.
   Otherwise on `credentialsByName.length`: `0` → `create`; `1` →
   `{kind:"skip", reason: 'credential "<name>" exists (<id>)'}`; `>1` →
   `ambiguous` with `object:"credential"`. **No drift fields exist for a
   credential** — the secret is never compared and `provider` is immutable on
   `UpdateCredential`.
3. **repository** — on `repositoriesByName.length`: `0` → `create`; `>1` →
   `ambiguous`; `1` → compare these four fields **in this exact order** and
   collect every difference into `fields`:
   1. `remoteUrl` — string equality against `answers.repository.remoteUrl`.
   2. `branch` — string equality.
   3. `path` — string equality (both absolute).
   4. `auth` — rendered to a string, then compared:
      - `"ambient"`, `"ssh-agent"`, or `"https-token"`;
      - when **both** sides are `https-token` **and** `credentialsByName.length === 1`,
        render both as `https-token(credentialId=<id>)`, expected using
        `credentialsByName[0].id`;
      - when both sides are `https-token` and `credentialsByName.length !== 1`,
        the field is **equal** (the expected credential id is not yet knowable).

   Empty `fields` → `{kind:"skip", reason: 'repository "<name>" matches (<id>)'}`.
   Non-empty → `{kind:"drift", object:"repository", targetId:<observed id>, fields}`.

4. **provider** — on `providersByName.length`: `0` → `create`; `>1` →
   `ambiguous`; `1` → compare **in this exact order**:
   1. `model` — string equality against `answers.provider.model`.
   2. `baseUrl` — expected is `answers.provider.baseUrl` for route `custom`,
      otherwise the literal `"null"`; actual is `observed.baseUrl ?? "null"`.
   3. `route` — expected `"custom"` when `answers.provider.route === "custom"`,
      else `"builtin"`; actual `"custom"` when `observed.api !== null`, else
      `"builtin"`. **`oauth` vs `apiKey` is not compared** — no stored column
      distinguishes them and this epic adds none.

   Then: non-empty `fields` → `drift`. Empty `fields` **and**
   `observed.state === "logged_out"` → `create`. Empty `fields` and
   `assignedToProject === false` → `create`. Otherwise →
   `{kind:"skip", reason: 'provider "<name>" matches and is assigned (<id>)'}`.

`planGraph` rules:

- `answers.graph.skip === true` → `{kind:"skip", reason:"graph.skip=true"}`.
- Otherwise, with `matches = initiatives.filter(i => i.name === packageInitiativeName)`:
  - `matches.length === 1` → `{kind:"skip", reason: 'initiative "<name>" exists (<id>)'}`.
  - `matches.length > 1` → `{kind:"ambiguous", object:"graph", candidates:<match ids ascending>}`.
  - `matches.length === 0` and `initiatives.length === 0` → `{kind:"create"}`.
  - `matches.length === 0` and `initiatives.length > 0` →
    `{kind:"drift", object:"graph", targetId:<initiatives[0].id>, fields:[{
  field:"graph.packagePath",
  expected:<packageInitiativeName>,
  actual:<observed names joined by ", " in id order>}]}`.
- `packageInitiativeName === undefined` while `answers.graph.skip === false` is a
  programming error: throw `new Error("planGraph: packageInitiativeName is required when graph.skip is false")`.

### B. New file `src/app/project/observe-setup-facts.ts`

```ts
export interface ObserveSetupFactsInput {
  projectName: string;
  repositoryName: string;
  providerName: string;
  /** Omitted when `repository.auth !== "https-token"`. */
  credentialName?: string;
}

export class ObserveSetupFacts {
  constructor(
    projects: ProjectRepository,
    initiatives: InitiativeRepository,
    registry: AiProviderRegistry,
  );
  execute(input: ObserveSetupFactsInput): ObservedFacts; // synchronous
}
```

All three deps are `import type` from `../../storage/port.ts`. Body:

1. `projectsByName` = `projects.resolveProjectByName(input.projectName)` sorted
   ascending, each mapped through `projects.get(id)` to `{ id, name }`; an id that
   resolves to `undefined` is dropped.
2. If `projectsByName.length !== 1`, return with the other four lists as `[]`.
3. `projectId = projectsByName[0].id`.
4. `resources = projects.listResources(projectId)` — the unconditional port
   method at `src/storage/port.ts:61`. **Do not** use `ListResources` /
   `listResourcesByProject?`.
   - `credentialsByName` = resources passing `isCredential` with
     `name === input.credentialName` (empty when `credentialName` is omitted),
     mapped to `{ id, name, provider }`, sorted by `id`.
   - `repositoriesByName` = resources passing `isRepository` with
     `name === input.repositoryName`, mapped to
     `{ id, name, remoteUrl, branch, path, auth }`, sorted by `id`.
     Both guards come from `src/domain/resource.ts:65-79`.
5. `assigned = registry.listAssigned(projectId)`;
   `providersByName` = `registry.list()` filtered to `name === input.providerName`,
   mapped to `{ id, name, provider, model, baseUrl, api, state, assignedToProject: assigned.some(a => a.id === p.id) }`,
   sorted by `id`. **`value` is never copied into the fact.**
6. `initiatives` = `initiatives.listInitiatives(projectId)` mapped to
   `{ id, name }`, sorted by `id`.

### C. Wire into `src/composition.ts` + `src/apps/cli/deps.ts`

Construct `const observeSetupFacts = new ObserveSetupFacts(projectRepository, initiativeRepository, aiProviderRegistry);`
next to the other project use cases and return it under the key
`observeSetupFacts` in the `buildDeps` bundle (`src/composition.ts:850-920`).
Add the matching `import type` + field to `CliDeps` (`src/apps/cli/deps.ts:131-211`).

## Constraints

- `setup-plan.ts` performs no I/O and imports nothing outside `src/domain/`.
  `observe-setup-facts.ts` imports only `src/domain/*` and
  `src/storage/port.ts` (type-only) — never an adapter.
- Every returned list is sorted by `id` ascending so the same database always
  yields the same plan and the same drift report.
- `ObservedProvider` must not carry `value`, and `ObservedCredential` must not
  carry the secret. Nothing in this story reads a secret.
- Add no migration, no table, no column.

## Verify

- `src/app/project/setup-plan.test.ts` — pure, no fakes needed:
  - `planSetup` returns all four outcomes for **each** of project, credential,
    repository, provider (create / skip / drift / ambiguous), one test per
    object per outcome. Credential has no drift case: assert instead that a
    credential whose observed `provider` differs still yields `skip`.
  - project multiplicity: `0 → create`, `1 → skip`, `2 → ambiguous` with both
    ids in ascending order in `candidates`.
  - repository drift, one test per field — `remoteUrl`, `branch`, `path`,
    `auth` — asserting `fields[0].field`, `.expected`, `.actual`.
  - repository drift with three fields differing asserts `fields.map(f => f.field)`
    deep-equals `["remoteUrl", "branch", "path"]` (fixed order).
  - `auth` equality when both sides are `https-token` and `credentialsByName`
    is empty; `auth` drift rendering `https-token(credentialId=…)` when exactly
    one credential is observed with a different id.
  - `credential` is `undefined` in the plan when `auth` is `ambient` and when it
    is `ssh-agent`.
  - provider drift, one test per field — `model`, `baseUrl`, `route`
    (`builtin` vs `custom`) — plus a test that route `oauth` against an observed
    `api: null` provider is **not** drift.
  - provider `create` when observed but `logged_out`; `create` when observed,
    equivalent and active but `assignedToProject === false`; `skip` only when
    equivalent, active and assigned.
  - `planSetup` with `projectsByName.length === 0` returns `create` for
    repository and provider (and for credential when `https-token`).
  - `planGraph`: `skip` on `graph.skip=true`; `create` on no initiatives;
    `skip` on exactly one name match; `ambiguous` on two name matches;
    `drift` with `field === "graph.packagePath"` when initiatives exist but none
    matches, `actual` listing observed names joined by `", "`.
  - `planGraph` throws when `graph.skip` is false and `packageInitiativeName` is
    `undefined`.
- `src/app/project/observe-setup-facts.test.ts` — inline fakes for
  `ProjectRepository`, `InitiativeRepository`, `AiProviderRegistry` in the style
  of `src/app/project/create-project.test.ts:10-48`:
  - two projects sharing the name → `projectsByName.length === 2` and the other
    four lists are `[]`.
  - one project → resources filtered by type **and** name; a repository named
    differently is absent; a credential named differently is absent.
  - `credentialName` omitted → `credentialsByName` is `[]` even when credentials exist.
  - `assignedToProject` is `true` only when the provider id appears in
    `listAssigned(projectId)`; a provider that is only the **global default**
    (returned by `getDefault`, absent from `listAssigned`) yields
    `assignedToProject === false`.
  - lists are sorted by `id` ascending even when the fake returns them reversed.
  - the returned `ObservedProvider` has no `value` property
    (`assert.equal("value" in observed, false)`), and the fake's credential
    `value` never appears in `JSON.stringify(facts)`.
  - the fake `ProjectRepository` implements `listResourcesByProject` as a
    throwing method to prove `execute` uses `listResources` instead.
- `node --test src/app/project/setup-plan.test.ts src/app/project/observe-setup-facts.test.ts`
- `npm run verify` exits 0.
- Proof: no Proof line directly; every later story's reconciliation behaviour
  (Phases F, H, I, J, K) is decided here.
