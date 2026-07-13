# Story 001 - ReviewRouter seam + default user route

Epic: `.agent/plan/epics/019.18-pr-merge-escalation-and-polling.md`

## Goal

Define a pluggable `ReviewRouter` seam that routes a "PR ready for review" request,
with a default **user** route that records an inbox escalation. On a successful
delivery, the run-loop routes the request so an operator can learn a PR is waiting.

## Acceptance Criteria

- A `ReviewRouter` seam accepts a review request carrying at least `{ taskId,
  prNumber, prUrl }` and routes it; the seam is injectable so an alternate router can
  replace the default (proving external routes are pluggable).
- The default **user** route records an inbox escalation whose evidence includes the
  task id and the PR number/url and whose reason marks it a review request (e.g.
  `review_requested`), with status `open`.
- After a successful `deliverSession` in the live run-loop (task → `delivering`), the
  configured `ReviewRouter` is invoked exactly once for that task with the delivered
  PR's number/url.

## Constraints

- **Seam + user default only** (Ulrich decision 2026-07-13) — define the
  `ReviewRouter` interface and one `UserReviewRouter` implementation; do not build any
  external route (LLM/colleague) — that is 2B/3.
- **Reuse the inbox** — the user route records the escalation via
  `createEscalationItem` (`src/inbox/inbox.ts`); do not invent a parallel inbox.
- **Injected into the run-loop** — the router is a run-loop dep (e.g.
  `deps.reviewRouter`); the run-loop calls it at the delivery site (Epic 019.16
  delivery block, right after `deliverSession` succeeds), using the PR number/url the
  delivery produced (the create_pr result carries `pr_number`/head).
- **Idempotent** — routing for the same task/PR must not create duplicate inbox items
  across ticks (deterministic id, as `createEscalationItem` already uses).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing inbox /
  run-loop tests pass; guard green.

### Task T1 - ReviewRouter seam + UserReviewRouter

**Input:** `src/review/review-router.ts` (new),
`src/review/review-router.test.ts` (new)

**Action - RED:** a hermetic test constructs `UserReviewRouter` over a temp store and
calls `requestReview({ taskId: "t1", prNumber: 5, prUrl: "https://…/pull/5" })`, then
asserts an `inbox_items` row exists with kind `escalation`, a `review_requested`
reason, status `open`, and evidence containing the task id and PR number/url. A second
assertion: `ReviewRouter` is an interface a hand-written fake can implement (type-level
seam). Fails today (module absent).

**Action - GREEN:** create `review-router.ts` exporting the `ReviewRouter` interface
(`requestReview(req: ReviewRequest): Promise<void>` / sync) and `UserReviewRouter`
implementing it via `createEscalationItem` with a `review_requested` reason.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/review/review-router.test.ts` green.

### Task T2 - run-loop routes a review request on delivery

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a run-loop test injects a fake `ReviewRouter` and drives a delivery
(clean session, `commitsAhead > 0`, push+create_pr succeed) and asserts the router's
`requestReview` was called once with the task id and the delivered PR's number/url.
Fails today (run-loop never routes a review request).

**Action - GREEN:** add `reviewRouter?: ReviewRouter` to the run-loop deps; after a
successful `deliverSession` (in the block that sets `delivering`), call
`deps.reviewRouter?.requestReview({ taskId, prNumber, prUrl })` using the create_pr
result. Keep the `delivering` transition (Epic 019.16 S003).

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.
