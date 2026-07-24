# Story C — Task failures never fail over

Epic: `.agent/plan/epics/008.4-runtime-provider-failover.md`
Depends on: Story A (`providerError` signal), Story B (failover loop).

## Change

- **Guard in the loop** — `src/app/task/run-next-task.ts` (Story B loop): the
  failover branch fires **only** when `result.providerError === true`. A
  task-level failure (verify fail, bad work, budget, escalation, or any
  `outcome:"failed"` with `providerError` unset) returns immediately on the
  current provider — no `providerIdx` advance, no `provider.failover` event. This
  is a `providerError === true` condition check, not new state (Story B already
  branches on it); this story pins and tests the negative.
- **New fixture** — `scripts/e2e/make-verify-fail-graph.sh`: assemble a graph like
  `make-landing-graph.sh`, but the root task's `.fake-agent.json` scripted turn
  writes a file to the WRONG path (or writes invalid content) so the root task's
  lightweight verification (`test -f src/todo.mjs`) fails — the task fails at
  **verification** (task-level), with the fake session succeeding (no
  `providerError`). Mirror `make-landing-graph.sh`'s structure (delegates to
  `make-todo-graph.sh`, adds `.expected-output-path` + `.fake-agent.json`).

## Constraints

- Do not classify verify/workspace/git failures as provider errors (Story A
  already keeps `providerError` unset for these).

## Verify

- Extend `src/app/task/run-next-task.test.ts`: a `FakeRunner` returning
  `{outcome:"failed"}` with `providerError` **unset** (a task failure) over a
  `chain=[GOOD, BAD]` → task ends `failed`, `runner.run` called exactly once (no
  advance to `BAD`), and **no** `provider.failover` event is emitted.
- `npm run verify` exits 0 (the new script is lint/hygiene-clean).
- Proof (008.4 Proof block): delivers **PASS C1** (verification failure ⇒ task
  failed) and **PASS C2** (task/verify failure did NOT trigger failover — no
  `provider.failover` for that task on the `list event` feed).
