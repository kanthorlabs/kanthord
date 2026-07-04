# Story 001 - Jira Verbs

Epic: `.agent/plan/epics/022-remaining-broker-verbs.md`

## Goal

`jira.transition` and `jira.comment` run as auto-with-audit broker verbs against
the SU3-recorded Jira surface: transitions are idempotent by observed state,
comments carry an idempotency marker, and both reconcile by reading the issue.

## Acceptance Criteria

- Registry entries declare the complete contract (tier `auto_with_audit`,
  timeout, retry/backoff, idempotency required, rate-limit behavior per SU3,
  `regression: n/a`).
- `jira.transition` moves the double's issue to the target status; desired
  effect = issue observed in target status; a retry whose issue is already
  there reconciles `done` without a second transition call.
- An illegal transition (per the double's transition table) resolves `failed`
  with the SU3 taxonomy reason naming issue and target.
- `jira.comment` posts a comment embedding the idempotency marker; a retried
  submit finds the marker and resolves `done` without double-posting; reconcile
  of an interrupted comment searches for the marker (found ⇒ done, absent ⇒
  resubmit).
- Sync is outward-only and shallow: the verbs push status transitions and
  summary comments; no Jira **content** maps into plan/product state — the
  store's plan files never change from a Jira read (broker **operation state**
  from reconcile reads is exempt, it is runtime bookkeeping — debate finding:
  the earlier absolute wording would have failed on reconcile itself)
  (PRD §6.3).

## Constraints

- The Jira double implements only the SU3-recorded surfaces
  (`jira-slack-surface.md`); the HTTP seam is injected (Epic 014 style).
- Payloads pass the Epic 013 choke point; credentials only in headers, redaction
  per Epic 014.

## Verification Gate

- `npm test` green for `src/broker/verbs/jira.test.ts`.

### Task T1 - jira.transition

**Input:** `src/broker/verbs/jira.ts`, `broker/verbs/jira.transition.yaml`,
`src/broker/verbs/jira.test.ts`

**Action - RED:** Write tests: (a) transition reaches target status with
completion via the poll lifecycle; (b) already-in-target retry reconciles
`done` with no second call; (c) illegal transition ⇒ `failed` naming
issue+target; (d) registry contract completeness asserted.

**Action - GREEN:** Implement the adapter + registry entry over the injected
HTTP seam and the SU3 taxonomy.

**Action - REFACTOR:** extract the shared Jira request/error mapping used by
both verbs.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - jira.comment

**Input:** `src/broker/verbs/jira.ts`, `broker/verbs/jira.comment.yaml`,
`src/broker/verbs/jira.test.ts`

**Action - RED:** Write tests: (a) comment posted with embedded marker;
(b) retried submit resolves `done` without double-post; (c) interrupted-comment
reconcile: marker found ⇒ done, absent ⇒ resubmit; (d) no Jira content reaches
a plan-file write (store plan files unchanged across a reconcile read).

**Action - GREEN:** Implement the comment adapter with marker-based idempotency
and reconcile.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
