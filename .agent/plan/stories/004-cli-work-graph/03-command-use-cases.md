# Story 03 — Command use cases (project / initiative / objective)

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

Full domain-path `create` + `rename` for Project, Initiative, Objective through
CLI → use case → repo → SQLite. Each create validates its parent reference via
`resolveKind` (unknown/wrong-type → named errors) and prints the new ULID as
sole stdout. (Task create is story 05.)

## Acceptance Criteria

- Use cases, one file each (verb-first): `app/project/create-project.ts`
  (`CreateProject`), `rename-project.ts`; `app/initiative/create-initiative.ts`,
  `rename-initiative.ts`; `app/objective/create-objective.ts`,
  `rename-objective.ts`.
- `CreateInitiative.execute({ projectId, name })` calls `resolveKind(projectId)`
  → `undefined` throws `UnknownReferenceError{kind:'project'}`; a non-project
  kind throws `WrongTypeReferenceError{expected:'project'}`; then persists
  `newInitiative(projectId, name)`, returns its id.
- `CreateObjective.execute({ initiativeId, name })` — same shape against an
  initiative.
- `rename-*` load by id (missing → `UnknownReferenceError`), set `name`, save.
  No other mutation.
- Duplicate name in the same parent scope → `DuplicateNameError` (project names
  unique globally; initiative unique per project; objective unique per
  initiative).
- Handlers `runCreateProject` / … return `{ exitCode: 0, stdout: [<ulid>],
  stderr: ["<kind> created: <name>"] }` on success; a known error → exit 1 +
  one line via `toResult`.

## Constraints

- Use cases import `domain/` + storage port types (`import type`) + `app/errors`
  only; never an adapter. Wiring in `main.ts`.
- Aggregate-owned repos (per `AGENTS.md`): objectives persist through
  `InitiativeRepository`, not a new repo. Add the methods from the storage
  capability map.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — storage: name/list methods for project/initiative/objective

**Requires:** EPIC 003 (`ProjectRepository`, `InitiativeRepository`, schema).

**Input:** `src/storage/port.ts`, `src/storage/sqlite/*repository.ts` + tests.

**Action — RED:** temp-DB tests: `saveObjective`/`getObjective` round-trips;
`resolveProjectByName`/`resolveInitiativeByName`/`resolveObjectiveByName`
return `[id]` for a unique name, `[]` for none, and the scope is respected
(same name in two projects does not collide). Fails today: methods absent.

**Action — GREEN:** add the methods + any missing unique index used to detect
duplicates.

**Action — REFACTOR:** none.

**Output:** the two repos expose objective persistence + scoped `resolve*ByName`
per the capability map.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — CreateProject / RenameProject + handlers

**Requires:** T1; S01-T1; S02 (errors, `toResult`).

**Input:** `app/project/create-project.ts`, `rename-project.ts` (+ tests);
`src/apps/cli/project.ts` (+ test).

**Action — RED:** hermetic use-case tests with a fake `ProjectRepository`:
create returns a ULID + persists; duplicate name → `DuplicateNameError`; rename
of a missing id → `UnknownReferenceError`. Handler test: `runCreateProject` →
`{ exitCode: 0, stdout: [ulid], stderr: [msg] }`; duplicate → exit 1 one line.
Fails today: modules absent.

**Action — GREEN:** implement the two use cases + handlers; register
`create project` / `rename project` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `create project --name` prints a ULID; `rename project --id --name`
renames; duplicates/unknowns → one-line error.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — Initiative / Objective create + rename + handlers

**Requires:** T1, T2; S02-T3 (`resolveKind`).

**Input:** `app/initiative/*.ts`, `app/objective/*.ts` (+ tests);
`src/apps/cli/initiative.ts`, `objective.ts` (+ tests).

**Action — RED:** use-case tests with fakes: create verifies its parent via
`resolveKind` (unknown → `UnknownReferenceError`; a project id passed as
`--initiative` → `WrongTypeReferenceError`); persists; returns the ULID.
Handler tests assert the `{exitCode,stdout,stderr}` contract for success and
both reference errors. Fails today: modules absent.

**Action — GREEN:** implement the create/rename use cases + handlers; register
`create initiative` / `create objective` / `rename initiative` /
`rename objective` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `create initiative --project --name`, `create objective
--initiative --name`, and the renames run end to end with reference validation.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
