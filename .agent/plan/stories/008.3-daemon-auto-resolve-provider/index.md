# EPIC 008.3 — Daemon auto-resolves the provider chain — stories

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Prereq: EPIC 008.2 (assignment store, `resolveProviderChain`,
`ResolveProjectChain`, `list ai-provider --project`).

The daemon resolves the provider chain per task (`task → initiative → project`)
and runs on the first provider; per-task provider/credential binding is dropped;
the project `ai_provider` type + `create/update ai-provider` are retired; `login`
persists a global provider; builtin API-key providers get runtime session tests;
OAuth refresh write-back becomes a credential-version CAS.

## Dispatch order

1. **01** — daemon resolves chain, runner takes a resolved provider (Story A).
2. **02** — empty chain fails loudly (Story B).
3. **03** — retire project `ai_provider` + migration 18 (Story C).
4. **04** — E2E scripts + docs (Story D).
5. **05** — login cutover to global register (Story E).
6. **06** — builtin provider runtime session support (Story F).
7. **07** — credential-version CAS + running-task contract (Story G).

01+02 are a coupled pair (same runner/resolver edit). 03 must land after 01 (the
daemon must already resolve from the registry before the project type is retired).

## Stories

- A — daemon resolves chain; runner takes resolved provider → `01-daemon-resolves-chain.md`
- B — empty chain fails loudly → `02-no-provider-fails.md`
- C — retire project ai_provider + migration 18 → `03-retire-project-type.md`
- D — E2E scripts + docs → `04-e2e-and-docs.md`
- E — login cutover → `05-login-cutover.md`
- F — builtin provider runtime support → `06-builtin-providers.md`
- G — credential-version CAS + running-task → `07-credential-version-cas.md`

## Facts (needed for implementation)

- **run-next-task** (`src/app/task/run-next-task.ts`): ctor
  `(queue, store, feed, uow, resolver, landing?, opts?)` (:100-113). Reaches
  `initiativeId` via `#store.getInitiativeId(taskId)` (:142,:156) — **no project
  today**. Builds `contextBindings` at :168-171, calls `resolver.for(task,
bindings)` (:196) then `runner.run(task, bindings)` (:201) inside the
  transient-retry loop :199-216 (retries only `failed && transient===true`,
  bounded by `#maxAttempts=3` / `#maxElapsedMs=120_000`).
- **Runner** (`src/agent-runner/pi.ts`): picks provider+credential from `context`
  (`b.type==='credential'|'ai_provider'`, :394-410) via `#getResource`
  (:312,:345 → `projectRepository.getResource`); `sessions.for(aiProvider,
credential)` (:419); a `for()` failure returns `{outcome:"failed"}` **without**
  `transient` (:417-423); emits `agent.started {workspace}` (:467).
- **Runner ports** (`src/agent-runner/port.ts`): `AgentRunner.run(task, context)`
  (:59), `AgentRunnerResolver.for(task, context)` (:63), `TaskContextBinding
{type,resourceId}` (:54), `TaskResult.failed` carries
  `transient?/retryAfterMs?` (:29-34). Resolver `RegistryRunnerResolver.for`
  ignores `context`, keys on `task.agent` (`src/agent-runner/resolver.ts:26-28`).
- **Composition** (`src/composition.ts`): `projectRepository` :151,
  `initiativeRepository` :152 (`Initiative.projectId` at
  `src/domain/initiative.ts:22`; `initiativeRepository.get(id).projectId`),
  `aiProviderRegistry` (008.1), `ResolveProjectChain` (008.2). `buildDaemon`
  :318-413; `saveCredentialValue` :327-336; `PiAgentRunner` :341-350;
  `RegistryRunnerResolver` :352-356; `RunNextTask` :393-404.
- **EXECUTOR_BINDING_SPECS** (`src/app/graph/binding-resolver.ts:15-24`):
  `required: ["repository","ai_provider","credential"]` for `generic@1`/`tdd@1`.
  **Import-time** validation only (consumed by `create-graph.ts:177` via
  `validateExecutorBindings`); not read at runtime.
- **Retire surface**: `RESOURCE_TYPES`/`buildResource ai_provider`/`isAIProvider`
  (`src/domain/resource.ts:4-10,187-213,83-85`); mirrored `ResourceType` +
  `REASONING_EFFORTS` in `src/apps/cli/resource.ts:17-29`; commands
  `commands/create/ai-provider.ts`, `commands/update/ai-provider.ts` + runners
  `resource.ts:208,333` + `UpdateAiProvider` (`src/app/resource/update-ai-provider.ts`);
  `resources` CHECK `migrations.ts:25-32` (rebuild must reproduce migration-7
  columns `remoteUrl,authKind,authCredentialId` at :169-171); `task_context`
  table `migrations.ts:76-84` (`resource_id` no FK).
- **E2E graph aliases**: `provider: ai_provider` / `cred: credential` in
  `scripts/e2e/make-todo-graph.sh:29-30` (+ per-task 55-56 etc.);
  `make-landing-graph.sh` delegates to it; also `make-initiative-graph.sh:47-48`;
  `landing-proof.sh:28` runs `create ai-provider`.
- **login**: `LoginProvider` persists a **credential** resource
  (`src/app/auth/login-provider.ts:74-82`, ctor `{oauth,projects,resolver}`);
  `runLogin` (`src/apps/cli/login.ts`) needs `--project`/`--name`/`--method`;
  OAuth `login()` returns a serialized tagged JSON value (`src/oauth/pi.ts:59`).
  Login has only a provider-kind + token — the cutover adds `--name` (required)
  and `--model` (optional; else interactive post-login select via `LoginIO`).
- **OAuth vs API-key (pi-ai, grounded)**: `getOAuthProvider`
  (`node_modules/@earendil-works/pi-ai/dist/utils/oauth/index.js:23-27`) registers
  OAuth for exactly **`anthropic`, `github-copilot`, `openai-codex`**.
  **`deepseek`, `opencode`, `openrouter`** are `envApiKeyAuth` (API-key only, no
  OAuth) — added via `register ai-provider --value-file` (008.1), never `login`.
  `login` must guard with `oauth.has(providerId)` (`src/oauth/port.ts:31`) and
  reject a non-OAuth provider pointing at `register`.
- **Fake seam**: `KANTHORD_FAKE_AGENT` read in `src/main.ts:35-43`, builds
  `fakeSessionFactoryFromTurns` (`src/agent-runner/fake-session.ts:62-75`, `.for()`
  ignores args), threaded via `buildDeps(...,{sessionFactory})` →
  `composition.ts:338-340`.
- **CAS hook**: `pi-session.ts:157-178` `credentialStore.modify` → `saveFn`
  (`= saveCredentialValue`, `composition.ts:327-336`, `UPDATE resources SET
attributes=?`). The AI credential now lives in `ai_providers.value`, so the CAS
  write-back must target the registry, keyed by provider record id + version.
- **`architecture.test.ts` counters**: after 008.2 they are `58 / 60` no —
  **`60 / 62`**. Story 03 DELETES `create/ai-provider.ts` + `update/ai-provider.ts`
  → set both to **58 / 60**; drop the `["create","ai-provider"]` `MATRIX` row
  (:166) and ADD an `OLD_SPELLINGS` row asserting `["create","ai-provider"]` exits
  non-zero "unknown" (:130-140). No other story changes counters.
- **Migrations**: 008.1=16, 008.2=17, **008.3 Story C = 18** (rebuild `resources`
  CHECK sans `ai_provider` + delete stale `task_context` rows).
- CLI/test conventions: see 008.1 index Facts.
