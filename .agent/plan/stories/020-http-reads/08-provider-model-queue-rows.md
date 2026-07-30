# Story S8 — ai-provider, model and queue rows

Epic: `.agent/plan/epics/020-http-reads.md` (decisions 9, 11)
Depends on: Story S4 (`views/shared.ts`, `optionalQueryString`).

Five rows: the provider registry collection, the provider item, the
project-scoped provider chain, the model catalog, the decision queue.

## Change

### 1. `src/apps/http/views/ai-provider.ts` (new)

`AiProviderView` (`src/app/ai-provider/ai-provider-view.ts:5-14`) is an `app/`
type → `import type` it as the result. Emit exactly its eight fields:
`id`, `name`, `provider`, `model`, `baseUrl`, `effort`, `state`, `isDefault`.
All are non-optional; none is conditional. Export `aiProviderView` and
`AiProviderDtoView` (with the index signature).

### 2. `src/apps/http/views/model.ts` (new)

`list model` has no `app/` use case: `composition.ts:237-247` builds a closure
typed by `src/apps/cli/models.ts:9-15`, and `apps/http` may not import
`apps/cli`. Declare the structural mirror here, with the reason in a comment
(same trick as `src/apps/cli/deps.ts:130-183`):

```ts
/**
 * Structural mirror of ModelInfo (src/apps/cli/models.ts:9-15). apps/http
 * declares its own shape rather than importing another app's module.
 */
export interface ModelInfoResult {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly contextWindow: number;
}

export type ListModels = (provider?: string) => readonly ModelInfoResult[];
```

`modelView(result: ModelInfoResult): ModelDtoView` emits exactly `provider`,
`id`, `name`, `reasoning`, `contextWindow`.

### 3. `src/apps/http/views/queue.ts` (new)

`GetDecisionQueueOutput` (`src/app/project/get-decision-queue.ts:82-92`) is an
`app/` type → `import type`. `DecisionItem` is a `domain/` type
(`src/domain/decision-queue.ts:80-97`) → the item mapper lives here (queue is its
only consumer, so it does NOT go into `shared.ts`).

`decisionItemView` emits exactly, in this order:
`verdicts: item.verdicts.map(actionView)`, `kindLabel`, `cause?` (conditional
spread), `projectId`, `projectName`, `initiativeId`, `objectiveId?`
(conditional), `taskId?` (conditional), `downstream`, `actionableSince`,
`evidence: { basis: e.basis, diffAvailable: e.diffAvailable, inspect:
e.inspect === null ? null : { executable: e.inspect.executable, args: [...e.inspect.args] } }`,
`expectedCommit?` (conditional).

`decisionQueueView(result: GetDecisionQueueOutput): DecisionQueueView` emits
exactly: `items: result.items.map(decisionItemView)`,
`counts: { total: result.counts.total, byKind: { ...result.counts.byKind } }`,
`truncated`, `warnings: [...result.warnings]`.

**`warnings` is part of the response.** The CLI writes them to stderr
(`src/apps/cli/queue.ts:36-40`); HTTP has no stderr, so the field is carried in
the DTO and the UI decides.

### 4. `src/apps/http/deps.ts` — five fields

```ts
  readonly listAiProviders: ListAiProviders;
  readonly getAiProvider: GetAiProvider;
  readonly resolveProjectChain: ResolveProjectChain;
  readonly listModels: ListModels;          // from ./views/model.ts
  readonly getDecisionQueue: GetDecisionQueue;
```

### 5. `src/apps/cli/commands/serve.ts:39` — populate all five

`listModels: deps.listModels` typechecks against the structural `ListModels`
because `CliDeps.listModels` is `(provider?: string) => ModelInfo[]` and
`ModelInfo` is structurally identical to `ModelInfoResult`.

### 6. `src/apps/http/routes.ts` — five rows

