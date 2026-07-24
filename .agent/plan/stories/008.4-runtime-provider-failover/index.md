# EPIC 008.4 — Runtime provider failover on provider errors — stories

Epic: `.agent/plan/epics/008.4-runtime-provider-failover.md`
Prereq: EPIC 008.3 (daemon resolves the chain; runner takes a resolved provider;
`GlobalAiProvider` chain available in `run-next-task`).

On a typed provider-level error the runner fails over to the next provider in the
resolved chain and re-runs on a clean attempt; task-level failures never fail
over; each failover is an observable, redacted `provider.failover` event; chain
exhaustion fails with a typed aggregated reason.

## Dispatch order

1. **01** — typed provider-error provenance + fake seam (Story A).
2. **02** — failover loop + clean-attempt boundary (Story B).
3. **03** — task failures never fail over + verify-fail fixture (Story C).
4. **04** — `provider.failover` event type + migration 19 + exhaustion (Story D).

01 defines the signal + seam that 02 consumes; 04 defines the event type that
02's emit uses (do 04's `EVENT_TYPES`/migration edit before or with 02's emit so
the CHECK admits the type).

## Stories

- A — typed provider-error provenance + fake seam → `01-provider-error-seam.md`
- B — failover loop + clean-attempt boundary → `02-failover-loop.md`
- C — task failures never fail over → `03-no-failover-on-task-failure.md`
- D — event type + migration 19 + exhaustion → `04-event-and-exhaustion.md`

## Facts (needed for implementation)

- **Failover seam** = the transient-retry loop `src/app/task/run-next-task.ts:199-216`
  (re-runs `runner.run(runningTask, contextBindings)`; today only on
  `failed && transient===true`, bounded by `#maxAttempts=3`/`#maxElapsedMs`). The
  resolved `chain: GlobalAiProvider[]` is available from 008.3 Story A; the loop
  must walk it: pass `chain[i]` to `runner.run(task, bindings, chain[i])`.
- **Runner error path**: `src/agent-runner/pi.ts:417-423` — `sessions.for(...)`
  failure returns `{outcome:"failed", reason}` **without** `transient`. This is
  the provider-level error site. `TaskResult.failed` (`src/agent-runner/port.ts:29-34`)
  currently carries `transient?/retryAfterMs?` — add `providerError?: boolean;
reasonCode?: string`.
- **Fake seam**: `KANTHORD_FAKE_AGENT` read at `src/main.ts:35-43` →
  `fakeSessionFactoryFromTurns` (`src/agent-runner/fake-session.ts:62-75`, `.for()`
  ignores args). Add `KANTHORD_FAKE_FAIL_PROVIDERS` (comma-separated provider
  **names**) read in the same `main.ts` block, parametrizing the factory so
  `.for(aiProvider, …)` throws a typed provider error when
  `aiProvider.name`/`aiProvider.provider` is listed.
- **Events**: `EVENT_TYPES` (`src/domain/event.ts:3-27`) lacks `provider.failover`
  (has `provider.retry` for 007.9 same-provider transient retry — do NOT reuse).
  `newEvent(type,{taskId,payload})` (:40-48). The events `type` CHECK is rebuilt
  each time (template migration 12 `events_new5`, `migrations.ts:300-319`, six
  columns). **Migration 19** = `events_new6` copying all six columns + adding
  `'provider.failover'`.
- **task.failed** emitted in `run-next-task.ts:390-395` with `payload {reason,
attempts}`; Story D adds `reasonCode` (`provider_chain_exhausted` on exhaustion)
  - `providerReasons`.
- **New fixture**: `scripts/e2e/make-verify-fail-graph.sh` — clone
  `make-landing-graph.sh` but the root task's `.fake-agent.json` writes a file
  that FAILS its lightweight verification (e.g. writes to the wrong path so
  `test -f src/todo.mjs` fails), so the task fails at verification (task-level),
  not at the provider.
- **run-next-task tests**: `src/app/task/run-next-task.test.ts` — `FakeRunner`
  (`src/agent-runner/fake.ts`) with `failTransient`/`failTaskIds`; assert
  `feed.events.filter(e=>e.type===...)`. Extend `FakeRunner` to signal a
  `providerError` outcome for failover tests.
- **Migrations**: 008.1=16, 008.2=17, 008.3=18, **008.4 Story D = 19**.
- **`architecture.test.ts` counters**: unchanged in 008.4 (no leaf commands added
  or removed).
