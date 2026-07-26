# Discard state contract — EPIC 007.16

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`
Story: `01-discard-state-contract.md` (design artifact; this file **transcribes**
the decided contract, it does not choose it)

Story 5 (`05-terminal-discard-path.md`) implements exactly what is below. Nothing
here is left to build time. If an implementer believes a value is wrong, stop and
escalate to the human — do not substitute a different rule.

## 1. Task transitions to add

Added to `LEGAL_TRANSITIONS` in `src/domain/task.ts:85-94`:

- `failed->discarded` — operator discard of a failed task.
- `pending->discarded` — cascade onto a dependent that never ran.

Deliberately **not** added:

- `running->discarded` — a running task must first reach `failed` / `completed`;
  the daemon owns that row.
- `completed->discarded` — completed work is not discardable.

The existing `awaiting_confirmation->discarded` edge stays as-is.

## 2. Dependency semantics

Only `completed` satisfies a dependency edge. `readiness()`
(`src/domain/graph.ts:167`) already enforces this and **must not change**.

Stated explicitly: **a `discarded` dependency never unblocks a dependent.** A
discarded prerequisite did not produce the artifact its dependents need, so it
can never be treated as completion.

## 3. Cascade rule

Discarding task T also discards the transitive closure of tasks that depend on T,
restricted to those in status `pending`.

Order is deterministic: **breadth-first from T, siblings visited in ascending
task-id order.**

A dependent in `running`, `completed`, `failed`, or `awaiting_confirmation` is
**not** touched by the cascade, and is reported in the command output as skipped.

## 4. Objective outcome

After any discard, an objective whose tasks are all terminal
(`completed` | `discarded`) and which contains **at least one** `discarded` task
transitions `building->discarded`.

An objective whose tasks are all `completed` keeps its existing
`building->awaiting_confirmation` path.

`discarded` is terminal: **no transition leaves it.**

## 5. Initiative outcome

When every objective of an initiative is terminal (`integrated` | `discarded`)
and at least one is `discarded`, the initiative transitions
`building->discarded`.

Terminal; **no transition leaves it.**

## 6. Retryability

`discarded` is **terminal and not retryable**.

`retry task` on a `discarded` task throws
`IllegalTransitionError("discarded","pending")` via the existing
`transitionTask` guard — **no new error type**.

Stated explicitly so Story 5 does **not** add a `discarded->pending` edge.

## 7. Events

Reuse the existing `task.discarded` (`src/domain/event.ts:13`).

Add exactly **two** new types to `EVENT_TYPES`:

- `objective.discarded` — payload `{reason}`
- `initiative.discarded` — no payload

Cascade-discarded tasks each emit their own `task.discarded` with payload
`{reason: "cascade", origin: "<originating task id>"}`.
