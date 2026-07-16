# EPIC 005 — Execution loop with a fake agent · story index

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. Dispatched through `/work` (engineer lanes). One story per
file; one use case per file (verb-first), per `AGENTS.md`.

## Stories (build order = dependency order)

1. [AgentRunner seam — port, resolver, FakeRunner](01-agent-runner-seam.md)
2. [Execution storage groundwork — migration 4, event payload, UnitOfWork, queue extensions](02-execution-storage.md)
3. [Scheduling use cases — enqueue-ready-tasks / run-next-task](03-scheduling-use-cases.md)
4. [Crash consistency & startup recovery](04-crash-consistency-recovery.md)
5. [Pause / resume per initiative](05-pause-resume.md)
6. [Retry & failure semantics](06-retry-failure-semantics.md)
7. [Daemon loop — `daemon run`](07-daemon-loop.md)
8. [Events CLI — `events --after` / `--follow`](08-events-cli.md)
9. [Live insert / re-arrange while running](09-live-mutation.md)
10. [End-to-end smoke test](10-e2e-smoke.md)

## Locked decisions

- **Claimable = `pending`.** The claim path performs exactly one domain
  transition: `pending→running`. Everything that should run again is first
  reset to `pending`: `retry task` does `failed→pending`; startup recovery
  does `running→pending`. One entry edge into execution; `task.status`
  always means what it says (no task sits `running` while queued). The
  EPIC 002 S004 transition table was amended accordingly (B1, resolved).
- **The queue is operational state; events are the audit trail (D1,
  confirmed by Ulrich, 2026-07-16).** A job row records "this task is
  queued/being executed", not attempt history. Hence: a stale claimed job
  is **deleted**, and recovery **deletes** the interrupted job before
  re-enqueueing. The interrupted attempt stays visible in the event stream
  (`task.started` without a matching `task.completed`).
- **Stale queued job = discard, not immediate re-queue.** A claimed job
  whose task is no longer ready (a dependency was added while it sat
  queued) is deleted inside the claim transaction and never executed; the
  task re-enters the queue through the per-iteration readiness scan once
  its dependencies complete. (A literal immediate re-queue of a
  still-blocked task would make `--until-idle` spin forever; the epic
  wording was amended to match.)
- **Two transactions around one runner call.** tx1 = claim + stale check +
  `pending→running` + `task.started` event. The runner executes **outside
  any transaction** (it is async; `node:sqlite` transactions are
  synchronous). tx2 = `running→completed|failed` + job `finish` +
  `task.completed`/`task.failed` event + enqueue of newly-ready dependents
  (+ their `task.ready` events). A crash between tx1 and tx2 leaves
  task+job `running`, which startup recovery repairs (story 04).
- **A rejected runner promise is a task failure, not a daemon crash (debate
  finding).** `RunNextTask` catches a rejection from `runner.run` and
  records it in tx2 exactly like a returned `failed` result (`reason` =
  error name + message). The same path handles
  `RunnerNotResolvableError`. The daemon survives and moves on — EPIC 006's
  real runner will reject.
- **Loop cycle = scan, then claim (debate finding).** Every daemon
  iteration runs `EnqueueReadyTasks` before `RunNextTask`, so a task
  inserted through the EPIC 004 CLI while other work executes is picked up
  on the very next iteration — not only after the queue drains. **Idle** =
  the fresh scan enqueued nothing **and** `claim()` returned `undefined`
  in the same iteration; `--until-idle` exits only then. Queued jobs of a
  paused initiative are not claimable, so the daemon can exit 0 while they
  stay queued — documented behavior.
- **`SQLITE_BUSY` policy (debate finding — EPIC 003 names the daemon as
  policy owner).** Adapters throw on `SQLITE_BUSY` after
  `busy_timeout=5000` (EPIC 003, locked). `RunDaemon` catches
  `SQLITE_BUSY` from any loop step, writes one stderr line, sleeps 100 ms,
  and retries the iteration — unbounded, since contention on a local
  single-writer WAL DB is transient (a racing CLI command). Never counted
  as a task failure.
- **Daemon exit code:** non-zero (1) iff any task **failed during this
  run**; otherwise 0. Failures from earlier runs do not affect the exit
  code (the phase-2 Proof run exits 0 with previously-completed tasks
  present).
