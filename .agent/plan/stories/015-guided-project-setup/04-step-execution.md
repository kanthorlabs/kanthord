# Story 4 — Step execution + per-step verification

Epic: `.agent/plan/epics/015-guided-project-setup.md`
Depends on: Stories 1, 2, 3. Coupled with Story 5 (both edit `run-setup.ts`).

## Change

### A. Extract the graph alias resolver — `src/apps/cli/import-graph.ts`

`runCreate` resolves each declared alias inline at
`src/apps/cli/import-graph.ts:376-444`. Lift that block, unchanged in
behaviour, into a new exported function in the same file and have `runCreate`
call it:

```ts
export async function resolveGraphBindings(
  /** alias → expected resource type, i.e. `pkg.initiative.bindings`. */
  declared: Record<string, string>,
  /** alias → resource name or ULID. */
  bind: Record<string, string>,
  projectId: string,
  deps: {
    findResourcesByName?: ImportGraphDeps["findResourcesByName"];
    getResource?: ImportGraphDeps["getResource"];
  },
): Promise<
  | { ok: true; bindings: Record<string, string> }
  | { ok: false; errors: string[] }
>;
```

Keep every existing message byte-identical: the missing-mapping string
`error: alias "<alias>" has no --bind mapping (missing --bind <alias>=<id>)`,
`UnknownBindingNameError`, `AmbiguousBindingNameError`, the
`error: alias "<alias>": resource "<id>" not found` string,
`IncompatibleBindingTypeError`, the ULID-vs-name discrimination via the existing
`isUlidShaped` (`:358-361`), and the accumulate-all-errors behaviour. `runCreate`
keeps its current shape: when `pkg.initiative.bindings === undefined` it passes
`undefined` bindings to `CreateGraph`; otherwise it calls
`resolveGraphBindings` and returns `{ exitCode: 1, stdout: [], stderr: errors }`
on `ok: false`. This is a pure extraction — no existing test may change.

### B. New file `src/apps/cli/setup/run-setup.ts`

```ts
/**
 * Minimal structural surface of EPIC 014's `RepositoryProbe`
 * (`src/repository-probe/port.ts`). Declared locally rather than imported so
 * this `apps/` module honors the architecture boundary: `apps/` may depend on
 * `app/` only, never a capability port. `GitRepositoryProbe` stays structurally
 * assignable, so `composition.ts` can pass it straight through. Mirrors the
 * `CliWorkspaceManager` pattern at `src/apps/cli/deps.ts:63-78`.
 *
 * `auth` is the app-layer `RepositoryAuthValue` from `setup-plan.ts`, which is
 * structurally identical to the domain `RepositoryAuth` the port declares.
 * `detail` arrives already redacted and single-line from the 014 adapter, and
 * the probe never throws — a timeout is a `failed` result.
 */
export interface CliRepositoryProbe {
  probe(input: {
    remoteUrl: string;
    branch: string;
    auth: RepositoryAuthValue;
  }): Promise<{ status: "ok" | "failed"; detail: string }>;
}

export interface RunSetupArgs {
  answersPath?: string;
  nonInteractive: boolean;
}

export interface RunSetupDeps {
  observeSetupFacts: ObserveSetupFacts;
  createProject: CreateProject;
  addResource: AddResource;
  registerAiProvider: RegisterAiProvider;
  assignAiProvider: AssignAiProvider;
  login: { loginProvider: LoginProvider; io: LoginIO };
  createGraph: CreateGraph;
  /** EPIC 014 `CheckProject`. */
  checkProject: CheckProject;
  /** EPIC 014 `repositoryProbe` (`GitRepositoryProbe`). */
  repositoryProbe: CliRepositoryProbe;
  /**
   * EPIC 014 `providerProbe` (`ProbeAiProvider`). Reused instead of
   * `TestAiProvider` directly: it never throws, it applies 014's `makeRedactor`
   * to the failure detail, and it owns the fixed `PROVIDER_PROBE_PROMPT`. Setup
   * therefore hand-rolls neither a prompt constant nor secret scrubbing.
   */
  providerProbe: {
    execute(providerId: string): Promise<{
      resourceId: string;
      status: "ok" | "failed";
      detail: string;
    }>;
  };
  newId: () => string;
  readTextFile: (path: string) => Promise<string>;
  readSecretFile: (path: string) => Promise<string>;
  readGraphPackage: (dir: string) => Promise<GraphPackage>;
  findResourcesByName: ImportGraphDeps["findResourcesByName"];
  getResource: ImportGraphDeps["getResource"];
  prompt?: SetupPrompt; // Story 5
  stdinIsTty: boolean; // Story 5
}

export async function runSetup(
  args: RunSetupArgs,
  deps: RunSetupDeps,
): Promise<HandlerResult>;
```

