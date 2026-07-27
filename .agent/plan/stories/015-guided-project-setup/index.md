# EPIC 015 — Guided project setup (`setup project`) — stories

Epic: `.agent/plan/epics/015-guided-project-setup.md`
Prereq: EPIC 014 (sequence order) — and through it 011, 012, 013.

`kanthord setup project [--answers <file>] [--non-interactive]` reconciles a
requested project configuration against observed reality — absent → create,
present and equivalent → skip, present but different → fail with a drift
report, ambiguous → fail — and ends in one of two honest terminal states.

## Dispatch order

`01 → 02 → 03 → 04 → 05`, strictly sequential.

- **01** declares every type the later stories consume (`SetupAnswers`,
  `ObservedFacts`, `StepOutcome`) and the pure plan.
- **02** is the parser that produces `SetupAnswers`; it imports 01's types.
- **03** is the pure drift/ambiguous formatter over 01's `StepOutcome`.
- **04 + 05 are a coupled pair**: both edit `src/apps/cli/setup/run-setup.ts`.
  04 adds the step loop and per-step lines; 05 adds the closing block, the CLI
  leaf, and the interactive seam. Do not start 05 before 04 is green.

## Stories

- 1 — `SetupPlan` + observed facts (pure plan, four outcomes, multiplicity) → `01-setup-plan-and-observed-facts.md`
- 2 — Answer file parsing + atomic preflight validation → `02-answer-parsing-and-preflight.md`
- 3 — Drift and ambiguity reporting with remediation → `03-drift-reporting.md`
- 4 — Step execution + per-step verification → `04-step-execution.md`
- 5 — `setup project` CLI leaf + interactive prompt seam + closing output → `05-cli-leaf-and-prompt-seam.md`

## Facts (needed for implementation)

**Prereq capabilities this epic consumes and must not re-specify**

- `list project` (leaf + `ListProjects`) arrives with EPIC 011. It does not
  exist in the tree as authored (`src/apps/cli/commands/list/` has no
  `project.ts`); the Proof uses it at lines 136, 148, 214, 221, 240.
- Three EPIC 014 seams are consumed as-is, all already constructed in
  `src/composition.ts` and declared on `CliDeps` by 014. 015 adds no composition
  entry for any of them and **writes no `git` invocation and no second probe**:
  - `checkProject` — `CheckProject` (`src/app/project/check-project.ts`, 014
    story 6), `execute({ id, probeRepositories, probeProvider }) → Promise<ReadinessReport>`,
    throwing `UnknownReferenceError` for an unknown id. The report is
    `buildProjectReadiness`'s output: `configured`, `verified`, `operational`,
    `ready`, `checks`, `next`.
  - `repositoryProbe` — port `RepositoryProbe` (`src/repository-probe/port.ts`),
    adapter `GitRepositoryProbe` (014 story 4).
    `probe({ remoteUrl, branch, auth }) → Promise<{ status: "ok" | "failed"; detail: string }>`.
    It **never throws**, owns its own `REPOSITORY_PROBE_TIMEOUT_MS = 10_000`
    bound, and its `detail` is already redacted, single-line and ≤300 chars. It
    does **not** discriminate "unreachable" from "branch missing" — the branch
    case is conveyed by the detail text `branch "<branch>" not found on remote`.
  - `providerProbe` — `ProbeAiProvider` (`src/app/project/probe-ai-provider.ts`,
    014 story 5), `execute(providerId) → Promise<{ resourceId, status, detail }>`.
    It **never throws**, owns the fixed `PROVIDER_PROBE_PROMPT`, wraps
    `TestAiProvider` → `ProviderProbe`/`PiProviderProbe`, keeps the model reply
    out of `detail`, and applies `makeRedactor` to a failure. Setup reuses it
    rather than `TestAiProvider` directly, so it hand-rolls neither a prompt
    constant nor secret scrubbing.
- `apps/` may import `app/` only — never a capability port and never
  `src/domain/`. The established workaround is a local structural mirror with a
  comment (`src/apps/cli/deps.ts:63-78` and `:80-92`,
  `src/apps/cli/resource.ts:14-17`). Story 4 mirrors `RepositoryProbe` and the
  `providerProbe` shape that way; the repository auth value comes from the app
  layer instead (`RepositoryAuthValue` in `setup-plan.ts`), so the domain
  `RepositoryAuth` is not mirrored a second time.

