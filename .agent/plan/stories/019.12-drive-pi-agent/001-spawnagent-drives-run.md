# Story 001 - spawnAgent drives the Agent run with the brief

Epic: `.agent/plan/epics/019.12-drive-pi-agent.md`

## Goal

The live `spawnAgent` delivers the assembled `systemPrompt` brief to the pi Agent
and drives its run loop (`agent.prompt(brief)`), so the agent actually works;
`waitForIdle` resolves only after that run completes. Today it constructs the
Agent but never prompts or runs it.

## Acceptance Criteria

- `spawnAgent`, given spawn opts that include a non-empty `systemPrompt`, drives
  the Agent's run with that brief exactly once (the Agent's `prompt` is invoked
  with the `systemPrompt` string) and returns a handle whose `waitForIdle`
  resolves only after that run has finished.
- The real-path Agent (`new Agent(agentOpts)`) is driven via its `prompt(input)`
  method; the run is kicked off at spawn time (not lazily), and `waitForIdle`
  awaits its completion (no resolve-before-run race).
- The existing spawn contract is preserved: `abort()` aborts the in-flight run,
  `reset()` clears state, `contextTokens` still reports; `model`/`streamFn`/tools/
  `beforeToolCall` wiring from Epic 019.6/019.1 is unchanged.
- When `systemPrompt` is absent/empty (defensive), `spawnAgent` does not throw;
  it simply drives no run (the daemon path always supplies a brief).

## Constraints

- **Use `agent.prompt(systemPrompt)`** (`pi-agent-core` Agent API) to start the
  run and `agent.waitForIdle()` to await it — do not reimplement the loop. Keep
  the initiating brief as the prompt input (the brief is self-contained; no
  separate system/user split in this epic).
- **Injectable agent seam stays testable** — extend the injected agent/handle so
  a test double records the brief it was driven with and controls when its run
  resolves, without a real model call. The existing `agentFactory` tests
  (Epic 019.6 RB1/T2) must keep passing (update their handle shape if needed —
  that is TE-lane).
- **No network in the hermetic test** — the double never calls a model; the
  zero-network guard stays green.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the drive test passes, existing
  spawnAgent tests pass, guard green.

### Task T1 - spawnAgent extracts the brief and drives the run

**Input:** `src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`

**Action - RED:** a hermetic test builds `buildRealDeps` with an injected agent
double whose `prompt(input)` records the input and whose run completes only when
the test releases it (or resolves immediately), and asserts: calling
`spawnAgent({ systemPrompt: "<brief>", model, streamFn, tools, beforeToolCall })`
invokes the double's `prompt` exactly once with `"<brief>"`, and the returned
handle's `waitForIdle()` resolves only after that run settles. Confirm the
existing spawn assertions (model/streamFn defaulting, tools, beforeToolCall) still
hold.

**Action - GREEN:** in `run-deps.ts spawnAgent`, extract `systemPrompt` from the
spawn opts; after constructing the Agent (real `new Agent(agentOpts)` or the
injected double), call `agent.prompt(systemPrompt)` to start the run, retain the
run promise, and make `waitForIdle` await both that run promise and
`agent.waitForIdle()`. Preserve `abort`/`reset`/`contextTokens` and the existing
model/streamFn/tool wiring.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/run-deps.test.ts` green.
