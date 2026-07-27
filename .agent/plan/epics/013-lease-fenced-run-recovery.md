# EPIC 013 — Lease-fenced run recovery (`abandon task`)

> Split out of a rejected single-epic draft (debate 2026-07-27), which found that
> a per-task `abandon` command is not a CLI flag but a change to execution
> identity: without a run identity, nothing can tell "old run A, abandoned" from
> "new run B, running the same task". The fence strategy below was decided by
> Ulrich on 2026-07-27.
>
> Siblings: `011-client-discovery-surface.md`,
> `012-explicit-activation-guarded-verdicts.md`.

## Goal

A task stuck in `running` can be recovered by the operator without restarting
the daemon and without ever letting two live runs touch one initiative clone.
`abandon task --id <id> --reason <text>` **revokes the run's lease
immediately** — from that moment every write from the old run (completion,
failure, result row, terminal event) is rejected with a typed stale-lease
error — then waits for that run to **drain**: the task stays `running` with an
`abandoning` marker until the old run exits, and only then returns to `pending`
and is re-enqueued under a new lease. `task.abandoned` records the operator's
reason. The invariant is one sentence: **never two live runs against one
initiative clone.**

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
Hermetic coverage required beyond the Proof:

- **Lease identity.** Every claimed run carries a lease token derived from the
  existing `jobs` row id (no new identifier is invented — see Decisions). The
  token is threaded through the runner and required by: task completion, task
  failure, task-result persistence, and terminal event append.
- **Fence.** Each of those four writes verifies, inside its own transaction, that
  the lease is still current. A unit test drives every one of them with a revoked
  lease and asserts a typed `StaleLeaseError` and **zero** rows written. A late
  write from lease A must also be unable to complete, fail, or discard lease B's
  queue row.
- **Drain.** Revocation is observed at the **next tool-call boundary** of the
  agent loop, so a run drains after its current tool call returns. The
  `beforeToolCall` hook does NOT exist in `src` yet — `src/agent-runner/pi.ts`
  builds the pi `Agent` with only `streamFn` + `getApiKey`, and there is no
  ring-1 gate — so this epic wires the hook for the first time. Blocking is not
  sufficient on its own: per pi's contract
  (`@earendil-works/pi-agent-core/dist/types.d.ts`), returning `{ block: true }`
  fails that one tool call and the **loop continues**, so drain must also call
  `agent.abort()` — the same pairing the existing turn-budget path uses. A test
  asserts the runner stops after revocation and starts no further tool call.
- **Requeue.** Only after the old run exits does the task transition
  `running → pending` and re-enqueue, reusing the transition already proven in
  `RecoverInterruptedTasks` (`src/app/task/recover-interrupted-tasks.ts`) rather
  than a second copy of it.
- **Idempotency + edge states.** Abandoning an already-abandoning task is a
  no-op; abandoning a task that is not `running` is a typed error naming the
  actual status; a task with no running job is a typed error; if the store holds
  several running jobs for one task, abandon refuses rather than guessing.
- **Event.** `task.abandoned` is added to `EVENT_TYPES` and to the `events.type`
  CHECK by a migration, carrying the `reason` in its payload; the existing
  "all EVENT_TYPES members are insertable" migration test still passes.
- **Read view.** `get task --json` exposes `abandoning` while a revoked run
  drains. `TASK_STATUSES` is NOT widened — `abandoning` is a marker on a
  `running` task, not a new lifecycle state.

Proof: `scripts/e2e/abandon-run-proof.sh` — deterministic, no model, no network,
through the real CLI with the `KANTHORD_FAKE_AGENT` seam and a live background
daemon that is **never killed to make an assertion pass**. Run from the repo
root:

```bash
scripts/e2e/abandon-run-proof.sh
```

It must print `013 ok: …`. Phases: **A** a scripted multi-turn run reaches
`running` · **B** `abandon task` returns while the daemon is still alive, and the
task reads `running` + `abandoning:true` · **C** the run drains at its next turn
boundary, after which the task is `pending` and re-enqueued, with a
`task.abandoned` event carrying the reason · **D** the fence held: no
`task.completed` / `task.failed` event for that task exists before the
`task.abandoned` event, so the abandoned run neither completed nor failed it ·
**E** the daemon — still the
same live process — picks the task up again under a new lease and runs it to
completion, proving abandon did not poison the queue.

## Stories

1. **Lease token on every claimed run.** Elevate the `jobs` row id to an explicit
   lease token in the queue port and thread it from claim through the runner. No
   behaviour change yet — this story only makes the identity available and
   proves the token reaches every write path.

2. **Fence the four write paths.** Task completion, task failure, task-result
   persistence, and terminal event append each require the lease token and verify
   it is current inside their own transaction, raising a typed `StaleLeaseError`
   otherwise. Revocation is a queue operation, not a task-status change.

3. **Revoke + drain semantics.** `AbandonTask` revokes the lease, marks the run
   abandoning, and returns without waiting. The runner observes revocation at the
   next `beforeToolCall` boundary and exits without starting another tool call.

4. **Requeue on exit.** When the drained run exits, the task transitions
   `running → pending` and is re-enqueued under a new lease, reusing
   `RecoverInterruptedTasks`' transition. `task.abandoned` is appended with the
   operator's reason.

5. **`task.abandoned` event type + migration.** Add to `EVENT_TYPES` and the
   `events.type` CHECK; payload carries `reason`.

6. **`abandon task` CLI + read view.** The command with `--id` and `--reason`,
   plus `abandoning` on `get task --json`. Typed errors map to non-zero exits
   with messages naming the actual status.

## Decisions

- **Revoke, drain, then requeue** (Ulrich, 2026-07-27). Chosen over three
  alternatives: fencing DB writes but requeueing immediately would let the old
  process keep mutating the shared initiative clone while the new run works in it
  (corrupt candidates, no error); terminating the process group is stronger but
  makes the daemon own process-group lifecycle for every run and can leave the
  clone dirty; per-run isolated workspaces are the cleanest long-term invariant
  but move workspace provisioning and the whole landing path. Drain gets the
  safety invariant with no process killing and no workspace redesign. The cost is
  accepted: abandon is not instant, and the UI shows `abandoning…`.
- **The lease token is the existing `jobs` row id, not a new identifier.** A job
  row is already created per claim and already unique; inventing a second
  identity would give two things to keep in sync.
- **Revocation is observed at the next tool-call boundary**, via a
  `beforeToolCall` hook this epic adds plus `agent.abort()`. Polling inside a
  tool call would require interrupting arbitrary tool code.
- **`abandoning` is a marker, not a status.** Widening `TASK_STATUSES` would
  touch every transition table and CHECK constraint for a transient condition.

## Non-goals

- **A run blocked inside a single endless tool call cannot be drained.** Drain
  happens at turn boundaries, so a tool call that never returns holds the lease
  forever; the task stays `abandoning` and the operator sees why. Forcing that
  case requires process termination — a later epic, deliberately deferred with
  the fence strategy Ulrich chose.
- **No cancel of a live agent process, no process-group management.**
- **No per-run isolated workspaces.**
- **No automatic abandonment on a timer.** Operator-invoked only; a hung-run
  heuristic is a separate concern.
- **No change to `TASK_STATUSES` or any transition table.**
