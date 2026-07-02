# Story 004 - Provider Registry

Epic: `.agent/plan/epics/024-real-tdd-workflow-model-policy.md`

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