Every dep is **required** except `prompt`. No dep has a default and none is a
bare method reference — the leaf passes arrow wrappers.

`runSetup` body, in this exact order:

1. **Read + validate answers.** `text = await deps.readTextFile(args.answersPath)`;
   `baseDir = dirname(resolve(args.answersPath))`;
   `parseSetupAnswers(text, baseDir)`. On `ok: false` return
   `{ exitCode: 1, stdout: [], stderr: errors }` — **before any write**. Wrap the
   read in `try`/`catch` and on failure return
   `error: cannot read answers file: <path>` (the OS message is not appended).
   Story 5 owns the interactive merge that happens before this validation.
2. **Observe.** `facts = deps.observeSetupFacts.execute({ projectName, repositoryName, providerName, credentialName? })`
   where `credentialName` is supplied only when `answers.credential !== undefined`.
3. **Plan.** `plan = planSetup(facts, answers)`.
4. **Abort on drift or ambiguity, before executing anything.** Walk
   `["project", "credential", "repository", "provider"]` in that order; for the
   first outcome whose `kind` is `"drift"` or `"ambiguous"`, return
   `{ exitCode: 1, stdout: [], stderr: formatDriftReport(...) | formatAmbiguousReport(...) }`
   with `ctx = { projectId: facts.projectsByName[0]?.id ?? "", packagePath: answers.graph.skip ? undefined : answers.graph.packagePath }`.
   This is what makes Phase I mutate nothing.
