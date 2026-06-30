# Story 001 - Confirmed Per-File Migrations

Epic: `.agent/plan/epics/014-versioning-migrations.md`

## Goal
A module can plug migrations into a shared detect -> plan -> confirm -> apply harness that refuses unknown future versions and leaves files unchanged without confirmation or after a throwing migration.

## Acceptance Criteria
- A file below current-supported version is detected as needing migration.
- A file at current-supported version reads normally.
- A file above supported version is refused without read/downgrade/corruption.
- Detect returns a migration plan as data.
- Each plan step carries `stepId`, `fromVersion`, `toVersion`, `mode`, `summary`, and `userAction` for manual steps.
- `mode` is `auto` or `manual`.
- Without explicit confirmation, file content is unchanged and remains at old `version`.
- With confirmation, synthetic v1->v2 migration succeeds and file content is v2 with `version: 2`.
- If migration function throws, the file remains at v1 content and `version`.

## Constraints
- Epic 014 adds the shared harness; module-specific migration logic lives in the module that needs it (B8).
- Apply writes use Epic 002 atomic replace and lock.
- Confirmation is an explicit apply input/callback at machinery level.
- Per-file migration only.
- Confirm gate is mandatory.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 014-RED - Migration harness tests

**Input:** `packages/core/src/**/*.test.ts` or the migration package test home.

**Action - RED:** Add `node:test` coverage for behind/current/future version detection, plan fields and modes, no-confirm unchanged behavior, confirmed v1->v2 apply, and throwing migration leaving v1 intact.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because migration harness is missing.

### Task 014-GREEN - Migration harness

**Input:** `packages/core/src/**` or the migration package source home.

**Action - RED:** none - opened by Task `014-RED`.

**Action - GREEN:** Implement the per-file migration harness and plan/apply behavior so the Story ACs pass.

**Action - REFACTOR:** Keep module migration definitions outside the shared harness.

**Verify:** `npm run typecheck && npm test` exits 0.
