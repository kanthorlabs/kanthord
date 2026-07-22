# Story B — explicit rebuild of a stale candidate (F2)

Epic: `.agent/plan/epics/007.10-cli-observability-recovery.md`

## Goal

A sibling whose candidate is built on a now-stale base sits at
`awaiting_confirmation` with `candidate:pending`. `RetryTask.execute`
(`src/app/task/retry-task.ts:85-89`) refuses it — the `awaiting_confirmation`
branch is retryable **only** when `candidate.state === "conflict"`, else it
throws `TaskNotRetryableError` (`task <id> is not retryable (status:
awaiting_confirmation)`). To rebuild, the operator today must run an `approve`
known to fail, purely to move the candidate into `conflict`, then `retry`.

This story adds `retry task --rebuild` that requeues an `awaiting_confirmation`
task whose candidate is `pending`, without the manufactured conflict. Plain
`retry` (no flag) stays rejected for a non-conflict awaiting candidate so a
valid candidate is never silently clobbered.

## Contract (tests assert this)

Use case (`src/app/task/retry-task.ts`):

- Extend `execute` input to `{ taskId, note?, rebuild?: boolean }`.
- In the `awaiting_confirmation` branch (:85-122), accept the retry when
  **either** `candidate.state === "conflict"` (today's path, unchanged) **or**
  `rebuild === true && candidate.state === "pending"`. Reject (throw
  `TaskNotRetryableError`) otherwise — in particular, plain retry (`rebuild`
  falsy) of a `pending` awaiting candidate stays rejected.
- The `--rebuild` path reuses the existing conflict-retry body inside the same
  UoW txn: set candidate state to `pending` (idempotent — it is already
  `pending`, so this is a safe no-op write, keeping exactly one current
  candidate), `transitionTask(task, "pending")` (the domain already permits
  `awaiting_confirmation->pending`, `src/domain/task.ts:95`), persist `note`
  if given, enqueue, append the `task.ready` event. Do **not** require or
  depend on `saveConflictSnapshot` (it is a no-op on the SQLite repo today;
  there is no conflict snapshot to save for a `pending` candidate — skip that
  call on the rebuild path).
- Idempotent enqueue: re-running `--rebuild` on an already-requeued (now
  `pending`, back in the queue) task must not create a second queue entry or a
  competing candidate. Guard so the transition/enqueue is a no-op when the task
  is no longer `awaiting_confirmation`.
- The `failed` branch (:124-135) is unchanged; `--rebuild` has no effect there
  (a `failed` task is already retryable via plain retry).
- **Optional stretch, only if cheap:** if the landing read exposes the target
  head SHA, `--rebuild` may compare `candidate.baseSHA` to it and warn / no-op
  when the candidate is **not** actually stale. Skip if it needs new plumbing.

CLI (`src/apps/cli/commands/retry/task.ts`, `runRetryTask` in
`src/apps/cli/task.ts:114-126`):

- Add a `--rebuild` boolean flag beside `--note` (`retry/task.ts:13`). Thread
  it into `retryTask.execute({taskId, note, rebuild})`.
- Success stderr line unchanged (`task re-queued: <id>`).

## Constraints

- Surgical: extend the guard + input; do not restructure the two branches or
  touch the `failed` path's behavior.
- Never clobber a valid candidate: plain `retry` of a `pending` awaiting
  candidate must still throw `TaskNotRetryableError` (regression guard).
- Reuse the existing note / rebuild-prompt path (`getPriorFeedback` in
  `src/composition.ts:289-299` reads `task.note`) — no new prompt plumbing.

## Verification Gate

- `node --test src/app/task/retry-task.test.ts` — extend:
  - `awaiting_confirmation` + `candidate:pending` + `rebuild:true` → task
    transitions to `pending`, enqueued once, `task.ready` appended, candidate
    stays/reset `pending`. No throw.
  - `awaiting_confirmation` + `candidate:pending` + **no** rebuild → still
    throws `TaskNotRetryableError` (regression guard).
  - `awaiting_confirmation` + `candidate:conflict` + no rebuild → unchanged
    (today's conflict retry still works).
  - re-running `--rebuild` twice → no second enqueue / no competing candidate
    (idempotent).
- `node --test` on the retry CLI wiring: `--rebuild` flag parses and reaches
  `execute` as `rebuild:true`.
- `npm run verify` exits 0.
- Delivers the epic's **Proof B / B2 / B3 / B4** (`retry --rebuild` accepted
  from `awaiting_confirmation`+`pending`; task requeued to `pending`; plain
  retry still guarded; landed candidate state visible after approve).