5. **Execute the steps in this fixed order: `project` → `credential` →
   `repository` → `provider` → `graph`.** Each step appends exactly one summary
   line to `stdout`. On any step failure, return `exitCode: 1` immediately with
   the lines produced so far on `stdout` and the failure on `stderr` — earlier
   steps stay applied.

   - **project.** `create` → `projectId = await deps.createProject.execute({ name })`,
     line `project: created <projectId>`. `skip` →
     `projectId = facts.projectsByName[0].id`, line
     `project: already satisfied (<projectId>)`.
   - **credential** (only when `plan.credential !== undefined`). `create` →
     `value = await deps.readSecretFile(answers.credential.valueFile)` then
     `credentialId = await deps.addResource.execute({ type: "credential", projectId, name, provider, value })`,
     line `credential: created <credentialId>`. `skip` →
     `credentialId = facts.credentialsByName[0].id`, line
     `credential: already satisfied (<credentialId>)`. `value` is held in a local
     and never logged, never put in a line, never re-thrown.
   - **repository.** `skip` → `repositoryId = facts.repositoriesByName[0].id`,
     line `repository: already satisfied (<repositoryId>)`, **and no probe runs**.
     `create` →
     1. `auth: RepositoryAuthValue` = `{ kind: "https-token", credentialId }` when
        `answers.repository.auth === "https-token"`, else `{ kind: answers.repository.auth }`.
        It is built **before** the probe because the probe needs it to resolve a
        token for a private remote.
     2. `probe = await deps.repositoryProbe.probe({ remoteUrl, branch, auth })`.
        On `probe.status === "failed"` → stderr **one** line
        `error: repository: remote probe failed: <probe.detail>` and return
        `exitCode: 1` **without calling `addResource`** — the unreachable
        repository is never recorded. There is only one failure arm: 014's
        `RepositoryProbeResult` carries `status` + an already-redacted `detail`
        and does **not** discriminate "unreachable" from "branch missing"; the
        branch case is conveyed by 014's detail text
        `branch "<branch>" not found on remote`. Do not add a second arm and do
        not re-derive the reason by parsing `detail`.
        The probe owns its own bound (`REPOSITORY_PROBE_TIMEOUT_MS = 10_000`), so
        setup passes no timeout and adds no race.
     3. `repositoryId = await deps.addResource.execute({ type: "repository", projectId, name, remoteUrl, branch, path, auth })`.
        `path` is already absolute, so `AddResource`'s `homedir()` derivation
        (`src/app/resource/add-resource.ts:56,60`) is never reached.
     4. line `repository: created <repositoryId>`.
   - **provider.** `skip` → line
     `provider: already satisfied (<facts.providersByName[0].id>)`, and **no
     registration, no assignment, no verification call**. `create` →
     1. `observed = facts.providersByName[0]`;
        `needsRegister = observed === undefined || observed.state === "logged_out"`;
        `needsAssign = observed === undefined || !observed.assignedToProject`.
     2. register, only when `needsRegister`, by route:
        - `oauth` → `providerId = await deps.login.loginProvider.execute({ providerId: answers.provider.provider, name, method: answers.provider.oauthMethod, model, presenter: <presenter built over deps.login.io> })`.
          Setup never reads, stores, serialises or logs the token or device code:
          it passes the presenter through and keeps only the returned id.
        - `apiKey` → `value = await deps.readSecretFile(answers.provider.valueFile)`;
          `providerId = deps.registerAiProvider.execute({ name, provider, model, value })`
          (synchronous).
        - `custom` → `value = await deps.readSecretFile(answers.provider.valueFile)`;
          `providerId = deps.registerAiProvider.execute({ name, provider: answers.provider.provider, customProviderId: answers.provider.provider, model, value, baseUrl, api })`.
          Then line `provider: created <providerId>`.
          When `needsRegister` is false, `providerId = observed.id` and the line is
          `provider: registered already (<providerId>)`.
     3. assign, only when `needsAssign`:
        `deps.assignAiProvider.execute({ projectId, providerId })` (synchronous,
        `void`, appends at `maxRank+1`). Append ` — assigned` to the provider line.
     4. verify, only when `needsRegister` **and** `answers.provider.route !== "oauth"`:
        - `outcome = await deps.providerProbe.execute(providerId)`, raced against
          a 60_000 ms timer. `ProbeAiProvider` never throws, so the only rejection
          arm is the timeout; on timeout synthesise
          `{ status: "failed", detail: "provider verification timed out after 60000ms" }`.
        - **Pass iff `outcome.status === "ok"`. The model's reply text is never
          inspected** — 014's probe deliberately keeps it out of `detail`, and the
          hermetic `KANTHORD_FAKE_AGENT` seam serves a tool-call turn first, so no
          `text_delta` is emitted and the underlying call resolves with the empty
          string (`src/agent-runner/pi-provider-probe.ts:44-55`,
          `src/agent-runner/fake-session.ts:57-65`).
        - `status === "failed"` → stderr, two lines:
          `error: provider: verification failed: <outcome.detail>` and
          `provider <providerId> is registered but unverified; fix the credential and rerun setup`,
          then `exitCode: 1`. `detail` is already redacted and single-line by
          014's `makeRedactor` seam — **do not scrub, truncate or re-redact it
          here**, and do not read the secret back to do so.
        - Success → append ` — verified` to the provider line.
        - For route `oauth` no probe call is made: the successful login is the
          verification, and no `confirmCost` consent exists for that route.
        - The prompt is 014's `PROVIDER_PROBE_PROMPT`, owned by
          `ProbeAiProvider`. Setup declares no prompt constant of its own.
   - **graph.** With `plan.graph` computed here, not in step 3:
     - `answers.graph.skip === true` → `graphOutcome = planGraph(facts.initiatives, answers, undefined)`,
       line `graph: already satisfied (graph.skip=true)`.
     - otherwise
       1. `pkg = await deps.readGraphPackage(answers.graph.packagePath)` inside
          `try`/`catch`; on any rejection return stderr
          `error: graph: cannot read package directory: <packagePath>` and
          `exitCode: 1`. This is the only guard — `readGraphPackageDir` throws a
          raw `ENOENT` (`src/apps/cli/import-graph.ts:373` has no `catch`).
       2. `graphOutcome = planGraph(facts.initiatives, answers, pkg.initiative.name)`.
          `drift` / `ambiguous` → return the Story 3 report, `exitCode: 1`,
          **without importing anything**.
       3. `skip` → line `graph: already satisfied (<reason>)`.
       4. `create` →
          `resolved = await resolveGraphBindings(pkg.initiative.bindings ?? {}, answers.graph.bind, projectId, { findResourcesByName: deps.findResourcesByName, getResource: deps.getResource })`;
          `ok: false` → stderr = its errors, `exitCode: 1`. Then
          `result = await deps.createGraph.execute({ pkg, projectId, packageId: deps.newId(), bindings: resolved.bindings })`
          and line `graph: created initiative <result.initiativeId>`.
       5. **Do not write anything back into the package directory** — no ULID
          write-back into the source files, no `.kanthord-export.json`. The Proof
          imports the same `$GRAPH` twice (Phase F, then Phase J against a fresh
          database) and `CreateGraph` rejects a package that already carries ids
          (`CreateModeIdError`, `src/app/graph/create-graph.ts:95-111`).