- **`TaskResult` (port, this epic):**
  `{ outcome: 'completed'; summary?: string } | { outcome: 'failed'; reason: string }`.
  EPIC 006 extends the `completed` variant (workspace, branch, commit
  sha); the union tag is stable.
- **Runner selection (B3, resolved — the epic bullet was amended).** The
  resolver is `AgentRunnerResolver.for(task, context): AgentRunner`.
  `Task.agent` stays deferred to EPIC 006 (EPIC 002 canonical-model
  deferral). This epic: context has an `ai_provider` binding →
  **unresolvable** (no AI runner registered) → `RunnerNotResolvableError`
  → the task fails with that named reason; no `ai_provider` binding → the
  configured default runner (`fake`). The seam takes `(task, context)` so
  adding `Task.agent` in EPIC 006 changes no port.
- **Event payload:** `events.payload` TEXT (nullable, JSON); domain
  `Event.payload?: Record<string, string>`; `task.failed` carries
  `{ reason: <error name + message> }`. No other event carries a payload
  in this epic.
- **`events` is a locked grammar exception.** The epic (and EPIC 006's
  Proof) specify `events --after <cursor>`, not `list event`. It maps 1:1
  to the `ListEvents` query use case; noted as the one non-verb-first
  client-facing command.
- **New verbs** `pause`, `resume`, `retry` join the EPIC 004 grammar
  (verb-first, 1:1 to use-case classes: `pause initiative` →
  `PauseInitiative`, `retry task` → `RetryTask`). `daemon run` is a
  subsystem command like `db migrate`.
- **`retry task` guard:** only a `failed` task is retryable; anything else
  → `TaskNotRetryableError { taskId, status }` (a use-case guard — the
  domain edge `running→pending` exists for recovery, so the domain alone
  would let a `running` task be "retried").
- **UnitOfWork nesting is a programming error** — `transaction()` inside
  an open transaction throws. No savepoints in this epic (single worker).

## Storage/queue capability map (defined once; each story implements its slice)

New in EPIC 005 on top of the EPIC 003/004 surfaces:

```
UnitOfWork (new port, storage/port.ts):
                      transaction<T>(fn: () => T): T        # BEGIN IMMEDIATE / COMMIT / ROLLBACK   (S02)
JobQueue (extended):  enqueue(taskId) -> boolean            # true = a new queued job row inserted  (S02)
                      claim() -> ClaimedJob | undefined     # now skips tasks of paused initiatives (S02)
                      finish(jobId, status: 'completed'|'failed') -> void                           (S02)
                      discard(jobId) -> void                # delete a stale claimed job (never ran)(S02)
                      listRunningJobs() -> ClaimedJob[]     # startup recovery scan                 (S02)
InitiativeRepository: listAllInitiatives() -> Array<{ id: string; paused: boolean }>                (S05)
                      setPaused(id, paused: boolean) -> void                                        (S05)
TaskRepository:       getInitiativeId(taskId) -> string     # task -> objective -> initiative join  (S02)
EventFeed:            append/readAfter now round-trip Event.payload                                 (S02)
```

## Cross-epic dependencies (all resolved, Ulrich, 2026-07-16)

- **B1 - RESOLVED - transition-table amendment** — EPIC 002 S004 now locks
  `pending→running`, `running→completed`, `running→failed`,
  `failed→pending` (retry), `running→pending` (crash recovery); the earlier
  `failed→running` retry edge is gone. Stories 04 and 06 build on the two
  new edges.
- **B2 - RESOLVED - `enqueue` returns boolean** — EPIC 003 S004 now locks
  `enqueue(taskId): boolean` (true = new `queued` row inserted), so
  `task.ready` fires exactly once per actual insertion.
- **B3 - RESOLVED - agent-type deferral** — the epic's runner-selection
  bullet was amended: selection is by AIProvider binding only in this
  epic; `Task.agent` lands in EPIC 006 behind the unchanged resolver seam.
- **D1 - RESOLVED - queue-history semantics** — stale and crash-interrupted
  jobs are deleted (queue = operational state; events = audit trail); the
  epic's "skipped and re-queued" wording was amended to match.

## Non-goals (from the epic)

No real AI/repos/credentials (EPIC 006), no parallel workers, no push
notifications.
