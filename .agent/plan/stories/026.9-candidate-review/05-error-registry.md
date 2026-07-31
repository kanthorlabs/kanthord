# Story 5 — the verdict error registry, and no `500` for a state

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Depends on: Story 1 (`NoCandidateError`), Story 3 (`DecisionClosedError`,
`DecisionSubjectMismatchError`).

Today every verdict error falls through `mapError` to
`TRANSPORT_ERRORS.internal` (`src/apps/http/error-registry.ts:170-192`) because
`DOMAIN_ERROR_MAPPINGS` (`:41-91`) has no entry for any of them.

## Change

### 1. Two new error classes in `src/app/errors.ts`

Append beside `ProposalWorkspaceMissingError` (`:82-92`):

```ts
/** The landing target branch moved more times than the CAS retry cap allows. */
export class TargetMovedError extends Error {
  readonly taskId: string;
  constructor(taskId: string) {
    super(`landing target for task ${taskId} moved during approval`);
    this.name = "TargetMovedError";
    this.taskId = taskId;
  }
}

/** Landing failed for a reason that is not a state the operator can answer. */
export class LandingFailedError extends Error {
  readonly taskId: string;
  constructor(taskId: string, message: string) {
    super(message);
    this.name = "LandingFailedError";
    this.taskId = taskId;
  }
}
```

`LandingFailedError` carries **no** `cause`. `ApproveOutcome`'s
`landing_failed` arm has a `cause: unknown` (`approve-task.ts:33-38`); it is
deliberately dropped at the route boundary (Story 7) so no adapter internals
reach the wire.

### 2. `src/apps/http/error-registry.ts`

Add **eleven** entries, inserted after the last current entry at `:90` and
before the closing `];` at `:91`, in this order.

Epic decision 15 names nine codes. Two more are added here because the epic's
own rule — "no verdict route may answer `500` for a state" — requires them:
`decision_subject_mismatch` (Story 3's guard) and `rejection_conflict`
(`RejectionConflictError`, thrown by `RejectTask` at `reject-task.ts:157-160`
when a completed task is rejected, which the rejection route can reach).
Both are `409`. This is an addition to the epic's list, not a deviation from it.

```ts
{ type: DecisionSubjectMismatchError, code: "decision_subject_mismatch", status: 409 },
{ type: DecisionClosedError, code: "decision_closed", status: 409,
  message: "this decision is no longer open; refresh the queue" },
{ type: StaleCandidateError, code: "stale_candidate", status: 409 },
{ type: NoCandidateError, code: "no_candidate", status: 409,
  message: "this subject has no candidate to review" },
{ type: TargetMovedError, code: "target_moved", status: 409 },
{ type: TaskNotAwaitingConfirmationError, code: "task_not_awaiting_confirmation", status: 409 },
{ type: ObjectiveNotAwaitingConfirmationError, code: "objective_not_awaiting_confirmation", status: 409 },
{ type: ImpactChangedError, code: "impact_changed", status: 409 },
{ type: RejectionConflictError, code: "rejection_conflict", status: 409 },
{ type: IllegalTransitionError, code: "illegal_transition", status: 409 },
{ type: LandingFailedError, code: "landing_failed", status: 500,
  message: "landing failed; the task was not transitioned" },
```

Imports: `DecisionClosedError` + `DecisionSubjectMismatchError` from
`../../app/project/assert-decision-open.ts`; `NoCandidateError` from
`../../app/task/get-task-candidate.ts`; `RejectionConflictError` from
`../../app/task/reject-task.ts`; `IllegalTransitionError` from
`../../domain/task.ts`; the rest from `../../app/errors.ts` (which already
re-exports `StaleCandidateError` at `:14`).

`mapError` is first-match-wins over the array (`:175`), so no entry above may be
a base class of one below it. None of these eleven are related by inheritance —
assert that in the test rather than assuming it.

### 3. `src/apps/cli/error-map.ts`

Add `TargetMovedError` and `LandingFailedError` to the `instanceof` chain
between `:118` and `:119`, so a future CLI caller does not rethrow. No other
entry changes; `StaleCandidateError` (`:116`), `ImpactChangedError` (`:115`),
`TaskNotAwaitingConfirmationError` (`:112`) and `RejectionConflictError`
(`:119`) are already mapped.

## Constraints

- `landing_failed` is the **only** new `500`. Every other new code is `409`.
- No new `TRANSPORT_ERRORS` key.
- No entry may carry `status: 410` (026.8 decision 3 remains binding).
- Do not change any existing mapping's code or status.

## Verify

- `node --test src/apps/http/error-registry.test.ts`:
  - `mapError(new DecisionClosedError("d", "resolved"))` is
    `{ code: "decision_closed", status: 409 }` and its `message` is the
    registry's fixed string, **not** the error's own — so the wire never says
    which of unknown/resolved/expired it was;
  - one test per remaining new class asserting code + status;
  - `mapError(new LandingFailedError("t", "boom: /Users/x/home"))` returns
    status `500`, code `landing_failed`, and a message that does **not** contain
    `boom` or a path separator — the sanitisation epic decision 11 requires;
  - no entry in `DOMAIN_ERROR_MAPPINGS` or `TRANSPORT_ERRORS` carries
    `status: 410`, and `mapError` returns `410` for nothing;
  - **no registered type is an instance-of ancestor of a later registered
    type**: for every pair `(i, j)` with `i < j`, assert
    `!(Object.create(MAPPINGS[j].type.prototype) instanceof MAPPINGS[i].type)`.
- `node --test src/apps/cli/error-map.test.ts` — `toResult` returns exit code
  `1` and an `error: …` line for `TargetMovedError` and `LandingFailedError`
  instead of rethrowing.
- `npm run verify` exits 0.
- Proof: phase D (`...and names the reason` for both `stale_candidate` and
  `decision_closed`) and phase F (`a discard with no impact digest is
refused`).
