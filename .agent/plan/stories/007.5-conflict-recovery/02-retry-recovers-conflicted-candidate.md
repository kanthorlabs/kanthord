# Story 2 — N1b: `retry task` recovers a conflicted candidate

Epic: `.agent/plan/epics/007.5-conflict-recovery.md`

## Goal

The intuitive command for "this task's landing conflicted, try again on the new
base" is `retry task`. Today `RetryTask.execute()` only accepts `failed` status
(`src/app/task/retry-task.ts:67`) and throws `TaskNotRetryableError` for an
`awaiting_confirmation` task — so the user is pushed to the semantically
backwards `reject task --resolution retry`. This story makes `retry task`
recover a **conflicted** task directly, keyed off durable candidate state, and
without pretending a git conflict was a human rejection.

## Contract (tests assert this)

- `RetryTask.execute({ taskId })` accepts an `awaiting_confirmation` task **iff**
  its latest landing candidate is durably `state === "conflict"` — queried via
  the storage port `getCandidateByTask(taskId)` (`src/storage/port.ts:173`;
  `ChangeCandidate.state` ∈ `pending|landed|conflict`, `src/domain/landing.ts`).
  - conflict-marked → transition `awaiting_confirmation → pending`, `queue.enqueue`,
    and append a **recovery** event. It MUST NOT be `task.rejected` (debate
    concession: a conflict is not a human rejection). Reuse `task.ready` on
    successful enqueue (consistent with the existing `failed`-retry path,
    `retry-task.ts:76`); do not invent a durable state.
  - fresh candidate (`state === "pending"`, never approved) → still throw
    `TaskNotRetryableError` (retrying an unreviewed candidate is meaningless).
  - `failed` task → unchanged (still retryable, existing behavior + test).
  - any other status → unchanged `TaskNotRetryableError`.
- Re-queue **supersedes the stale conflict artifacts** so the re-run starts
  clean: the conflicted `ChangeCandidate` and the stale `task_results` row for
  this task must not cause the re-run's fresh candidate to be shadowed or the
  next approve to re-load the old conflicted SHA. Assert via the fake store that
  after retry the task has no active `state="conflict"` candidate blocking a new
  proposal (supersede/clear, matching however `reject --resolution retry`
  currently leaves the task runnable).
- `transitionTask` (`src/domain/task.ts`) gains the `awaiting_confirmation →
pending` edge. The **guard** that this is only valid for a conflict-marked
  candidate lives in the use case (RetryTask), not the domain transition table —
  the domain edge is permissive; the use case enforces the precondition.
- The whole mutation runs in one `uow.transaction` (as the existing use case).

## Constraints

- Do NOT route through `RejectTask` — keep `reject` (human decision:
  retry|discard, emits `task.rejected`) and `retry` (conflict recovery, no
  `task.rejected`) as distinct verbs with distinct events. Shared re-queue logic,
  if any, moves down into a domain/helper, never use-case-calls-use-case.
- `RetryTask` gains a dependency on the landing candidate query (the storage port
  / a narrow `ConflictStatus` reader). Inject it by constructor (AGENTS.md ports
  rule); no service locator.
- Do NOT add re-verification, rebase, or any git operation here — recovery just
  re-queues; the daemon re-runs the agent on the updated base (existing path).
- Hermetic: fake landing-candidate store + fake queue/feed; no real git.

## Verification Gate

- `node --test src/app/task/retry-task.test.ts`:
  - candidate `state="conflict"` → task `pending`, `queue.enqueue` called,
    recovery event appended, and **no** `task.rejected` event appended.
  - candidate `state="pending"` (fresh) → throws `TaskNotRetryableError`.
  - `failed` task → still transitions to `pending` (regression).
  - stale conflict candidate/result superseded (fake store assertion).
- `node --test src/domain/task.test.ts` — `awaiting_confirmation → pending` is an
  allowed transition; previously-forbidden edges stay forbidden.
- CLI action test (`src/apps/cli/task.test.ts`) — `retry task --id <conflicted>`
  → exit 0; `retry task --id <fresh-candidate>` → non-zero + `TaskNotRetryable`
  message.
- `npm run typecheck` 0; `npm run lint` clean.
