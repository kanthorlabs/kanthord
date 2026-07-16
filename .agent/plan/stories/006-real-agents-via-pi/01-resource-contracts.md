# Story 01 — Resource contract amendments (Repository / Credential / AIProvider)

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

The three resource shapes this epic's Proof needs exist through domain, use
case, and CLI: `Repository { organization, branch, path }` (local-home model,
D1), `Credential { provider, value }` (stored secret, D0), `AIProvider
{ provider, model, baseUrl? }` (connection properties, D0).

## Acceptance Criteria

- `src/domain/resource.ts` (supersedes EPIC 002 S002 — annotated there):
  - `Repository`: `{ organization: string; branch: string; path: string }`.
  - `Credential`: `{ provider: string; value: string }` (replaces
    `secretRef`).
  - `AIProvider`: `{ provider: string; model: string; baseUrl?: string }`.
  - Guards unchanged in behavior; field names stay verbatim contract names.
- `AddResource` builds the amended variants; for `repository` it defaults a
  missing `path` to `~/.kanthord/repos/<organization>/<name>` and
  expands/normalizes any `path` to absolute before persisting.
- CLI flag map (`src/apps/cli/resource.ts`):
  - `create repository` → `--organization --branch [--path]` (path
    defaulted).
  - `create credential`  → `--provider --value`.
  - `create ai-provider` → `--provider --model [--base-url]`.
  - Missing required flag → `MissingFlagError{flag}`, exit 1
    `error: missing required flag --<flag>`.

## Constraints

- Pure domain types + guards (no behavior); path expansion/normalization is
  use-case logic (`AddResource`), not domain.
- Vendor fields keep serializing to the `resources.attributes` JSON column
  (EPIC 003 schema) — no new columns.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — domain variant amendments

**Requires:** EPIC 002 S002-T1.

**Input:** `src/domain/resource.ts` (+ existing test).

**Action — RED:** update the variant-literal tests: a Repository literal now
carries `organization`/`branch`/`path` (compile-time proof); a Credential
carries `provider`/`value` and no `secretRef`; an AIProvider without
`baseUrl` and one with it both typecheck; the guard matrix still passes.
Fails today: fields differ.

**Action — GREEN:** amend the three interfaces.

**Action — REFACTOR:** none.

**Output:** the amended `Resource` union, guards intact.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — AddResource + CLI flag map

**Requires:** T1; EPIC 004 S04-T2/T3.

**Input:** `src/app/resource/add-resource.ts`, `src/apps/cli/resource.ts`
(+ tests).

**Action — RED:** tests: (a) `create repository --organization kanthorlabs
--branch main` (no `--path`) → exit 0, ULID; the persisted `path` is the
expanded absolute default `~/.kanthord/repos/kanthorlabs/<name>`;
(b) an explicit relative `--path ./x` persists absolute; (c) `create
credential --provider openai --value sk-test` → exit 0, ULID, `value`
round-trips via `attributes`; omitting `--value` → exit 1
`error: missing required flag --value`; (d) `create ai-provider --provider
openai --model gpt-5.5` with and without `--base-url` → exit 0; (e) each
type with one required flag omitted names the flag. Fails today: flags/
defaulting absent.

**Action — GREEN:** amend the per-type builders + flag tables; implement the
path default + normalization in `AddResource`.

**Action — REFACTOR:** none.

**Output:** the Proof's three `create` lines work verbatim.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