| id                         | path                           | decode                                                                                                | run                                                 | present                      |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| `ai-provider.list`         | `/api/ai-provider`             | `() => ({})`                                                                                          | `deps.listAiProviders.execute()`                    | `result.map(aiProviderView)` |
| `ai-provider.get`          | `/api/ai-provider/:id`         | `{ id: requirePathParam(params,"id") }`                                                               | `deps.getAiProvider.execute(input.id)`              | `aiProviderView(result)`     |
| `project.ai-provider.list` | `/api/project/:id/ai-provider` | `{ projectId: requirePathParam(params,"id") }`                                                        | `deps.resolveProjectChain.execute(input.projectId)` | `result.map(aiProviderView)` |
| `model.list`               | `/api/model`                   | `{ ...(provider !== undefined ? { provider } : {}) }` via `optionalQueryString(query,"provider")`     | `deps.listModels(input.provider)`                   | `result.map(modelView)`      |
| `queue.get`                | `/api/queue`                   | `{ ...(limit !== undefined ? { limit } : {}) }` via `optionalQueryInt(query,"limit",{min:1,max:500})` | `deps.getDecisionQueue.execute(input)`              | `decisionQueueView(result)`  |

All five: `method: "GET"`, `successStatus: 200`, `kind: "json"`.
`cliCommands`: `["list ai-provider"]`, `["get ai-provider"]`,
`["list ai-provider"]`, `["list model"]`, `["queue"]`.

## Constraints

- `GetAiProvider.execute` and `ResolveProjectChain.execute` take POSITIONAL
  strings (`src/app/ai-provider/get-ai-provider.ts:15`,
  `resolve-project-chain.ts:23`); `ListAiProviders.execute` takes NO argument
  (`list-ai-providers.ts:14`).
- `list ai-provider` appears in TWO rows' `cliCommands` (registry + chain) —
  intentional, and permitted (no uniqueness assertion).
- `?limit=` bounds are `min: 1, max: 500`. Out of range → `400 invalid_input`
  from the existing `optionalQueryInt`.
- `deps.listModels` is a FUNCTION on `HttpDeps`, not a class with `execute`. Call
  it directly; do not wrap it in an object.

## Verify

- New `src/apps/http/views/ai-provider.test.ts` — leak test: inject a `secret`
  and a `credentialId`; assert the key set is exactly
  `["baseUrl","effort","id","isDefault","model","name","provider","state"]`.
- New `src/apps/http/views/model.test.ts` — key set exactly
  `["contextWindow","id","name","provider","reasoning"]`, injected extra dropped.
- New `src/apps/http/views/queue.test.ts`:
  - `decisionQueueView` top-level key set exactly
    `["counts","items","truncated","warnings"]`; `counts` exactly
    `["byKind","total"]`.
  - `decisionItemView` with every optional field ABSENT — assert `cause`,
    `objectiveId`, `taskId`, `expectedCommit` keys are absent, and `evidence`
    has exactly `["basis","diffAvailable","inspect"]` with `inspect: null`.
  - `decisionItemView` with everything present — full key set; `inspect` has
    exactly `["args","executable"]`; `verdicts[0]` is mapped through
    `actionView` (an injected extra on the action is dropped).
  - an empty queue (`items: []`, `warnings: []`) round-trips as empty arrays.
- New `src/apps/http/routes.provider.test.ts` (supertest + fake deps):
  - `GET /api/ai-provider` → `200`; the fake's `execute` received NO argument
    (record `arguments.length === 0`).
  - `GET /api/ai-provider/a1` → the fake received the string `"a1"`.
  - `GET /api/project/p1/ai-provider` → the fake received the string `"p1"`;
    a fake throwing `UnknownReferenceError("project","p1")` → `404
unknown_reference`.
  - `GET /api/model` → the `listModels` fake received `undefined`;
    `?provider=anthropic` → received `"anthropic"`.
  - `GET /api/queue` → the fake received `{}`; `?limit=5` → `{ limit: 5 }`;
    `?limit=0` and `?limit=501` and `?limit=abc` → `400 invalid_input` with the
    use case NOT called.
- `node --test src/apps/http/views/ai-provider.test.ts src/apps/http/views/model.test.ts src/apps/http/views/queue.test.ts src/apps/http/routes.provider.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase E — the `queue`, `model`,
  `ai-provider` and provider-chain blocks.
