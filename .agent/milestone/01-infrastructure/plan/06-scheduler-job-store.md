# 06 Scheduler & Durable Job Store

Goal:             An in-process scheduler backed by a file-based durable job store,
                  so jobs survive restart and the runtime resumes them — including
                  jobs that became due while Core was down.

Decision anchors: D5 (file-based, in-process — no external broker), B5 (scheduler
                  enqueues durable jobs; the runtime claims them so restarts
                  resume), S3 (durable task model with explicit states), §3
                  Scheduler & Queue, N1 (single-writer + atomic + lock).

ACs:
- Jobs move through the exact states **`queued → claimed → running →
  {done | failed | cancelled}`**. Terminal states are final — a terminal job is
  never re-run.
- **Durable on enqueue:** an enqueued job is persisted before the call returns;
  after a restart, jobs left non-terminal (queued/claimed/running) are recovered
  from disk, not lost.
- **Due-on-restart catch-up:** a job scheduled for time T while Core is down is
  **fired on the next startup/reload** when it is found due — it is not skipped.
- **Claim before run:** the runtime atomically claims a job (`queued → claimed`)
  before running it; the same job cannot be claimed twice.
- **Startup reclaim (single-process rule):** because Core is single-writer /
  single-process, any job found in `claimed`/`running` at startup belongs to the
  dead prior instance and is reclaimed to `queued`. (No time-based stale threshold
  is needed while there is one claimer.) This implies **at-least-once** execution
  across a crash; the reclaimed job replays with its **persisted `callId`** so
  epic-09's durable idempotency key dedupes the re-run (a `completed` call-record
  is not re-executed; a non-idempotent tool left indeterminate is surfaced, not
  repeated).
- **Durable `callId`:** a job persists the `callId` of its side-effecting work so a
  reclaimed replay reuses the same idempotency key (epic 09).
- **Store-level cancellation:** a `queued` or `claimed` job can be transitioned to
  `cancelled` in the store and will not run. Cooperative abort of an already-
  **running** job (AbortSignal) is OUT of scope here — it belongs to epic 09.
- **Timing contract:** a timed job does **not** fire before its scheduled time;
  it fires when due (including after reload). Exact latency is not guaranteed
  (host sleep / pause / restart) and is not asserted; tests use a fake/short clock.
- **v1 jobs are one-shot; recurrence (cron-like) is deferred.**

Constraints:
- In-process timer + file-based durable job store (D5, B5); **no Bree, no PQueue,
  no Redis** (§3). Pure JS, no native (D2).
- Job records persist via the **epic-02 file-DB** (atomic write + lock +
  `version`); every state transition is atomic, and claim/reclaim use the epic-02
  lock (single-writer, no split-brain — N1).
- File layout (single jsonl vs one file per job) is the engineer's choice — S3
  left it open; not mandated.

Spike?:           none new — reuses the epic-02 atomicity/lock/reclaim findings.
                  The reclaim *policy* (startup reclaim) and catch-up are contracts
                  decided here, not external-API unknowns.

Verification:     `node:test` in a throwaway temp dir (never `.data/`): full state
                  machine incl. terminal-finality; enqueue persists before return;
                  restart recovery recovers non-terminal jobs and reclaims a stuck
                  `claimed`/`running` job to `queued`; a job due during downtime
                  fires on reload; claim prevents a second claim; store-level
                  cancel of a queued job; a future job does not fire early (fake
                  clock).

Dependencies:     01 (workspace), 02 (file-DB persistence + lock/reclaim). Pairs
                  with 09 (retryPolicy makes the at-least-once re-run safe; running-
                  job abort lives there).

Findings out:     none (reuses epic-02 findings).
