# Story 002 - record each model call in model_call_log

Epic: `.agent/plan/epics/019.13-agent-workspace-and-model-log.md`

## Goal

Each model call made by a live session appends a `model_call_log` row (via the
existing `appendModelCallRecord`), so cost/token attribution is observable — the
LP-A1 run should show model-call rows. Today `appendModelCallRecord` has no live
caller.

## Acceptance Criteria

- When the live agent completes a model response, a `model_call_log` row is
  appended with: the session's `task_id`, the resolved `account_id`, the `model`
  id, and the response's token usage (`tokens_in`/`tokens_out`/`cost`); remaining
  columns (`attempt`, `session_id`, `latency_ms`, `stop_reason`, `correlation_id`)
  are set from what is available or sensible defaults.
- Two model responses in a session produce two rows; a session with no model call
  produces none.
- The recording never throws into the agent loop (a logging failure must not abort
  the run) and never logs a secret.

## Constraints

- **Use `appendModelCallRecord`** (`metrics/model-call-log.ts`) unchanged, driven
  from the pi `onResponse` seam (`AgentOptions.onResponse`, `pi-ai` `Usage` /
  `calculateCost` for cost) — no new metrics schema or write path.
- **Fields threaded, not invented** — `task_id` from the spawn opts,
  `account_id`/`model` from the resolved provider session; usage from the
  response. Defaults only where pi does not supply a value.
- **Non-fatal** — wrap the append so an error is swallowed (best-effort
  observability), matching the metrics-capture posture.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the model-call-record test
  passes; existing tests pass; guard green (no network — the test invokes the
  captured `onResponse` with a synthetic response).

### Task T1 - append a model_call_log row per response

**Input:** `src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`,
`src/agent/pi-session.ts`, `src/cli/bootstrap-live-run.ts` (thread `task_id` /
`account_id` to `spawnAgent` if not already available)

**Action - RED:** a hermetic test builds `buildRealDeps` (with the store + a
resolved account id + a `task_id` supplied via spawn opts), calls `spawnAgent`,
captures the `onResponse` hook installed on the agent options (via the injected
agent double or by inspecting the constructed options), invokes it with a
synthetic `ProviderResponse` carrying a known token usage, and asserts a
`model_call_log` row was appended with that `task_id`, `account_id`, `model`, and
token counts. A second invocation appends a second row; a failing append does not
throw.

**Action - GREEN:** in `run-deps.ts spawnAgent`, install an `onResponse` hook in
the agent options that calls `appendModelCallRecord(store, {…})` with the threaded
`task_id`/`account_id`/`model` and the response usage (best-effort, wrapped so it
never throws into the loop). Thread `task_id` from the spawn opts and `account_id`
from the deps (resolved provider account).

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/run-deps.test.ts` green.
