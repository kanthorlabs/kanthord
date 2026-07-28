# EPIC 013 — Lease-fenced run recovery (`abandon task`) — stories

Epic: `.agent/plan/epics/013-lease-fenced-run-recovery.md`
Prereq: EPIC 012 (sequence order).

`abandon task --id <id> --reason <text>` revokes a running run's queue lease,
fences every write from that run, waits for the run to drain at its next tool-call
boundary, then returns the task to `pending` under a new lease — never letting two
live runs touch one initiative clone.

## Dispatch order

`01 → 02 → 05 → 03 → 04 → 06`

- **01, 02** are a coupled pair: 02's fence needs 01's `isLeaseCurrent` and
  `StaleLeaseError`.
- **05 runs before 04**: 04 appends `task.abandoned`, which the `events.type`
  CHECK rejects until 05's migration 28 lands.
- **03, 04** are a coupled pair: 03 opens the tx2 `abandoned` branch as a bare
  early return, 04 fills it with the requeue.
- **06** last: it is the only story that makes the Proof runnable end to end.

Migration numbers are fixed by this order: **27** = `jobs.revoked` /
`jobs.revokeReason` (Story 1), **28** = `events.type` CHECK (Story 5).

## Stories

- 1 — Lease token on every claimed run → `01-lease-token-on-every-claimed-run.md`
- 2 — Fence the four write paths → `02-fence-the-four-write-paths.md`
- 3 — Revoke + drain semantics → `03-revoke-and-drain-semantics.md`
- 4 — Requeue on exit → `04-requeue-on-exit.md`
- 5 — `task.abandoned` event type + migration → `05-task-abandoned-event-type-and-migration.md`
- 6 — `abandon task` CLI + read view → `06-abandon-task-cli-and-read-view.md`

## Proof line ownership

`scripts/e2e/abandon-run-proof.sh` (do not modify).

Amended in review (2026-07-28): the three scripted `sleep 2` tool calls became
`sleep 12`. Each sleep is the whole window in which `abandoning` is observable,
and phase B spends ~3s in CLI startup, so 2s made phase B fail on every run.
No assertion was weakened.

| Phase                                                                              | Delivered by                             |
| ---------------------------------------------------------------------------------- | ---------------------------------------- |
| A — a run reaches `running`                                                        | pre-existing; Story 1 must keep it green |
| B — abandon returns, `running` + `abandoning:true`, daemon alive, twice is a no-op | 3 + 6                                    |
| C — drains, requeued, `task.abandoned` carries the reason                          | 3 + 4 + 5                                |
| D — the abandoned run never completed, failed, or wrote a result                   | 2 + 4                                    |
| E — same live daemon re-runs under a new lease                                     | 4                                        |
| `013 ok:`                                                                          | 6                                        |

## Facts (needed for implementation)

**Greenfield gaps — things the epic assumes exist but do not:**

- `beforeToolCall` is **not wired anywhere** in `src/` (`grep -rn beforeToolCall src`
  → zero hits), and there is **no ring-1 gate**. Story 3 attaches the hook for the
  first time. `src/agent/` does not exist; the pi adapter is
  `src/agent-runner/pi.ts` (`PiAgentRunner`), and the Agent is constructed at
  `src/agent-runner/pi.ts:595-598` with only `streamFn` + `getApiKey`.
- pi's contract: `beforeToolCall` returning `{ block: true }` blocks that one tool
  call but does **not** stop the loop
  (`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:37-44`). Stopping
  requires `agent.abort()` as well — the existing precedent is the turn-budget
  abort at `src/agent-runner/pi.ts:632-635`.
- There is no `complete-task.ts` and no fail-task use case. All four fenced writes
  live inside `RunNextTask`'s tx2 (`src/app/task/run-next-task.ts:378-553`):
  completion 381-403, escalation 404-432, candidate 433-509, failure 510-552.
  `transitionTask(x, "failed")` appears exactly once in production, at
  `run-next-task.ts:512`.
- There is no `runs` / `task_runs` / `agent_runs` table at any migration version.
  The `jobs` row is the only per-run identity — which is why it is the lease.

**Load-bearing anchors:**

- `src/queue/port.ts` — 5 methods (`enqueue`, `claim`, `finish`, `discard`,
  `listRunningJobs`); `ClaimedJob { id, taskId }` at lines 13-16.
- `jobs` schema: `src/storage/sqlite/migrations.ts:113-119` — `(id, taskId, status)`
  with `status IN ('queued','running','completed','failed')` and the partial unique
  index `jobs_queued_taskId ON jobs(taskId) WHERE status='queued'`. Never altered
  since migration 2.
- `claim()` SQL (`src/queue/sqlite.ts:23-45`) already enforces one running job per
  initiative via `NOT EXISTS (… rj.status='running' AND ro.initiativeId = i.id)`.
  A revoked row keeps `status='running'`, so this is what upholds "never two live
  runs against one initiative clone" during a drain. **Do not filter `revoked` in
  `claim()`.**
