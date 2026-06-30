# Story 001 - Workspace Cross-Package Import

Epic: `.agent/plan/epics/001-repo-build-skeleton.md`

## Goal
The repo is an npm TypeScript workspace where `apps/daemon` imports and uses a
symbol from `packages/core`, and the root typecheck/test gates prove it.

## Acceptance Criteria
- From the repo root, `npm run typecheck` exits 0 and stays green after the layout change.
- From the repo root, `npm test` exits 0 and stays green after the layout change.
- A symbol exported from `packages/core` is imported and used by `apps/daemon`.
- The `apps/daemon` -> `packages/core` import type-checks and runs under `node:test`.
- The existing `greet` skeleton is moved across this boundary, or the smallest exported stub is added.
- The declared Node engine is `>=24`, matching plan §3 and `Containerfile` (`node:24-slim`).
- `package.json` stays ESM with `"type": "module"`.
- The test harness stays `node --test` with no Jest, Vitest, or test-framework dependency.
- Only `packages/core` and `apps/daemon` are created now.

## Constraints
- No native `.node` modules anywhere in the dependency tree (D2, B1). This epic adds no dependency guard; the guard belongs to the first dependency-adding epic.
- Test harness is `node:test` plus `tsc --noEmit`; do not add Jest/Vitest/etc. (B1).
- Workspace tooling is the engineer's choice. Prefer platform built-ins.
- Bumping the engine to `>=24` also updates stragglers in `package-lock.json`, `.claude/agents/{test,software,reviewer}-engineer.md`, and `.agent/tdd/PROFILE.md`.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 001-RED - Cross-package import test

**Input:** `apps/daemon/src/**/*.test.ts`, `src/**/*.test.ts` if moving an existing test.

**Action - RED:** Write or move the `node:test` coverage so it imports a public `apps/daemon` seam that uses `@kanthord/core`. The test must fail before the workspace import exists.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails for the missing daemon/core workspace seam.

### Task 001-GREEN - Workspace layout and import

**Input:** `package.json`, `package-lock.json`, `tsconfig.json`, `src/**`, `packages/core/**`, `apps/daemon/**`, `.claude/agents/*.md`, `.agent/tdd/PROFILE.md`.

**Action - RED:** none - opened by Task `001-RED`.

**Action - GREEN:** Create the npm workspace layout, move or expose the `greet` symbol from `packages/core`, make `apps/daemon` import it, keep ESM and `node:test`, and align Node engine text to `>=24`.

**Action - REFACTOR:** Remove the old flat `src` skeleton only after equivalent workspace coverage exists.

**Verify:** `npm run typecheck && npm test` exits 0.