**Grounding in the current tree**

- `AddResource` (`src/app/resource/add-resource.ts:76`) input is a 4-way union
  discriminated on `type` (`:19-48`); **every field is required**. A repository
  `path` of `""` derives `join(homedir(), ".kanthord", "repos", …)` at `:56`
  and `:60`, which is why `repository.path` is a required answer key and why the
  Proof redirects `HOME`.
- A repository references a credential only through
  `auth = { kind: "https-token", credentialId }` (`src/domain/resource.ts:13-16`).
  There is no top-level `credentialId` field, and `RepositoryView`
  (`src/app/resource/resource-view.ts:22-36`) exposes `auth`, not `credential`.
- `EmbeddedCredentialError` interpolates the raw URL into its message
  (`src/domain/resource.ts:84`). The detector is the pure
  `hasEmbeddedUserinfo(url)` (`:161-172`): requires `://`, takes the authority up
  to the first `/`, true iff it contains `@`. Setup refuses in preflight so the
  domain error can never fire. **The domain message is not changed by this epic.**
- `resolveProjectByName(name): string[]` — port `src/storage/port.ts:65`, adapter
  `src/storage/sqlite/sqlite-project-repository.ts:129-134`, exact `name =` match.
  Duplicates are reachable, so multiplicity is load-bearing.
- Global AI providers are keyed by **`name`**:
  `SqliteAiProviderRegistry.register` calls `#getByName(input.name)` and throws
  `DuplicateNameError("ai_provider", "global", name)` when a match is `active`
  (`src/storage/sqlite/ai-provider-registry.ts:60-62`); a `logged_out` match is
  reactivated with a bumped `credentialVersion`. Registering blindly on a rerun
  therefore throws — reconciliation is what prevents it.
- Provider route is only partly observable: `GlobalAiProvider.api !== null`
  means the custom OpenAI-compatible route. **Nothing records oauth vs apiKey**,
  and this epic adds no column, so route drift is checked as
  `custom` ↔ `builtin` only.
- `AssignAiProvider.execute({ projectId, providerId })` is **synchronous, returns
  `void`**, appends at `maxRank+1` when `rank` is omitted
  (`src/app/ai-provider/assign-ai-provider.ts:12-64`), and throws
  `DuplicateAssignmentError` on a repeat.
- `ResolveProjectChain` is **not** a valid oracle for "is this provider assigned
  to this project": it folds in the global default and drops `logged_out`
  members (`src/app/ai-provider/resolve-project-chain.ts:14-46`). Assignment
  must be observed from `AiProviderRegistry.listAssigned(projectId)`
  (`src/storage/port.ts:338`).
- Under 014's `providerProbe`, `TestAiProvider.execute({ id, prompt })` →
  `PiProviderProbe.probe` (`src/agent-runner/pi-provider-probe.ts:24`) returns the
  joined `text_delta` deltas. With `KANTHORD_FAKE_AGENT` set — which the Proof does at
  `scripts/e2e/guided-setup-proof.sh:45` — `src/main.ts:35-57` swaps in
  `fakeSessionFactoryFromTurns`, so the probe is hermetic. The landing
  package's first scripted turn is a **tool call**, which emits no `text_delta`,
  so the probe resolves with the **empty string**. Verification must therefore
  pass on "resolved without throwing" and must never inspect the text.
- `import graph --create` **rewrites the package source files with the assigned
  ULIDs** (`src/apps/cli/import-graph.ts:462-510`) and writes
  `.kanthord-export.json` (`:523-543`). The Proof imports the same `$GRAPH`
  directory in Phase F and again in Phase J against a fresh database, so
  **setup's graph step must not mutate the package directory** — it calls
  `CreateGraph` directly and skips the write-back.
- `readGraphPackageDir` is called with no `try`/`catch` in `runCreate`
  (`src/apps/cli/import-graph.ts:373`), so a missing directory escapes as a raw
  `ENOENT` rejection. Setup wraps the read itself.
