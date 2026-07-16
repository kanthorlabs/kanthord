# Story 002 - resource union

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

`src/domain/resource.ts` holds `ResourceType` and the discriminated union the
later resolver ports switch on, with one type guard per variant. Variant
fields come verbatim from the canonical model (story 003 carries the full
reference; this story implements the Resource branch).

## Acceptance Criteria

- `RESOURCE_TYPES` lists exactly: `repository`, `credential`, `notification`,
  `ai_provider`, `filesystem`; `ResourceType` is the union of those literals.
- `Resource` is a discriminated union on `type`. Base fields
  `{ id, type, name }` plus the vendor fields per variant:
  - `Repository`: `organization: string`, `branch: string`, `path: string`
  - `Credential`: `provider: string`, `value: string`
  - `Notification`: `provider: 'slack' | 'telegram'`, `destination: string`
  - `AIProvider`: `provider: string`, `model: string`, `baseUrl?: string`
  - `Filesystem`: `path: string`

  (Superseded by EPIC 006 D0/D1 — Ulrich, 2026-07-16, debate-reviewed.
  Originally: `Repository { organization, branch }` — gained `path`, the
  repo's local home; `Credential { provider, secretRef }` — `secretRef`
  (env-var name) replaced by `value` (the stored secret: API key or OAuth
  JSON), because OAuth tokens force storage; `AIProvider { provider,
  model }` — gained `baseUrl?` for OpenAI-compatible endpoints. See
  `.agent/plan/stories/006-real-agents-via-pi/01-resource-contracts.md`.)
- One guard per variant (`isRepository(r)`, …) that narrows and returns true
  only for its own variant. No constructors — instances are built by later
  epics' use cases.

## Constraints

- Pure types + guards. No behavior, no I/O, imports only `./entity.ts`.
- Field names are verbatim contract names — no abbreviations, no renames.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - discriminated union + guards

**Requires:** S001-T1 (`Entity` base — every variant extends it).

**Input:** `src/domain/resource.ts` (new), `src/domain/resource.test.ts`
(new); consumes `Entity` from `./entity.ts`.

**Action - RED:** test builds one literal object per variant (with the
vendor fields above) and asserts: (a) `RESOURCE_TYPES` deep-equals the five
literals above in that order; (b) each guard returns true for its own variant
and false for the other four; (c) after a guard narrows, the variant's vendor
fields are readable (compile-time proof — the test file must typecheck).
Fails today: the module does not exist.

**Action - GREEN:** implement `ResourceType`, the five variant interfaces,
the `Resource` union, and the five guards.

**Action - REFACTOR:** none.

**Output:** `src/domain/resource.ts` exports `RESOURCE_TYPES`,
`ResourceType`, `Resource` (union of `Repository | Credential | Notification
| AIProvider | Filesystem` with the fields above), and the five type guards.

**Verify:** `npm test` green (guard matrix passes); `npm run typecheck`
exit 0.
