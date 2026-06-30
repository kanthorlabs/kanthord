# Story 001 - Default Allow Denylist

Epic: `.agent/plan/epics/007-security-seam-canrun.md`

## Goal
`canRun` returns allow by default and denies a small set of literal dangerous tool inputs.

## Acceptance Criteria
- `canRun` returns `allow` by default for an ordinary call.
- A shell tool given `rm -rf /` returns `deny`.
- A filesystem-read tool given a path under `~/.ssh` returns `deny`.
- A filesystem-read tool given a path under `~/.aws` returns `deny`.
- Given a denylist with a new rule, a matching call denies without call-site change.

## Constraints
- Exactly one policy entrypoint is exported for later tool routing (D4, B3).
- `canRun` is pure and synchronous.
- `ctx` is opaque/minimal here; full run context is Epic 009.
- Denylist rules are per-tool matchers on literal inputs only.
- This is a developer-footgun guardrail, not a security boundary.
- Pure TypeScript; no native dependency.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 007-RED - canRun tests

**Input:** `packages/core/src/**/*.test.ts` or the security package test home.

**Action - RED:** Add `node:test` coverage for default allow, the three literal denylist examples, and adding a new deny rule with no call-site change.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because `canRun` is missing.

### Task 007-GREEN - canRun implementation

**Input:** `packages/core/src/**` or the security package source home.

**Action - RED:** none - opened by Task `007-RED`.

**Action - GREEN:** Implement the synchronous default-allow `canRun` entrypoint and literal denylist behavior.

**Action - REFACTOR:** Keep rule data separate from the policy entrypoint so new rules do not require call-site edits.

**Verify:** `npm run typecheck && npm test` exits 0.
