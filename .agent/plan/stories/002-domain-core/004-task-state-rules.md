# Story 004 - task state rules

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

Legal task-status transitions are enforced in the domain; illegal transitions
throw a named domain error.

## Acceptance Criteria

- Transition table (locked): `pending→running`, `running→completed`,
  `running→failed`, `failed→running` (retry — confirmed by Ulrich,
  2026-07-16). Nothing else.
- `transitionTask(task, to)` returns a **new** task with the new status; the
  input task is not mutated.
- Any pair outside the table throws `IllegalTransitionError` carrying
  `{ from, to }`.

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
(b) running→failed and failed→running succeed; (c) pending→completed,
pending→failed, completed→running, completed→failed, failed→completed each
throw `IllegalTransitionError` whose `from`/`to` name the attempted pair.
Fails today: `transitionTask` does not exist.

**Action - GREEN:** implement the transition table, `transitionTask`, and
`IllegalTransitionError` in `task.ts`.

**Action - REFACTOR:** none.

**Output:** `src/domain/task.ts` additionally exports
`transitionTask(task: Task, to: TaskStatus): Task` and
`IllegalTransitionError { from, to }` enforcing exactly the four legal edges.

**Verify:** `npm test` green (legal chain + all five illegal pairs);
`npm run typecheck` exit 0.
