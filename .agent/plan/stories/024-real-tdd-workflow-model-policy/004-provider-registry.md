# Story 004 - Provider Registry

Epic: `.agent/plan/epics/024-real-tdd-workflow-model-policy.md`

> **Reference — the runtime account engine is Epic 019.4; switching is Epic 043.**
> The concrete **multi-account provider engine** — the `ProviderAccount` registry +
> account-keyed credential store with CRUD, the observable device-code login
> operation, the `buildProviderSession({ accountId, modelId })` resolver returning
> `{ model, streamFn }`, the **durable per-task account binding**, and the
> OpenAI-compatible account kind — is built in
> `.agent/plan/epics/019.4-ai-provider-integration.md` (core logic, exercised via the
> CLI). This story is the **policy layer on top of it**: the yaml registry names
> **provider-account candidates** per repo/slot/task and the 5-level precedence chain
> selects among them; a resolved name yields an **account id** the 019.4 engine resolves
> and durably binds. Do not re-author the runtime engine here — reference it. Note the
> vocabulary shift: 019.4 separates **provider kind** from **provider account** (multiple
> accounts of one kind), so this registry references **account ids**, not bare provider
> ids. The **switch** of a running task between accounts (triggers, tier guards,
> notification) is **Epic 043**, which updates 019.4's durable binding — not 019.4 and
> not this registry.

## Goal

Providers register once in daemon yaml (endpoint + credential reference); plans
and the policy chain reference models by name; credentials never appear in
plans or the registry file itself.

## Acceptance Criteria

- A provider registry yaml loads: named providers with endpoint, model list,
  and a **credential reference** into custody config (PRD §8 — registered once;
  plans reference by name, never by credential).
- A registry entry containing a literal credential-shaped value is a load error
  (the Epic 013 scanner reused at config load — one corpus).
- Resolving a model name to its provider + endpoint + credential works for a
  registered model; an unknown model or a provider whose credential reference
  is missing from custody config is a typed error naming the entry.
- The pi-ai session layer (Epic 016) consumes the resolved provider record; the
  session adapter receives endpoint + credential from the daemon side — the
  agent env stays credential-free (Epic 015 invariant re-asserted at this
  seam).

## Constraints

- Mirrors the verb-registry pattern (PRD §8): one yaml entry per provider,
  loaded by the Epic 001 loader.
- OpenAI-compatible custom endpoints are just entries with a different endpoint
  — no special-case code (PRD §8).

## Verification Gate

- `npm test` green for `src/models/provider-registry.test.ts`.

### Task T1 - Registry load + resolution + credential hygiene

**Input:** `src/models/provider-registry.ts`, `src/models/provider-registry.test.ts`

**Action - RED:** Write tests: (a) a valid registry loads and resolves a model
name to provider/endpoint/credential; (b) a literal secret in the yaml ⇒ load
error; (c) unknown model / missing credential ref ⇒ typed error naming the
entry; (d) the session adapter receives the resolved record while the spawn env
remains credential-free.

**Action - GREEN:** Implement the registry + resolution wired to the policy
chain and session adapter.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