- The graph package's alias resolution (name **or** ULID) lives inline in
  `runCreate` at `src/apps/cli/import-graph.ts:376-444`; `isUlidShaped` is
  `:358-361`. Story 4 extracts it rather than re-implementing it.
- `CreateGraph.execute({ pkg, projectId, packageId, bindings })` where
  `bindings` is alias → **resolved resource id**
  (`src/app/graph/create-graph.ts:41-46`). The package declares alias → **type**
  in `pkg.initiative.bindings` (`src/app/graph/graph-package.ts:36`).
- The e2e package (`scripts/e2e/make-todo-graph.sh:26-33`) declares
  `bindings: { source: repository }` and initiative `name: TODO application API`.
- `Initiative` carries `name` (`src/domain/initiative.ts:18-26`);
  `InitiativeRepository.listInitiatives(projectId)` is `src/storage/port.ts:76`.
- `ProjectRepository.listResources(projectId): Resource[]` (`src/storage/port.ts:61`)
  is unconditional. Prefer it over `listResourcesByProject?` — the latter is
  optional on the port and `ListResources` silently returns `[]` when an adapter
  lacks it (`src/app/resource/list-resources.ts:17-21`), which would fake a
  "nothing observed" reconciliation.
- Secret-free read paths already exist: `CredentialView` has no `value`
  (`src/app/resource/resource-view.ts:14-20`, built field-by-field at `:61-73`)
  and `AiProviderView` has no `value`
  (`src/app/ai-provider/ai-provider-view.ts:5-14`).
- `readCredentialValue({ valuefile, timeoutMs })`
  (`src/apps/cli/credential-input.ts:69`) treats `valuefile === "-"` as stdin.
  `--answers` mode rejects `-` in preflight. Only `src/apps/cli/*` imports this
  module today, and `eslint.config.js` (`boundaries/dependencies`, default
  `disallow`) already makes an `src/app/** → src/apps/**` import a lint error.
  Note the carve-out: boundary enforcement is **off** inside `*.test.ts`.
- CLI shape: group file `src/apps/cli/commands/<group>.ts`, leaf file
  `src/apps/cli/commands/<group>/<leaf>.ts`, pure handler
  `src/apps/cli/<name>.ts`. `src/apps/cli/graph-md/` is the precedent for a
  non-command helper directory beside `commands/` — `src/apps/cli/setup/` follows it.
- `index.ts` must stay free of `.action(`, `.option(`, `.requiredOption(`,
  `.argument(` — asserted as raw substrings (`src/apps/cli/architecture.test.ts:57-65`).
- `src/apps/cli/architecture.test.ts` holds `EXPECTED_LEAF_FILE_COUNT` (`:28`)
  and `EXPECTED_LEAF_COUNT` (`:33`), currently 65 and 68. **Do not hard-code new
  numbers**: this epic adds exactly one leaf file under `commands/setup/` and
  exactly one registered leaf, so increment whatever values the file holds when
  the story runs by **+1 each**. `src/apps/cli/setup/*.ts` is outside
  `commands/` and affects neither count. EPICs 011–014 also bump these.
- Every leaf needs a non-empty `.description()`, `configureHelp({ commandUsage })`
  and `addHelpText("after", "\nExample:\n  …\n")` containing the literal `Example`.
- Failure convention: return `{ exitCode: 1, stdout: [], stderr: ["error: …"] }`
  through `emitResult` (`src/apps/cli/commands/action.ts:22-26`). Any **thrown**
  error class not listed in `src/apps/cli/error-map.ts:68-123` escapes as an
  unhandled rejection — setup returns results, it does not throw.
- Tests: `node --test`, co-located `*.test.ts`, `import { test, describe } from "node:test"`,
  `import assert from "node:assert/strict"`. Fakes are per-test and inline
  (`src/app/project/create-project.test.ts:10-48` is the storage-port fake
  pattern). Leaf-level output capture: `src/apps/cli/ai-provider.test.ts:33-49`.
  `CliIo` is output-only (`src/apps/cli/commands/action.ts:12-16`) — **do not add
  a member to it**; every `capture()`/`noopIo` literal in the suite would break.
- `db status` prints 23 `table: count` lines (verified) — the Proof's no-write
  fingerprint.
