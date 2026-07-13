# Story 002 - poll the PR review/merge state

Epic: `.agent/plan/epics/019.18-pr-merge-escalation-and-polling.md`

## Goal

A bounded poller queries the git platform for the state of a delivered task's PR and
records the terminal outcome into the create_pr op's completion, so a merged PR
drives the task to `complete` (existing observe-merge path) and a closed-unmerged PR
escalates — without webhooks and without polling when nothing is awaiting review.

## Acceptance Criteria

- Given a PR that the platform reports as **merged**, the poller records a `merged`
  completion for that task's create_pr op; the existing observe-merge path then marks
  the task `complete`.
- Given a PR reported **closed but not merged**, the poller records a `closed`
  completion; the existing path then escalates (PR closed unmerged).
- Given a PR still **open**, the poller records no terminal completion and the task
  stays `delivering`.
- The poller **does not query the platform when no task is awaiting review** (no
  tracked create_pr op / no `delivering` task) — polling is bounded to outstanding
  reviews.
- The poll cadence is **configurable** (an interval independent of the base tick), so
  polling frequency can be tuned to contain resource cost.

## Constraints

- **Polling, not webhooks** (Ulrich decision 2026-07-13) — query the PR state; do not
  add any inbound webhook/listener.
- **Platform access CLI-first, REST for gaps** — reuse the existing GitHub access
  seam (`gh` CLI / the `makeGithubHttpSeam` REST seam used by
  `src/broker/verbs/github-create-pr.ts`), per memory
  `git-platform-integration-approach`; inject it so tests use a fake (hermetic, no
  network — honor the no-network guard).
- **Feed the existing terminal path** — record the outcome into the create_pr op's
  `broker_completion` (`merged`/`closed`) so the observe-merge block
  (`src/daemon/run-loop.ts:549-556`) does the task transition; do not duplicate the
  complete/escalate logic.
- **Bounded** — drive the poll from the outstanding create_pr ops (`prOpTaskMap`) /
  `delivering` tasks only; a configurable interval gates how often the platform is
  queried.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing
  run-loop / broker tests pass; guard green.

### Task T1 - PR state probe over an injected platform seam

**Input:** `src/review/pr-state.ts` (new), `src/review/pr-state.test.ts` (new)

**Action - RED:** a hermetic test drives `pollPrState({ repo, prNumber, http })` with
a **fake** platform seam returning, in three cases, a merged PR / a closed-unmerged PR
/ an open PR, and asserts the function returns `"merged"` / `"closed"` / `"open"`
respectively. Fails today (module absent).

**Action - GREEN:** create `pr-state.ts` exporting `pollPrState` that queries the PR
via the injected seam and maps the platform response (`merged` flag + `state`) to
`"merged" | "closed" | "open"`.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/review/pr-state.test.ts` green.

### Task T2 - run-loop polls outstanding PRs and records terminal completions

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a run-loop test with a tracked create_pr op for a `delivering` task
and a fake PR-state seam asserts: (a) when the seam reports merged, a `merged`
`broker_completion` row is written for that op and the task becomes `complete`; (b)
when it reports closed-unmerged, a `closed` completion is written and the task
escalates; (c) when it reports open, no completion is written and the task stays
`delivering`; (d) with no outstanding create_pr op, the seam is **not called**. Fails
today (nothing polls PR state in live).

**Action - GREEN:** add an injected PR-state poller + a configurable poll interval to
the run-loop deps; each due poll cycle, for each outstanding create_pr op
(`prOpTaskMap`), call `pollPrState` and, on a terminal result, write the
corresponding `broker_completion` (`merged`/`closed`) so the existing observe-merge
block transitions the task. Skip the platform call entirely when there are no
outstanding ops.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.
