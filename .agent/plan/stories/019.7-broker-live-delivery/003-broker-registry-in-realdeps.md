# Story 003 - broker verb registry + real adapters in buildRealDeps

Epic: `.agent/plan/epics/019.7-broker-live-delivery.md`

## Goal

Construct the real broker verb registry and adapters in `buildRealDeps` and
thread them onto `RunDaemonDeps`, so `tick()` (Story 004) has the push +
create_pr adapters it needs. Mirrors the adapter wiring in
`src/harness/scenarios/2a-golden.ts`, but with the real HTTP seam (Story 001) and
the real PAT (Story 002) instead of doubles.

## Acceptance Criteria

- `buildRealDeps` returns deps carrying a broker verb registry with entries and
  adapters for: `git.branch` + `git.commit` (local, from `git-local.ts`),
  `git.push` (from `git-push.ts`, with its `diffScanGuard` set from the
  `patternRegistry` when present), and `github.create_pr` (from
  `github-create-pr.ts`, built with the real `GithubHttpSeam` from Story 001 and
  the Story 002 token).
- The `create_pr` adapter is constructed with the sandbox repo coordinates
  (owner/name from the slot) and the loaded token; the `git.push` adapter targets
  the slot worktree and the configured remote.
- The wiring is observable: a hermetic assertion confirms the registry exposes the
  expected verb names and that each adapter is the real constructor's output
  (not a double), constructed with **no network call** (adapters issue network
  only when their `submit`/`poll` runs).

## Constraints

- **Assemble existing adapters** (`makePushAdapter`, `makeCreatePrAdapter`,
  git-local factories) — no new adapter logic; this is composition, mirroring the
  golden scenario's real-adapter path.
- **Secret-scan wired through `diffScanGuard`** — the `git.push` adapter's
  `diffScanGuard` comes from the daemon `patternRegistry` (Epic 013), so the
  outbound scan is armed on the real push path (Story 005 asserts the block).
- **No network at construction** — building adapters must not call GitHub; the
  zero-network guard stays green in the hermetic wiring test.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the registry-wiring test passes;
  guard green.

### Task T1 - build the verb registry + adapters in buildRealDeps

**Input:** `src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`

**Action - RED:** a hermetic test calls `buildRealDeps` with a slot (repo
coordinates + identity), a stub `patternRegistry`, and the Story 002 token seam,
and asserts the returned deps expose a broker registry whose entries include
`git.branch`, `git.commit`, `git.push`, `github.create_pr`; that the `git.push`
adapter received the `diffScanGuard` derived from the pattern registry; and that
the `github.create_pr` adapter was built with the repo coordinates + token. No
network call occurs during construction.

**Action - GREEN:** in `buildRealDeps`, construct the adapters (`makePushAdapter`
with `diffScanGuard`, `makeCreatePrAdapter` with `makeGithubHttpSeam` + token +
repo, git-local factories), assemble the verb registry entries, and add them to
the returned deps (new optional fields on `RunDaemonDeps` for the broker registry
/ delivery adapters).

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/run-deps.test.ts` green.