6. Return `{ exitCode: 0, stdout: <the five lines>, stderr: [] }`. Story 5
   appends the closing block.

`runSetup` emits **no events** and starts **no daemon**: it calls only the use
cases listed in `RunSetupDeps` and never `buildDaemon`.

### C. Wire it — `src/composition.ts`

EPIC 014 already constructs and exposes everything the coordinator needs:
`repositoryProbe` (`GitRepositoryProbe`, 014 story 4), `providerProbe`
(`ProbeAiProvider`, 014 story 5) and `checkProject` (`CheckProject`, 014
story 6), each already a key in the `buildDeps` bundle and on `CliDeps`. This
story adds **no** new composition entry for them — the leaf reads them off
`deps` (Story 5). **Write no `git` invocation and no second probe in this epic.**

## Constraints

- Nothing under `src/app/` may import `src/apps/cli/credential-input.ts`;
  `run-setup.ts` does not import it either — the leaf injects
  `readSecretFile` (Story 5). `eslint.config.js` already fails the former.
- No use case calls another use case. `runSetup` is the only coordinator and it
  lives in `src/apps/cli/`.
- Secret values live only in a local `const` passed straight into
  `addResource` / `registerAiProvider`. They never reach `stdout`, `stderr`, a
  returned structure, or an error message.
- The step order is fixed: `project` → `credential` → `repository` → `provider`
  → `graph`. `credential` precedes `repository` because
  `auth.credentialId` must exist first.
- Probe on create only; verify on create-or-reactivate only. A no-op rerun makes
  zero `repositoryProbe.probe` calls and zero `providerProbe.execute` calls.
- `run-setup.ts` imports no capability port and no `src/domain/` module. The two
  014 seams are structural mirrors (`CliRepositoryProbe`, the inline
  `providerProbe` shape) and `RepositoryAuthValue` comes from the app layer.
  `CheckProject` is an app-layer class, so it is imported directly.
- Return `HandlerResult`; never throw. A new error class would otherwise escape
  `src/apps/cli/error-map.ts:68-123`.
- The extraction in part A must not change any existing `import-graph` message or
  exit code.

## Verify

`src/apps/cli/import-graph.test.ts` (extend):

- `resolveGraphBindings` resolves a ULID-shaped value directly, resolves a name
  through `findResourcesByName`, errors on a missing mapping, on an unknown
  name, on an ambiguous name, on a not-found id, and on an incompatible type —
  each message byte-identical to today's.
- the existing `import graph --create` tests still pass unchanged (regression
  guard for the extraction).

`src/apps/cli/setup/run-setup.test.ts` — all deps are inline fakes; no real
sqlite, no git, no network:

- **happy first run**: every step reports `created`; `stdout` has exactly five
  step lines in the order `project`, `credential`, `repository`, `provider`,
  `graph`; `exitCode === 0`.
- **rerun**: with facts describing an existing equivalent project, credential,
  repository, assigned active provider and matching initiative, `stdout` has
  five lines each matching `/^<object>: already satisfied/`, `exitCode === 0`,
  and the fake `createProject`, `addResource`, `registerAiProvider`,
  `assignAiProvider`, `createGraph`, `repositoryProbe.probe`,
  `providerProbe.execute` all record **zero** calls.
- **drift aborts first**: repository `remoteUrl` drift yields `exitCode 1`,
  stderr containing `drift`, and zero calls on every write fake **and** zero
  calls on `repositoryProbe.probe` and `readGraphPackage`.
- **ambiguous project** yields `exitCode 1` and zero write calls.
- **preflight failure writes nothing**: an answers text missing
  `repository.branch` yields `exitCode 1` and zero calls on `observeSetupFacts`
  as well as every write fake.
- **probe failure**: `repositoryProbe.probe` returns
  `{ status: "failed", detail: "…does-not-exist.git' does not appear to be a git repository" }`
  → `exitCode 1`, stderr exactly one line matching
  `/^error: repository: remote probe failed: /` and containing the detail
  verbatim, `createProject` called once, `addResource` called **once** (the
  credential) and never with `type: "repository"`.
- **branch-missing detail passes through unchanged**: a `failed` result whose
  detail is `branch "nope" not found on remote` produces stderr containing that
  exact substring — proving setup does not parse or rewrite 014's detail.
