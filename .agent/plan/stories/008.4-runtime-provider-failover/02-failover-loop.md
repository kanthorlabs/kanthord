# Story B — Failover loop with a clean-attempt boundary

Epic: `.agent/plan/epics/008.4-runtime-provider-failover.md`
Depends on: Story A (`providerError` signal + fake seam), Story D (the
`provider.failover` event type must exist first).

## Change

- **Walk the chain on provider errors** — `src/app/task/run-next-task.ts`, the
  loop at :199-216. Track `let providerIdx = 0;`. Each iteration:
  `result = await runner.run(runningTask, contextBindings, chain[providerIdx]);`
  - If `result.outcome === "failed" && result.providerError === true` and
    `providerIdx + 1 < chain.length`: emit
    `newEvent("provider.failover", { taskId, payload: { from: chain[providerIdx].id,
to: chain[providerIdx+1].id, reasonCode: result.reasonCode ?? "provider_error" } })`,
    `providerIdx += 1`, and re-run (clean attempt, below). This is **separate**
    from the existing transient-retry branch (`transient===true`), which stays.
  - If `providerError` and no next provider → break (exhausted; Story D sets the
    typed reason).
  - Non-provider failure / success → existing behavior (transient retry or break).
- **Clean-attempt boundary** — before re-running on the next provider, reset to a
  pristine attempt: the runner re-does workspace `prepare` from the task's
  baseline each `run()` call (a session-creation provider error occurs **before**
  workspace prep, so no cleanup is needed for the Proof's case). For the
  **mid-stream** case, `run()` must re-prepare/reset the workspace to
  `baseCommit` and discard any files/partial commits from the failed attempt — a
  requirement on `PiAgentRunner` verified by unit test, not the shell Proof.
- **Provider-error attempts do not consume the transient budget** — advancing the
  provider is a separate counter from `#maxAttempts` (which stays for transient
  retries); the chain walk is bounded by `chain.length`.

## Constraints

- The transient-retry loop (007.9) is preserved unchanged for
  `transient===true`; failover is an added, orthogonal branch keyed on
  `providerError===true`.
- Failover only ever ranges over the resolved (active, logged-out-filtered) chain
  from 008.2/008.3.

## Verify

- Extend `src/app/task/run-next-task.test.ts` (extend `FakeRunner` to return
  `{outcome:"failed", providerError:true, reasonCode:"auth"}` for a named
  provider, success otherwise): with `chain=[BAD,GOOD]`, the task ends
  `completed`, a single `provider.failover` event is emitted with
  `payload.from=BAD.id, to=GOOD.id, reasonCode`, and `runner.run` was called with
  `BAD` then `GOOD`.
- `npm run verify` exits 0.
- Proof (008.4 Proof block): delivers **PASS A** (task fails over bad→good and
  lands) and **PASS B** (redacted `provider.failover{from,to,reasonCode}` on the
  `list event` feed).
