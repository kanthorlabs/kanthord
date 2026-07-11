# Task audit timeline (narrow observability spine)

When a task fails, an operator needs one question answered fast: **which step
was the root cause?** kanthord records a durable, append-only **task timeline**
anchored on `task_id + attempt`. Every record that already exists — attempt
evidence, interaction capture, the broker ledger, gate results, spawn/respawn
journal events, and per-model-call records — is threaded with one shared
`correlation_id`, so a single ordered timeline reconstructs from durable state
alone.

This is deliberately **narrow**: a correlation id plus one events table over the
records that already exist, not a general distributed-tracing substrate. Session
ids are **child** events on the timeline; the anchor is `task_id + attempt` so
the timeline survives a respawn.

> Scope: this page covers the **core** observability built in Epic 019.5 — the
> event log, per-call record, failure attribution, the `queryTaskTimeline`
> function, and the `kanthord timeline` CLI. Epic 026 exposes
> `ListTaskTimeline` and the outbound session-event stream over the
> control-plane API; Epic 027 renders the timeline in the dashboard — **both are
> wiring only, no logic**. The query logic is owned here.

## Reading a task timeline

Use the CLI to read a task's ordered timeline:

```sh
kanthord timeline <taskId>
kanthord timeline <taskId> --failures   # only the failing step(s)
```

The CLI drives the core `queryTaskTimeline(store, taskId, opts)` function
(`src/metrics/timeline-query.ts`) and reads durable records only — no network.
Each event prints one line:

```
[<ts>] kind=<kind> [signal=<observed_failure_signal>] [account_id=<id>] [model=<model>] [summary=<text>]
```

- `kind` — the record type (`attempt_evidence`, `model_call`, `gate_fail`,
  `session_respawned`, `root_cause_attribution`, …).
- `signal` — the machine-derived `observed_failure_signal`, present only on a
  failing event.
- `account_id` / `model` — present only on `model_call` events.

`--failures` filters to events whose `observed_failure_signal` is set, so an
operator lands directly on the root-cause step.

### Query shape (why it scales)

The timeline is **time-series data** that can grow large, so the query is built
to stay cheap:

- **Ordered by `event_id` (a ULID), newest-first by default.** Because ULIDs sort
  by creation time, ordering by the id column *is* chronological order — no
  separate timestamp sort. Pass `order: "asc"` for oldest-first.
- **Paged, not unbounded.** `queryTaskTimeline(store, taskId, { failuresOnly?,
  limit = 100, before?, order = "desc" })` returns one page (default 100). To page
  further, pass the last event's `event_id` as `before` — the scan returns the
  rows beyond that cursor.
- **A single-table scan, never a join.** The page comes from one indexed scan of
  `task_timeline_event` (`WHERE task_id = ?`, filtered and cursored by scan).
  `account_id`/`model` for the page's `model_call` rows are then fetched by **one
  follow-up query** (`SELECT … FROM model_call_log WHERE call_id IN (…)`) and
  merged in memory. Joining two large time-series tables is avoided on purpose.

## Machine signal vs human-confirmed cause

Attribution is **two tiers**, and the split is intentional:

1. **`observed_failure_signal` — machine, factual, narrow.** Derived from a
   concrete failure source by `deriveFailureSignal` (`src/metrics/failure-signal.ts`).
   The seven signals are:

   | Signal | Meaning |
   | --- | --- |
   | `rate_limited` | provider rate limit hit |
   | `quota_exhausted` | provider quota / billing cap reached |
   | `auth_failed` | credential rejected (401 / unauthorized) |
   | `tool_blocked` | a ring-1 tool call was denied |
   | `budget_breach` | the run hit its durable budget halt |
   | `broker_failed` | a broker op failed (incl. transient/fatal provider errors) |
   | `gate_failed` | the verification gate rejected the attempt |

2. **`suspected_root_cause` + `root_cause_confidence` — human/reviewer-confirmed,
   optional.** Interpretive causes ("the prompt was ambiguous", "the model
   behaved oddly") are **not** auto-classified. Only `setRootCauseAttribution`
   writes these fields, and machine code must never call it — a test asserts no
   machine code writes `suspected_root_cause`.

This honors the PRD posture: machine records factual signals; interpretive root
causes stay coarse, approximate, and human-confirmed.

### Typed provider-error taxonomy

Provider errors are classified by `classifyProviderError`
(`src/metrics/provider-error.ts`) into five kinds:
`rate_limited | quota_exhausted | auth_failed | transient | fatal`. A `fatal`
result carries a `detail` string with credential-looking tokens **redacted** and
bounded to 512 chars. This taxonomy is the shared prerequisite Epic 043's account
switch also depends on.

## Multi-account per-call attribution

Each model call records
`{task_id, attempt, session_id, account_id, model, tokens_in/out, cost, latency,
stop_reason, typed_error}` (`src/metrics/model-call-log.ts`). Because
`account_id` comes from Epic 019.4's durable binding, two attempts of one task
run on two different accounts each attribute their timeline events to the correct
account. When a model call is the failing step, the timeline shows the
`account_id` + `model` that served it.

## How the timeline reconstructs

`queryTaskTimeline` reconstructs the ordered timeline from durable records only:

- `task_timeline_event` — the append-only spine, anchored on
  `task_id + attempt + correlation_id`, ordered by its ULID `event_id`.
- `model_call_log` — read by a **second query** (`WHERE call_id IN (…)`) to enrich
  the page's `model_call` events with `account_id` + `model` (no join).

The `correlation_id` (derived as `"${taskId}:${attempt}"`) is threaded through
attempt-evidence, interaction capture, the broker ledger, gate results, and
spawn/respawn events, so events from every source line up on one timeline
ordered by `event_id` (ULID, i.e. creation order).

## Session events (the unlock)

pi's `Agent` emits tool-call / message / usage / stop-reason / error events via
`agent.subscribe`. The daemon surfaces these as **one outbound, read-only**
stream through the `PiSessionHandle` / `PiSurface` seam (`eventSink` on
`PiSpawnOpts`) — the source of per-call detail. The stream is **outbound only**:
there are **no inbound extension points**, so ring-1 hooks stay daemon-owned.
