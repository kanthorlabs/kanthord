# Story 004 - task state rules

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

Legal task-status transitions are enforced in the domain; illegal transitions
throw a named domain error. The same module owns the **dependency-mutation
guard**: a task's `dependencies` may be replaced only while it is `pending`,
so insert/re-arrange (EPIC 004) can never retro-order a running or finished
task. Dependencies are task-level only.

## Acceptance Criteria

- Transition table (locked): `pending→running`, `running→completed`,
  `running→failed`, `failed→pending` (retry), `running→pending` (crash
  recovery), `running→awaiting_confirmation` (escalation),
  `awaiting_confirmation→completed` (approve),
  `awaiting_confirmation→pending` (reject-to-retry),
  `awaiting_confirmation→discarded` (reject-to-discard; `discarded` is
  terminal). Nothing else. (Amended for EPIC 005 — confirmed by Ulrich,
  2026-07-16, replacing the earlier `failed→running` retry edge: EPIC 005
  locks "claimable = pending", so everything that runs again is first
  reset to `pending` and enters execution through the single
  `pending→running` edge. Amended again for EPIC 006 D3/D4 — Ulrich,
  2026-07-16, debate-reviewed: the `awaiting_confirmation` status + the
  terminal `discarded` status carry the escalation/rejection flow; an
  earlier same-day `awaiting_confirmation→failed` reject edge was replaced
  — a review decision is not an execution failure; claimable stays
  "pending only", crash recovery never touches `awaiting_confirmation`.
  See `.agent/plan/stories/006-real-agents-via-pi/07-escalation.md`.)
- `transitionTask(task, to)` returns a **new** task with the new status; the
  input task is not mutated.
- Any pair outside the table throws `IllegalTransitionError` carrying
  `{ from, to }`.
- `setDependencies(task, dependencies)` returns a **new** task with the given
  `dependencies` array (input not mutated) **only when `task.status ===
  'pending'`**; otherwise it throws `DependenciesLockedError { taskId,
  status }`. It performs no cycle/unknown validation — that is `validateGraph`
  (story 005), run by the EPIC 004 use case over the whole graph.

## Constraints

- Extends `src/domain/task.ts`. Pure functions, no I/O.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - legal-transition enforcement

**Requires:** S003-T2 (`Task`, `TaskStatus`, `newTask`).

**Input:** `src/domain/task.ts`, `src/domain/task.test.ts`; consumes the
existing `Task`/`TaskStatus`/`newTask`.

**Action - RED:** test asserts: (a) the chain pending→running→completed via
`transitionTask` yields the expected statuses and never mutates its input;
(b) running→failed, failed→pending, and running→pending succeed;
(c) pending→completed, pending→failed, completed→running, completed→failed,
completed→pending, failed→running, failed→completed each throw
`IllegalTransitionError` whose `from`/`to` name the attempted pair.
Fails today: `transitionTask` does not exist.

**Action - GREEN:** implement the transition table, `transitionTask`, and
`IllegalTransitionError` in `task.ts`.

**Action - REFACTOR:** none.

**Output:** `src/domain/task.ts` additionally exports
`transitionTask(task: Task, to: TaskStatus): Task` and
`IllegalTransitionError { from, to }` enforcing exactly the five legal edges.

**Verify:** `npm test` green (legal chain + all seven illegal pairs);
`npm run typecheck` exit 0.

### Task T2 - dependency-mutation guard

**Requires:** S004-T1 (`transitionTask` shape — `setDependencies` mirrors its
immutable, named-error style).

**Input:** `src/domain/task.ts`, `src/domain/task.test.ts`; consumes the
existing `Task`/`TaskStatus`.

**Action - RED:** test asserts: (a) `setDependencies(pendingTask, ['x','y'])`
returns a new task whose `dependencies` equals `['x','y']` and does not mutate
the input; (b) calling it on a `running`, `completed`, or `failed` task throws
`DependenciesLockedError` whose `taskId`/`status` name the offending task;
(c) `setDependencies(pendingTask, [])` clears dependencies. Fails today:
`setDependencies` does not exist.

**Action - GREEN:** implement `setDependencies` and `DependenciesLockedError`
in `task.ts`; the pending check is the only gate (no cycle/unknown check).

**Action - REFACTOR:** none.

**Output:** `src/domain/task.ts` additionally exports
`setDependencies(task: Task, dependencies: string[]): Task` and
`DependenciesLockedError { taskId, status }` — replace-only, pending-gated.

**Verify:** `npm test` green (pending replace + three non-pending throws +
clear-to-empty); `npm run typecheck` exit 0.
