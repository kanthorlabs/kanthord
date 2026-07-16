# Story 07 — Escalation (awaiting_confirmation, approve / reject)

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

The D3 round-2 escalation slice, end to end: the agent decided it needs
help (`escalate` tool — the only trigger, Ulrich 2026-07-16), the runner
returned `escalated`, and the task parks in `awaiting_confirmation` with
its frozen proposal; `approve task` promotes exactly that proposal into
the accepted result; `reject task` records a structured decision and fails
the task. Human actors only; agent actors are designed for
(event-triggered), not shipped.

## Acceptance Criteria

- `RunNextTask` tx2 third branch (result `escalated`):
  `running→awaiting_confirmation` + job finish + `task.escalated` event
  (payload `{ reason, proposalCommit?, baseCommit, summary }`) +
  `task_results` row (workspace, branch, base_commit, proposal_commit —
  NULL for a no-change escalation —, summary, reason; `commit_sha` NULL
  until approval). No dependent enqueueing.
- Daemon semantics (annotated notes on EPIC 005 docs, no loop change):
  escalated is NOT failed → exit code unaffected; `--until-idle` exits with
  escalated tasks parked; when any exist, `daemon run` prints one final
  stderr line `N task(s) awaiting confirmation` (B9 — idle success must not
  hide actionable work).
- `src/workspace/local.ts` gains `promoteProposal(dir, taskId,
  proposalCommit)`: `git branch -f kanthord/<taskId> <proposalCommit>` —
  idempotent, creates no content.
- `app/task/approve-task.ts` `ApproveTask` (`approve task <id>`):
  - guards: status must be `awaiting_confirmation` →
    `TaskNotAwaitingConfirmationError { taskId, status }`; a non-NULL
    stored `proposal_commit` must still exist in the workspace →
    `ProposalMissingError`;
  - re-approving an already-completed task whose `commit_sha` equals its
    `proposal_commit` → idempotent no-op success (safe retry after a crash
    mid-approve);
  - effect: `promoteProposal` → update the result row
    (`commit_sha = proposal_commit`) → `awaiting_confirmation→completed` →
    `task.approved` (payload `{ actor: 'human', proposalCommit }`) +
    `task.completed` events → enqueue newly-ready dependents (the same
    helper tx2 uses). Approval creates no new content; git promotion runs
    OUTSIDE the DB transaction, before it — a crash between the two is
    healed by the idempotent re-run. A NULL `proposal_commit` (no-change
    escalation — the agent asked a question before changing anything)
    skips promotion entirely and completes without a `commit_sha`.
- `app/task/reject-task.ts` `RejectTask` (`reject task <id> --resolution
  <retry|discard> [--reason <text>]` — resolution REQUIRED; missing or
  invalid value → one-line CLI error; D4 debate: an enum flag, not two
  booleans). One DB transaction: guard → persist the decision
  (`task_results.rejection_resolution` + `rejection_reason`) →
  `task.rejected` event (payload `{ code: 'REJECTED_BY_ACTOR', resolution,
  message, actor: 'human', proposalCommit? }`) → per resolution:
  - **`retry`:** `awaiting_confirmation→pending` (direct edge — NO
    `task.failed`: a review decision is not an execution failure, debate
    B1). No job insertion — the next daemon scan enqueues it
    (pending-without-job is the normal scan-healed state; `enqueue` is
    insert-once, `task.ready` fires there). The next attempt re-prepares a
    clean workspace and receives the rejection feedback in its prompt
    (story 05).
  - **`discard`:** `awaiting_confirmation→discarded` (terminal) +
    `task.discarded` event + one `task.blocked { dependencyId: <taskId> }`
    event per direct dependent (the pull-feed notice that the blockage is
    permanent). Workspace + proposal branch kept (audit). `retry task` on
    a discarded task → the existing `TaskNotRetryableError` guard.
- **Rejection idempotency (D4 debate B4):** a repeat `reject` with the
  SAME persisted resolution → no-op success (safe client retry after a
  lost response); a CONFLICTING resolution, reject-after-approve, or
  approve-after-reject → `RejectionConflictError { taskId, stored,
  requested }`; any other non-parked status without a stored decision →
  `TaskNotAwaitingConfirmationError`.
