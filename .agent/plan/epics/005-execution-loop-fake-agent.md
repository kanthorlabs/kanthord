# EPIC 005 — Execution loop with a fake agent

## Goal

kanthord becomes a daemon that does work: a worker loop claims ready tasks
from the queue, executes them through the `AgentRunner` port, records the
result, unblocks dependents, and emits lifecycle events a client can poll —
the full orchestration story, proven end to end with a deterministic
`FakeRunner` before any AI cost or nondeterminism enters (EPIC 006 swaps the
runner, nothing else).

## Verification Gate

Gates:  `npm run typecheck && npm test`
Proof:  (continues in the EPIC 004 Proof shell — same exported `KANTHORD_DB`,
        same captured `$INITIATIVE`/`$TASK_DEPLOY` ids)

```bash
node src/main.ts daemon run --runner fake --until-idle
# claims and executes every task in dependency order, exits 0 when idle.
node src/main.ts list task --initiative "$INITIATIVE"
# every task shows completed.
node src/main.ts events --after 0
# prints the full lifecycle stream (ready → started → completed per task)
# in ULID order.

# insert missed work after a completed run, then continue:
TASK_MORE=$(node src/main.ts create task --objective "$OBJECTIVE" --title "add tests")
node src/main.ts daemon run --runner fake --until-idle
# claims and completes only the newly-inserted task; the already-completed
# tasks are untouched. Exit 0.

# failure path: fresh DB, re-run the EPIC 004 Proof sequence, then:
node src/main.ts daemon run --runner fake --fail "$TASK_DEPLOY" --until-idle
# exits non-zero (a task failed).
node src/main.ts list task --initiative "$INITIATIVE"
# shows "deploy" failed and its dependents blocked; the failure event
# (with reason) appears in `events --after 0`.
```

## Stories

- **AgentRunner port + resolver.** `agent-runner/port.ts` (`run(task, context)
  → result`) and the resolver — the seam EPIC 006 fills with pi. **Runner
  selection contract (debate finding — Agent is not a Resource):** the
  resolver selects by the task's assigned **agent type** plus the
  **AIProvider resource** bound in the task's Context; a task with no
  AIProvider binding gets the configured default runner (`fake` in this
  epic), and an unresolvable combination fails the task with a named error.
- **FakeRunner adapter.** Deterministic: succeeds instantly, records what it
  was asked, supports scripted failures by task id (`--fail <task-id>`,
  repeatable) — the test double and the `--runner fake` implementation are
  the same class.
- **Scheduling use cases.** `enqueue-ready-tasks` (domain readiness → queue)
  and `run-next-task` (claim → resolve runner → execute → complete/fail →
  re-enqueue newly-ready dependents) — the loop body as testable use cases.
- **Live insert / re-arrange while running.** Readiness is recomputed at
  **claim time** inside the claim transaction — the loop caches no static
  ready-list, so a task or dependency added through the EPIC 004 CLI while the
  daemon runs is picked up on the next claim, and a queued task whose
  dependencies became unmet by a mutation is skipped and re-queued rather than
  executed. A new dependency can only touch a `pending` task (the EPIC 002
  guard), so it never retro-blocks a running or completed task.
- **Pause / resume per initiative.** `pause initiative <id>` /
  `resume initiative <id>` set a flag the loop honors: a paused initiative's
  tasks are never claimed, so a human can re-arrange its graph without racing
  the claimer. `daemon run` skips paused initiatives.
- **Daemon loop.** `apps/cli/` `daemon run` command: poll-claim loop with
  `--until-idle` (exit when queue empty) and `--poll-interval`; clean SIGINT
  shutdown finishing the in-flight task.
- **Lifecycle events.** Every transition emits to the events table
  (task-ready, task-started, task-completed, task-failed with reason);
  `events --after <cursor>` and `events --follow` (poll loop) CLI commands —
  the pull-based notification surface.
- **Failure semantics.** A failed task stays failed, dependents stay blocked,
  the daemon moves on; `retry task <id>` resets a failed task to pending and
  re-enqueues it.
- **Crash consistency (debate finding).** Task state transition, queue
  update, and event append happen in **one SQLite transaction** — a crash
  between them can never leave a half-recorded step. Enqueue is idempotent
  (EPIC 003), so a restarted daemon that re-scans readiness produces no
  duplicate jobs and no duplicate `task-ready` events. A task left `running`
  by a crashed daemon is re-queued on startup (stated recovery rule), and
  the test suite proves it.

## Non-goals

- No real AI, no repositories, no credentials (EPIC 006) — the FakeRunner
  touches nothing external.
- No parallel workers — one task at a time; concurrency safety beyond the
  EPIC 003 claim is out of scope.
- No push notifications (Slack/Telegram adapters) — pull only.
