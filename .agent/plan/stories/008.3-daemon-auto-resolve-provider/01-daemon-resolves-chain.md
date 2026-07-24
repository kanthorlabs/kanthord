# Story A — Daemon resolves the chain; runner takes a resolved provider

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Depends on: EPIC 008.2 (`resolveProviderChain` / `ResolveProjectChain` / registry).

## Change

- **Provider resolver injected into the daemon** — add a `providerChainFor:
(initiativeId: string) => GlobalAiProvider[]` function to `RunNextTask`
  (`src/app/task/run-next-task.ts`) via `opts` (new optional field, like
  `workspaces`). Build it in `composition.ts` `buildDaemon`:
  `(initiativeId) => { const projectId = initiativeRepository.get(initiativeId)?.projectId; if (!projectId) return []; const assigned = aiProviderRegistry.listAssigned(projectId); const def = aiProviderRegistry.getDefaultId() ? aiProviderRegistry.get(...!) : undefined; return resolveProviderChain(assigned, def); }`.
- **run-next-task uses the chain** — in `execute()`, after `initiativeId =
this.#store.getInitiativeId(taskId)` (:156): `const chain =
this.#providerChainFor?.(initiativeId ?? "") ?? [];`. Pass `chain` into the
  runner (below). (Empty-chain handling is Story B.)
- **Runner takes the resolved provider** — extend `src/agent-runner/port.ts`:
  `AgentRunner.run(task, context, provider?: GlobalAiProvider)` (:59) and
  `AgentRunnerResolver.for(task, context)` unchanged. `RunNextTask` calls
  `runner.run(runningTask, contextBindings, chain[0])` (:201).
- **pi.ts uses `provider` instead of context bindings** —
  `src/agent-runner/pi.ts`: `#doRun` gains the `provider` arg. Replace the
  `credential`/`ai_provider` context lookups (:394-410) with: if `provider`
  given, build `const aiProvider = { type:"ai_provider", id: provider.id, name:
provider.name, provider: provider.provider, model: provider.model, baseUrl:
provider.baseUrl ?? undefined, effort: provider.effort ?? undefined }` and
  `const credential = { type:"credential", id: provider.id, name: provider.name,
provider: provider.provider, value: provider.value }`, then
  `sessions.for(aiProvider, credential)` as today. The `repository`/`filesystem`/
  `workspace` bindings still come from `context` (unchanged).
- **agent.started carries the provider id** — `pi.ts:467`:
  `this.#emit(task.id, "agent.started", { workspace: workspace.dir, providerId:
provider?.id ?? "" });`.
- **Drop provider/credential from binding specs** —
  `src/app/graph/binding-resolver.ts:15-24`: set both `generic@1` and `tdd@1`
  `required` to `["repository"]` only.

## Constraints

- Surgical: keep the `repository`/`filesystem`/`workspace` context resolution in
  `pi.ts` intact; only the provider/credential selection changes.
- The runner still never throws (all failure paths → `{outcome:"failed"}`).
- Redaction (`pi.ts` `redact`) uses `provider.value`.

## Verify

- Extend `src/app/task/run-next-task.test.ts`: inject a fake `providerChainFor`
  returning `[P]`; assert the `FakeRunner.calls` receives `P` as the 3rd arg; a
  task whose `EXECUTOR_BINDING_SPECS` no longer requires ai_provider/credential
  still runs.
- Extend `src/agent-runner/pi.test.ts` (or `pi-session`/agent-smoke tests): with a
  `provider` arg and a fake session factory, the run reaches
  `sessions.for(aiProvider, credential)` built from the provider; no
  ai_provider/credential context binding is needed.
- `src/app/graph/binding-resolver.test.ts`: update the required-set assertions to
  `["repository"]`.
- `npm run verify` exits 0.
- Proof (008.3 Proof block): delivers **PASS A** (import graph succeeds with no
  provider/cred bind) and **PASS B-select** (agent.started `providerId` equals the
  assigned non-default provider) and **PASS B-land** (task runs on the resolved
  chain and lands).