- `list task` gains `[--status <status>]` filtering (so
  `list task --status awaiting_confirmation` answers "what needs the
  human", and `--status discarded` lists abandoned work).
- `get task --id` on a task with unmet dependencies names each one with
  its status (D4 debate B5 — a dependency shown `discarded` makes the
  permanent blockage visible without inspecting every pending task).
- CLI: `approve task <id>` / `reject task <id> --resolution <retry|discard>
  [--reason]` registered in `COMMANDS` (verb-first, 1:1 with the use
  cases).

## Constraints

- **Cross-epic (recorded for the workflow epic):** an agent-actor confirmer
  must be triggered by `task.escalated` (proposal readiness), never
  modeled as a completion dependent of the escalated task — deadlock
  otherwise. `ApproveTask`/`RejectTask` are the entry points it will call.
- No actor authentication — `actor` is an audit label (single-engineer
  tool).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — tx2 escalated branch + daemon summary

**Requires:** S06-T1/T2; S02-T1/T2; EPIC 005 S03/S07.

**Input:** `src/app/task/run-next-task.ts`, `src/app/task/run-daemon.ts`,
`src/apps/cli/daemon.ts` (+ tests).

**Action — RED:** temp-DB tests with a fake runner returning `escalated`:
(a) after tx2 the task is `awaiting_confirmation`, the job finished, the
`task.escalated` payload carries reason/proposalCommit/baseCommit/summary,
the result row has `commit_sha` NULL; (b) its dependent stays `pending`,
unenqueued; (c) `daemon run --until-idle` exits 0 and prints the one-line
`1 task(s) awaiting confirmation` summary; a run with none prints no such
line; (d) crash recovery leaves `awaiting_confirmation` untouched. Fails
today: branch absent.

**Action — GREEN:** implement the third tx2 branch + the end-of-run
summary.

**Action — REFACTOR:** none.

**Output:** escalations park durably, visibly, without blocking the loop.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — ApproveTask / RejectTask + CLI + status filter

**Requires:** T1.

**Input:** `src/app/task/approve-task.ts`, `src/app/task/reject-task.ts`,
`src/workspace/local.ts` (`promoteProposal`), the list-tasks query,
`src/apps/cli/task.ts` (+ tests).

**Action — RED:** tests over a real escalated workspace (temp dirs, real
git) + temp DB: (a) `approve task <id>` → `kanthord/<id>` points at the
proposal commit, result row `commit_sha` = proposal, status completed,
`task.approved` + `task.completed` events, the dependent becomes queued;
(b) re-running approve → no-op success, no duplicate events; (c) approve
on a pending task → exit 1 `TaskNotAwaitingConfirmationError`; (d) a
deleted proposal ref → `ProposalMissingError`, task stays parked; (e)
`reject task <id> --resolution retry --reason "wrong file"` → task is
`pending` (never `failed` — the event stream contains `task.rejected` but
NO `task.failed`), the decision row persisted, the next scan enqueues it
(`task.ready`); (f) `reject task <id> --resolution discard` on a task with
one dependent → task `discarded`, `task.discarded` + one
`task.blocked{dependencyId}` event, the dependent stays pending and is
never enqueued, `retry task` on it → `TaskNotRetryableError`; (g)
`reject` without `--resolution` (or with an unknown value) → one-line CLI
error, nothing changed; (h) repeating the same `--resolution` → exit 0
no-op, no duplicate events; the opposite resolution →
`RejectionConflictError`; reject after approve → `RejectionConflictError`;
(i) `list task --status awaiting_confirmation` lists exactly the parked
task, `--status discarded` the discarded one; (j) approving a
NULL-proposal escalation (no-change) → completed, no `commit_sha`, no
promotion attempted; (k) `get task --id` on the blocked dependent names
the discarded dependency with its status. Fails today: modules absent.

**Action — GREEN:** implement both use cases, `promoteProposal`, the
filter, and the CLI registrations.

**Action — REFACTOR:** none.

**Output:** the human confirmation round trip — park, inspect, approve or
reject — the epic's escalation Proof segment.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