- `finish` today has no guard: `UPDATE jobs SET status=? WHERE id=?`
  (`src/queue/sqlite.ts:47-49`). `discard` is `DELETE FROM jobs WHERE id=?`
  (`:51-53`) — id-keyed, so lease A can never delete lease B's row.
- Transactions: `SqliteUnitOfWork.transaction` uses `BEGIN IMMEDIATE` and rejects
  nesting (`src/storage/sqlite/sqlite-unit-of-work.ts:14-30`). tx1 is
  `run-next-task.ts:205-234`, tx2 is `:380-553`; `claim()` is called **outside**
  any transaction at `:187`.
- The requeue transition to reuse: `src/app/task/recover-interrupted-tasks.ts:38-44`
  (`transitionTask(task,"pending")` → `save` → `discard(job.id)` →
  `enqueue(taskId)` → `task.ready` only when inserted). Nothing is extracted yet.
  `running->pending` is legal at `src/domain/task.ts:102`.
- `TASK_STATUSES` at `src/domain/task.ts:4-11` and `LEGAL_TRANSITIONS` at `:97-109`
  must not change. `tasks.status` CHECK is fixed by migration 5
  (`migrations.ts:160-162`).
- `EVENT_TYPES` at `src/domain/event.ts:3-31` — 27 members today. Latest
  `events.type` CHECK rebuild is migration 26 (`migrations.ts:762-796`,
  scratch table `events_new10`); the next scratch name is `events_new11`.
  `migrate.ts:54-63` requires contiguous versions matching array index + 1.
- The migration-version assertions that must be bumped twice (27 then 28):
  `src/storage/sqlite/migrations.test.ts` line 70 (title), 72, 995, 1099, 1178,
  1510, 1525, 1566, 1687; plus the "all 27 EVENT_TYPES" title at line 800.
- Error convention: `extends Error`, `readonly` fields, `super(<message>)`,
  `this.name = "<ClassName>"` — see `src/app/task/retry-task.ts:10-20`. Every typed
  error must be added to the `toResult` union in `src/apps/cli/error-map.ts:69-119`
  or it is rethrown and crashes the CLI (`:122`).
- `KANTHORD_FAKE_AGENT` replaces only the `ProviderSessionFactory`
  (`src/main.ts:35-57` → `src/composition.ts:254-256`). The Proof therefore runs
  the **real** `PiAgentRunner` and the **real** pi `Agent` loop with real bash
  tools, so it honours the `beforeToolCall` seam. `FakeRunner` (`fake@1`,
  `src/agent-runner/fake.ts`) bypasses pi entirely and is used only by hermetic
  use-case tests.
- The daemon is strictly sequential: `run-daemon.ts:153` `await
this.#deps.runNext.execute()` inside `while (true)`, one task in flight, `stop()`
  checked only between ticks. `runNext` errors are **not** caught
  (`run-daemon.ts:144-150` catches only `SQLITE_BUSY` from `enqueueReady`), so an
  uncaught `StaleLeaseError` would kill the daemon and fail Proof phase E.
- `AgentRunner.run` call sites to update for the required 4th parameter:
  `src/agent-runner/pi.test.ts` (44), `src/agent-runner/verification.test.ts` (10),
  `src/agent-runner/fake.test.ts` (7), `src/app/task/run-next-task.ts:289` (1).
- `JobQueue` fakes to extend: `src/app/task/run-next-task.test.ts:123`,
  `recover-interrupted-tasks.test.ts:37`, `enqueue-ready-tasks.test.ts:31`,
  `retry-task.test.ts:48`, `reject-task.test.ts:118`, `approve-task.test.ts:238`,
  `escalation-persistence.test.ts:88`, `execution-consistency.test.ts`,
  `src/apps/cli/task.test.ts:616`.
- CLI leaf counters asserted exactly:
  `src/apps/cli/architecture.test.ts:28` (`EXPECTED_LEAF_FILE_COUNT = 65`) and
  `:31` (`EXPECTED_LEAF_COUNT = 67`). `kanthord commands` derives its table from the
  live Commander tree (`src/apps/cli/commands/commands.ts:52-60`) — no extra
  registry to update.
- Test conventions: `node:test` + `node:assert/strict`, no `describe` in
  `src/app/task/`, local hand-rolled recording fakes per file. Hermetic-fake
  convention: `src/app/task/recover-interrupted-tasks.test.ts:1-99`. Real-SQLite
  convention: `src/app/task/result-persistence.test.ts:57-60`
  (`mkdtempSync` + `openDatabase` + `migrate(db, MIGRATIONS)`). Queue-adapter
  convention: `src/queue/sqlite.test.ts:22-52` (`makeTempDb`, `seedTask`).
