# Story 1 — Discard state contract (design artifact only)

Epic: `.agent/plan/epics/007.16-failure-observability-and-discard-path.md`

No product code, no tests. This story writes one document. Story 5 implements it
and may not start until this file exists.

## Change

Create `.agent/plan/stories/007.16-failure-observability-and-discard-path/contract.md`
containing exactly these seven sections, with the values below already decided —
this story **transcribes** the contract, it does not choose it.

1. **Task transitions to add** to `LEGAL_TRANSITIONS` (`src/domain/task.ts:85-94`):
   - `failed->discarded` — operator discard of a failed task.
   - `pending->discarded` — cascade onto a dependent that never ran.
   - Do **not** add `running->discarded` (a running task must first reach
     `failed`/`completed`; the daemon owns that row) or
     `completed->discarded` (completed work is not discardable).
2. **Dependency semantics** — only `completed` satisfies a dependency edge.
   `readiness()` (`src/domain/graph.ts:167`) already enforces this and must not
   change. State explicitly: a `discarded` dependency never unblocks a dependent.
3. **Cascade rule** — discarding task T also discards the transitive closure of
   tasks that depend on T, restricted to those in status `pending`. Order is
   deterministic: **breadth-first from T, siblings visited in ascending task-id
   order.** A dependent in `running`, `completed`, `failed`, or
   `awaiting_confirmation` is **not** touched by the cascade and is reported in
   the command output as skipped.
4. **Objective outcome** — after any discard, an objective whose tasks are all
   terminal (`completed` | `discarded`) and which contains **at least one**
   `discarded` task transitions `building->discarded`. An objective whose tasks
   are all `completed` keeps its existing `building->awaiting_confirmation` path.
   `discarded` is terminal: no transition leaves it.
5. **Initiative outcome** — when every objective of an initiative is terminal
   (`integrated` | `discarded`) and at least one is `discarded`, the initiative
   transitions `building->discarded`. Terminal; no transition leaves it.
6. **Retryability** — `discarded` is **terminal and not retryable**. `retry task`
   on a `discarded` task throws `IllegalTransitionError("discarded","pending")`
   via the existing `transitionTask` guard; no new error type. State this
   explicitly so Story 5 does not add a `discarded->pending` edge.
7. **Events** — reuse the existing `task.discarded` (`src/domain/event.ts:13`).
   Add exactly two new types to `EVENT_TYPES`: `objective.discarded` (payload
   `{reason}`) and `initiative.discarded` (no payload). Cascade-discarded tasks
   each emit their own `task.discarded` with payload
   `{reason: "cascade", origin: "<originating task id>"}`.

## Constraints

- This story creates **one** file and edits nothing else. No `src/` changes.
- Do not introduce an `abandoned` status; the epic's decision record rejects it.
- Every value above is already fixed. If the implementer believes one is wrong,
  stop and escalate to the human — do not substitute a different rule.

## Verify

- `test -f .agent/plan/stories/007.16-failure-observability-and-discard-path/contract.md`
- The file contains all seven numbered sections above, and section 3 states the
  breadth-first / ascending-task-id ordering verbatim.
- `git status --short src/` shows **no** modified files under `src/`.
- `npm run verify` exits 0 (unchanged tree, so this is a no-op regression check).
- Proof: none directly. Story 5 delivers Proof lines 2, 3 and 4 by implementing
  this contract.
