# Story 04 — Typed resource commands

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

`create repository|credential|notification|ai-provider|filesystem` with the
per-type required flags from the locked Resource union, persisted under the
Project aggregate. A missing required flag names the flag; the new resource's
ULID is the sole stdout.

## Acceptance Criteria

- Per-type flags (verbatim field names; all also take `--project --name`):
  - `create repository`  → `--organization --branch`
  - `create credential`  → `--provider --secret-ref`
  - `create notification`→ `--provider` (slack|telegram) `--destination`
  - `create ai-provider` → `--provider --model`
  - `create filesystem`  → `--path`
- One use case `app/resource/add-resource.ts` (`AddResource`) taking a
  discriminated input; builds the matching domain Resource variant (EPIC 002
  guards); verifies `--project` via `resolveKind`
  (unknown/`WrongTypeReferenceError`); resource `name` unique per project →
  `DuplicateNameError`.
- A missing required flag for the chosen type → `MissingFlagError{flag}` →
  exit 1 `error: missing required flag --<flag>`. `notification --provider`
  outside {slack,telegram} → one-line validation error.
- Success → `{ exitCode: 0, stdout: [ulid], stderr: ["<type> resource added:
  <name>"] }`.

## Constraints

- Resources persist through `ProjectRepository` (aggregate-owned), vendor
  fields serialized to the `resources.attributes` JSON column (EPIC 003
  schema) — no per-vendor columns, no new repo.
- The per-type flag tables live in ONE grep-able map in
  `src/apps/cli/resource.ts`.
- Domain Resource variants + guards already exist (EPIC 002 S002); this story
  builds no new domain shape — only construction in the use case.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — storage: resource persistence on ProjectRepository

**Requires:** EPIC 003 (`resources` table with `attributes` JSON); S02-T3.

**Input:** `src/storage/port.ts`, `src/storage/sqlite/project-repository.ts`
(+ test).

**Action — RED:** temp-DB tests: `saveResource`/`getResource` round-trips each
of the five variants (all vendor fields survive via `attributes`);
`listResources(projectId)` returns a project's resources;
`resolveResourceByName(projectId, name)` is project-scoped. Fails today:
methods absent.

**Action — GREEN:** implement the resource methods on `ProjectRepository`,
serializing/deserializing the variant vendor fields to/from `attributes`.

**Action — REFACTOR:** none.

**Output:** `ProjectRepository` round-trips all five resource variants on a
temp DB.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — AddResource use case

**Requires:** T1; S02 (errors, `resolveKind`); S03-T2 (a project to attach to).

**Input:** `src/app/resource/add-resource.ts` (+ test).

**Action — RED:** hermetic tests with fakes: each variant persists + returns a
ULID; unknown `--project` → `UnknownReferenceError`; an initiative id as
`--project` → `WrongTypeReferenceError`; duplicate name in project →
`DuplicateNameError`. Fails today: module absent.

**Action — GREEN:** implement `AddResource` with a per-type builder switching
on the resource-type discriminant.

**Action — REFACTOR:** none.

**Output:** `AddResource` builds + persists any variant with parent +
uniqueness validation.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — CLI `create <resource-type>` handlers

**Requires:** T2; S01; S02.

**Input:** `src/apps/cli/resource.ts` (+ test).

**Action — RED:** handler tests per type: valid flags → `{ exitCode: 0,
stdout: [ulid] }`; each type with one required flag omitted → exit 1
`error: missing required flag --<flag>`; `create notification --provider foo`
→ one-line error. Fails today: module absent.

**Action — GREEN:** implement the per-type flag map + `parseArgs` validation →
`AddResource`; register the five `create <type>` commands in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `create <resource-type> …` works for all five types with named
missing-flag errors.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
