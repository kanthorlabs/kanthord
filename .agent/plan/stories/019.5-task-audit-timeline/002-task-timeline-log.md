# Story 002 - durable task timeline + correlation threading

Epic: `.agent/plan/epics/019.5-task-audit-timeline.md`

## Goal

One durable, append-only **task timeline** that reconstructs "what happened, in order" for
a task from durable records alone — anchored on `task_id + attempt` (survives respawn),
with a shared `correlation_id` threaded through the records that already exist. This is the
LP7 "audit reconstruction" capability, made real and automated.

## Acceptance Criteria

- A `task_timeline_event` append-only store records ordered events with at least
  `{event_id, task_id, attempt, session_id?, correlation_id, kind, ts, observed_failure_signal?,
  summary?}`; events for one task/attempt read back in occurrence order.
- A shared `correlation_id` is threaded through the existing writers so their records join
  the timeline: attempt-evidence, interaction-capture, broker `op_ledger`
  (already has a `correlation` field), gate results, and spawn/respawn journal events.
- Reconstruction: given a scripted run (dispatch → spawn → tool call → broker op → gate
  fail → escalation → respawn), the timeline for that task is **one ordered sequence**
  whose events all carry the task's `correlation_id`, spanning attempt, session (as child
  events), broker op, and gate/interaction records — built from **durable state only**,
  no in-memory scrollback.
- The anchor is `task_id + attempt`: a respawn (fresh `session-<ts>`) appears as **child
  events** under the same task/attempt, not a separate top-level trace.

## Constraints

- **Normalize, do not replace** — the timeline joins existing records via `correlation_id`
  + a thin events table; it is **not** a new universal trace substrate (debate finding).
  Broker `op_ledger` already carries `correlation`; reuse it.
- **Anchor on `task_id + attempt`** — session ids are child events; a session-centered
  spine fragments across crash recovery (debate finding; respawn creates a fresh
  `sessionId`).
- **Append-only + durable** — the timeline survives daemon restart; it is read-model over
  durable writes, consistent with the rebuild/projection pattern (`src/store/`).
- **One-shot schema init** — the new table is created via the unified `initSchema`
  aggregator (SQLite DDL idempotency rule), not per-method.

## Verification Gate

- `npm test` green for the timeline suite; typecheck 0; zero-network guard green.
- Ordered read-back, correlation threading across ≥4 existing writers, and full
  reconstruction from durable state (respawn as child events) are asserted.

### Task T1 - append-only task_timeline_event store

**Input:** `src/metrics/task-timeline.ts`, `src/metrics/task-timeline.test.ts`,
`src/store/schema.ts`

**Action - RED:** a test appends scripted events for `{task_id, attempt}` and asserts they
read back in occurrence order with their fields; events for a second attempt of the same
task are ordered under that attempt; the table is created by `initSchema` (a method on an
uninitialised store throws `no such table`).

**Action - GREEN:** implement the append-only `task_timeline_event` store + query-by-task
in occurrence order; register its DDL in `initSchema`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/task-timeline.test.ts` — T1 green.

### Task T2 - thread correlation_id through existing writers

**Input:** `src/metrics/task-timeline.ts`, `src/scheduler/attempt-evidence.ts`,
`src/metrics/interaction-capture.ts`, `src/agent/pi-session.ts`,
`src/workflow/tdd-workflow.ts`, and their tests

**Action - RED:** a scripted run drives attempt-evidence, an interaction, a broker op, a
gate result, and a spawn/respawn; the test asserts each writes a timeline event carrying
the same `correlation_id` for the task, and that `queryTaskTimeline` returns them as one
ordered sequence with the respawn as a child event of the same `task_id + attempt`.

**Action - GREEN:** thread a `correlation_id` (derived from `task_id + attempt`) into these
writers so each emits a timeline event; reuse the broker ledger's existing `correlation`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/task-timeline.test.ts` — T2 reconstruction case green.