- **probe receives the auth value**: the recorded probe input deep-equals
  `{ remoteUrl, branch, auth: { kind: "https-token", credentialId: <credential step id> } }`,
  and for an `ambient` answer set `auth` is `{ kind: "ambient" }`. Assert the
  probe input carries **no** `timeoutMs` key.
- **repository auth**: an `https-token` run calls `addResource` with
  `auth` deep-equal `{ kind: "https-token", credentialId: <the id returned by the credential step> }`;
  an `ambient` run passes `{ kind: "ambient" }`, makes no credential call, and
  the plan's `credential` slot is `undefined`.
- **absolute path**: the `addResource` repository call receives
  `answers.repository.path` verbatim and it is absolute.
- **provider verification runs on create**: `providerProbe.execute` called
  exactly once, with the newly registered provider id as its only argument.
  Setup passes no prompt — the prompt belongs to `ProbeAiProvider`.
- **verification passes on `status: "ok"`**: a fake `providerProbe` resolving
  `{ resourceId, status: "ok", detail: "provider answered the probe prompt" }`
  yields `exitCode 0` and a provider line ending ` — verified`.
- **verification failure**: a fake resolving
  `{ resourceId, status: "failed", detail: "401 unauthorized" }` (resolving, not
  throwing — the probe never throws) yields `exitCode 1`, stderr matching
  `/registered but unverified/`, a first stderr line containing `401 unauthorized`
  verbatim, and the provider line still present on stdout.
- **detail is not re-redacted**: a `failed` detail containing `[redacted]`
  reaches stderr byte-identical.
- **verification does not re-run**: facts with an equivalent assigned active
  provider → `providerProbe.execute` call count `0`.
- **reactivation re-verifies**: facts with an equivalent assigned provider whose
  `state === "logged_out"` → `registerAiProvider` called once and
  `providerProbe.execute` called once.
- **oauth route**: `loginProvider.execute` called once with the answers' `method`
  and `model`; `registerAiProvider` and `providerProbe.execute` call counts are `0`; no
  stdout or stderr line contains any string returned by the fake presenter.
- **custom route**: `registerAiProvider` receives `api`, `baseUrl` and
  `customProviderId === answers.provider.provider`.
- **assignment only when needed**: facts with an equivalent active provider that
  is **not** assigned → `assignAiProvider` called once, `registerAiProvider`
  call count `0`, `providerProbe.execute` call count `0`.
- **graph skip**: `answers.graph.skip === true` → `readGraphPackage` call count
  `0`, `createGraph` call count `0`, line `graph: already satisfied (graph.skip=true)`.
- **graph package unreadable**: a rejecting `readGraphPackage` → `exitCode 1`,
  stderr matching `/cannot read package directory/`, and the four earlier steps'
  lines present on stdout with their write fakes called (the Phase J shape).
- **graph does not mutate the package**: the fake `readGraphPackage` returns a
  frozen package object and the test asserts no write function is injected at
  all — `RunSetupDeps` has no writer, which is the structural guarantee.
- **graph bindings**: `createGraph` receives `bindings` deep-equal
  `{ source: <resolved repository id> }` and a `packageId` equal to the fake
  `newId` return.
- **graph drift**: initiatives `[{id, name:"Other"}]` with a package initiative
  `"TODO application API"` → `exitCode 1`, stderr containing
  `graph.packagePath`, `createGraph` call count `0`.
- **no secret anywhere**: with `readSecretFile` returning
  `"super-secret-value"`, `JSON.stringify(result)` does not contain it, in the
  happy run and in each of the failure runs above (verification failure whose
  rejection message embeds the secret, unreachable remote, graph failure).
- **no events, no daemon**: `RunSetupDeps` has no event-writer and no
  `buildDaemon`; assert `Object.keys(deps)` used by the module contains neither
  (a structural `readFileSync` assertion on `run-setup.ts` that it does not
  contain `buildDaemon` is acceptable, mirroring
  `src/apps/cli/architecture.test.ts:57-65`).
- `node --test src/apps/cli/setup/run-setup.test.ts src/apps/cli/import-graph.test.ts`
- `npm run verify` exits 0.
- Proof: Phase E (unreachable remote rejected, not recorded), Phase G (no
  `task.started` / `agent.started` event, all tasks `pending`), Phase H (an
  identical rerun writes nothing and reports all five steps satisfied), Phase I
  (drift mutates nothing), Phase J (a failed graph step resumes without
  duplicating earlier steps). Phase F's credential/graph assertions are
  delivered here; its closing-output assertions belong to Story 5.
