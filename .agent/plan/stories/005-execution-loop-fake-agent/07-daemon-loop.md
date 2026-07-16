# Story 07 — Daemon loop (`daemon run`)

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

kanthord becomes a daemon: `daemon run` recovers once, then cycles
**scan → claim/run** — `--until-idle` for batch runs (the Proof),
`--poll-interval` for long-running mode, clean SIGINT shutdown finishing
the in-flight task, and the daemon-owned `SQLITE_BUSY` retry policy.

## Acceptance Criteria

- `app/task/run-daemon.ts` — `RunDaemon` with injected `{ recover,
  enqueueReady, runNext, sleep }` (use-case instances + `sleep(ms):
  Promise<void>`), options `{ untilIdle: boolean; pollIntervalMs: number }`
  (default poll 1000):
  1. `RecoverInterruptedTasks` once.
  2. Each iteration: `EnqueueReadyTasks`, then `RunNextTask` (**scan
     before every claim** — debate finding: this is what makes a live
     insert visible on the next iteration, not only after the queue
     drains).
  3. `completed`/`failed`/`skipped` → next iteration immediately. `idle`
     (this iteration's scan enqueued nothing **and** claim returned
     `undefined`) → if `untilIdle` exit, else `sleep(pollIntervalMs)` and
     continue.
  - **`SQLITE_BUSY`:** any loop step throwing it → one stderr line,
    `sleep(100)`, retry the iteration; never a task failure (index
    policy).
  - `stop()`: finish the in-flight `RunNextTask` (its tx2 included), then
    exit the loop — never kill mid-task.
  - returns `{ exitCode: 0 | 1 }` — 1 iff any `RunNextTask` this run
    returned `failed`.
- `apps/cli/daemon.ts` — `daemon run [--runner <name>] [--fail <task-id> …]
  [--until-idle] [--poll-interval <ms>]`:
  - `--runner` defaults to `fake`; any other value → `UnknownRunnerError`,
    exit 1 (this epic registers only the fake);
  - repeatable `--fail` builds the `FakeRunner` with `failTaskIds`
    (composition root);
  - `process.once('SIGINT', → stop())` wired in the handler; the process
    exit code is the use case's.
- Wiring in `main.ts`: shared `DatabaseSync`, `SqliteUnitOfWork`, queue,
  repos, feed, `FakeRunner` + `RegistryRunnerResolver`, grouped in a
  `buildDaemon(deps)` factory.

## Constraints

- The loop is a use case (apps stay thin: parse flags → build deps → call
  `RunDaemon`).
- SIGINT is wired in the handler but tested via `stop()` on the use case.
- The per-iteration scan is a few local SELECTs on a single-engineer DB —
  accepted cost for correctness (no cached ready-list, per the epic).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — RunDaemon use case

**Requires:** S03-T1/T2; S04-T1.

**Input:** `src/app/task/run-daemon.ts` (new) + test (new).

**Action — RED:** hermetic tests with scripted fake use cases: (a)
until-idle: recover once, then scan-before-every-claim (call-order
asserted), drains three results then idle → exits, `exitCode 0`; (b) one
`failed` result → `exitCode 1` (still drains the rest); (c) a task
"inserted" after the first iteration (the fake scan returns it on
iteration 2) is executed **before** the queue drains — the live-insert
pickup; (d) idle is only reported when the same iteration's scan enqueued
nothing and claim was `undefined` (a `skipped` result does not exit
until-idle); (e) polling mode: idle → `sleep(poll)` → continue; `stop()`
during an in-flight `runNext` lets it finish, then exits; (f) a scripted
`SQLITE_BUSY` throw from one scan → one retry after `sleep(100)`, run
continues, exit code unaffected. Fails today: module does not exist.

**Action — GREEN:** implement per the AC.

**Action — REFACTOR:** none.

**Output:** the daemon loop as a hermetic use case with quiescence-correct
until-idle.

**Verify:** `npm test` green (all six cases); `npm run typecheck` exit 0.

### Task T2 — `daemon run` CLI + composition root

**Requires:** S07-T1; S01-T1/T2; EPIC 004 S01 (command table).

**Input:** `src/apps/cli/daemon.ts` (new) + test; `src/main.ts` (extend —
`buildDaemon`).

**Action — RED:** handler tests: (a) `daemon run --runner fake
--until-idle` on a temp DB with one ready task → exit 0, task completed;
(b) `--runner nope` → exit 1, one `error: unknown runner: nope` line,
nothing executed; (c) `--fail <id>` → that task fails, exit 1;
(d) `--poll-interval` parses as positive integer, else one-line CLI parse
error. Fails today: module does not exist.

**Action — GREEN:** implement the handler + `buildDaemon` wiring +
register `daemon run` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `node src/main.ts daemon run --runner fake --until-idle` works
against the real DB — the Proof's engine.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
