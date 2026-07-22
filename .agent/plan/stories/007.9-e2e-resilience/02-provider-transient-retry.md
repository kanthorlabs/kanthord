# Story 2 — provider transient-retry at the execution loop

Epic: `.agent/plan/epics/007.9-e2e-resilience.md`

## Goal

A transient upstream provider error currently fails the whole task at once. In
`RunNextTask.execute` (`src/app/task/run-next-task.ts:123`) the runner is
resolved and `run()` awaited; a `{ outcome: "failed", reason }` sets `failReason`
(`:130`) and tx2 persists the task as `failed` with no retry. In run `e2e-0079`
this turned a live OpenAI overload into 5 consecutive task failures over ~11 min
(`Codex error: Our servers are currently overloaded` / `... processing your
request`), each discarding the turns/tokens already spent.

This story makes the execution loop retry a **transient** failure — the whole
run, on a freshly-prepared workspace — with bounded, jittered backoff, and fail
only after retries exhaust. Classification is provider-specific (in the
adapter); the retry policy is provider-agnostic (in `RunNextTask`), so it
applies to the real pi runner and is exercised hermetically by `FakeRunner`.

## Investigation step (do first; record in the /work discussion)

Read `src/agent-runner/pi.ts` and `pi-session.ts` to determine whether Codex or
its SDK **already** retries transport / 429 / 5xx failures. The finding sets the
default max-attempt count so we do not stack a second retry layer on top of an
existing one. This does not change the test contract below.

## Contract (tests assert this)

1. **Transient signal on the failed result** (`src/agent-runner/port.ts`). Extend
   the failed `TaskResult` variant to `{ outcome: "failed"; reason: string;
transient?: boolean; retryAfterMs?: number }`. An adapter sets `transient:
true` only when re-running the **whole task** is safe (always true here — see
   Constraints).
2. **Adapter classification** (`src/agent-runner/pi.ts`). Map Codex errors:
   transient (`transient: true`) for documented overloaded / 5xx / 429 /
   clearly pre-acceptance transport failures; **fail-fast** (`transient` unset)
   for auth (401) and invalid-request (400). Prefer typed status over substring
   match; `"processing error"` counts as transient **only** when provably
   pre-acceptance. Surface `retryAfterMs` from a `Retry-After` header when
   present.
3. **Retry policy in `RunNextTask`** (wrap the `run()` call at `:123`–`:138`):
   - On `result.outcome === "failed" && result.transient` **and** attempts
     remain: append a `provider.retry` event `{ taskId, attempt, reason }`, wait
     `backoff(attempt)`, and re-invoke `runner.run(...)` (a fresh run — workspace
     prep re-establishes a clean base each call).
   - `backoff` = exponential base with **full jitter**, capped; honor
     `retryAfterMs` when the result carries it; enforce a **max total attempts**
     (injected via `opts`, small default from the investigation) **and** a
     **max elapsed time** bound.
   - On a **non-transient** failure, or once attempts/elapsed are exhausted:
     fall through to the existing failed path (tx2), with `failReason` = the
     **last** reason and a payload recording the total attempt count. A thrown
     error (`catch`, `:135`) stays a fail-fast failure (not retried) unless it is
     a typed transient error.
   - A `completed` / `candidate` / `escalated` result on any attempt is handled
     exactly as today.
4. **`FakeRunner` transient injection** (`src/agent-runner/fake.ts`). Add
   `failTransient?: Record<string, number>` (task id → number of leading
   transient failures). `run()` returns `{ outcome: "failed", reason: "scripted
transient failure", transient: true }` and decrements the counter while it is
   `> 0`, then behaves normally. Existing `failTaskIds` (permanent, non-transient
   `"scripted failure"`) is unchanged and must stay non-retried.
5. **Daemon wiring.** `--fail-transient <id>:<count>` (repeatable) parses in
   `src/apps/cli/daemon.ts` (beside the existing `--fail` normalisation, `:37`)
   and threads through `buildDaemon` (`src/composition.ts:299`) into the
   `FakeRunner` constructor (`:301`). Register the CLI option in
   `src/apps/cli/commands/run/daemon.ts` beside `--fail`.

## Constraints

- **Only whole-task retry** — no mid-session resume, no in-place continuation.
  Each retry re-runs `runner.run()`, which re-prepares the workspace from a clean
  base, so no partial state carries across attempts (the proven-safe boundary;
  the debate's B4/B5 concern is resolved by never resuming). Do **not** add
  adapter-internal per-call retry in this story.
- Surgical: the only structural change to `RunNextTask` is wrapping the existing
  run-and-map block in a retry loop between tx1 and tx2. Do not change tx1, tx2,
  the readiness re-scan, or any non-failed outcome handling.
- Do not retry non-transient failures or `UnknownAgentError` — fail-fast, as
  today.
- Exhaustion must fail loudly with the real terminal reason + attempt count;
  never report a persistent outage as success (no masking).
- `provider.retry` is a new event type; keep its payload string-valued to match
  the existing feed contract.

## Verification Gate

- `node --test src/app/task/run-next-task.test.ts` — with a fake runner scripted
  per attempt and a controllable clock/backoff:
  - 2 transient failures then a completed run → task ends `completed`; exactly
    **2** `provider.retry` events; `runner.run` called 3×.
  - transient failures beyond the cap → task ends `failed`; `failReason` = last
    reason; attempt-count recorded; no more than the cap of `run` calls.
  - a **non-transient** `{failed}` (e.g. `failTaskIds`) → failed on first
    attempt; **zero** `provider.retry` events (regression guard).
  - `retryAfterMs` on the result is honored by the backoff (assert via the fake
    clock).
- `node --test src/agent-runner/fake.test.ts` — `failTransient` decrements and
  then succeeds; `failTaskIds` stays permanently failed and non-transient.
- `node --test src/apps/cli/daemon.test.ts` — `--fail-transient <id>:<n>` parses
  and reaches the `FakeRunner`.
- `npm run verify` exits 0.
- Delivers the epic's **Proof B** (a fake-agent task that fails transiently 2×
  still reaches `awaiting_confirmation`, with ≥2 `provider.retry` events).
