# Story 1 — F2: real token accounting in the pi runner

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

`PiAgentRunner` emits `agent.finished` with `tokensIn: "0", tokensOut: "0"`
literally on every run (`src/agent-runner/pi.ts:326-332`), while `turns` is real.
The 007.1 A6 safe-facts fields and the diagnostics-export tokens path exist but
always report ZERO — a confident `0` is worse than absent: the run looks free.

This story makes the runner sum **real** per-turn token usage and emit it. It
reuses pi's own `Usage` buckets and mirrors pi-coding-agent's
`getSessionStats()` summation (reuse-pi-first) rather than inventing an
interpretation. Usage is accumulated **as turns finish**, so failed, escalated,
and awaiting-confirmation runs still carry truthful usage — `agent.finished`
describes agent work, not successful task completion.

**No `TaskResult` change** — `turns`/`tokensIn`/`tokensOut` travel only in the
`agent.finished` emit payload, exactly as `turns` does today.

## Locked metric (tests assert this arithmetic verbatim)

For each `role === "assistant"` turn, read `message.usage: Usage`
(`@earendil-works/pi-ai`). Summing across **all** assistant turns of the run:

```
tokensIn  = Σ ( usage.input + usage.cacheRead + usage.cacheWrite )
tokensOut = Σ ( usage.output )
```

- `usage.reasoning` is a **subset of `usage.output`** — never add it separately.
- `usage.cacheWrite1h` is a **subset of `usage.cacheWrite`** — never add it
  separately.
- This is exactly the pi-coding-agent `getSessionStats()` summation
  (`…/pi/packages/coding-agent/src/core/agent-session.ts:3023-3076`), scoped to
  one run.
- Emitted as decimal strings (matching the current `turns: String(...)`
  contract): `tokensIn: String(totalIn)`, `tokensOut: String(totalOut)`.

## Constraints

- Accumulate in the existing `turn_end` subscriber (`pi.ts:485-492`) — it already
  fires per turn and its event carries `message` (the `AssistantMessage`). Use a
  `usageRef` ref object beside `turnCountRef` (`pi.ts:324`), incremented the same
  way, so usage is captured even when a later verification failure, escalation,
  or budget abort ends the run. Do NOT compute usage only in the `completed`
  branch.
- Do NOT use `getLastAssistantUsage()` (last snapshot only) or
  `calculateContextTokens()` (context size, includes output) — both are wrong for
  run totals.
- Guard against a turn whose `message` is not an assistant message or lacks
  `usage` (skip it); never throw from the subscriber.
- No new port, no `TaskResult` field, no schema change. Hermetic — no network.

## Verification Gate

`node --test src/agent-runner/pi.test.ts` green (fake pi `Agent`/session driving
the multi-turn usage fixture); `npm run typecheck` 0; `npm run lint` clean.

---

### Task T1 — sum real per-turn usage into the `agent.finished` emit

**Requires:** nothing beyond the pi runner + its existing test harness.

**Input:** `src/agent-runner/pi.ts`, `src/agent-runner/pi.test.ts`.

**Action — RED:** extend the runner test with a fake `Agent` whose subscribed
`turn_end` events deliver **≥3** assistant turns carrying a fixture with
non-zero `input`, `cacheRead`, `cacheWrite`, `output`, and `reasoning`
(and a `cacheWrite1h` on at least one turn). Assert the captured `agent.finished`
payload has:
(a) `tokensIn === String(Σ(input+cacheRead+cacheWrite))`;
(b) `tokensOut === String(Σ(output))`;
(c) `reasoning` is NOT added into either total (choose a fixture where adding it
would change the number);
(d) `cacheWrite1h` is NOT added on top of `cacheWrite`;
(e) each bucket counted exactly once (per-turn sums, not last-turn snapshot);
(f) a run that ends in `failed` (verification failure) and a run that ends in
`escalated` **still** emit non-zero `tokensIn/tokensOut` from the turns that ran.
Fails today: the payload is the literal `"0"`.

**Action — GREEN:** add a `usageRef = { in: 0, out: 0 }` ref beside
`turnCountRef`; in the `turn_end` subscriber, when `event.message` is an
assistant message with `usage`, add `usage.input + usage.cacheRead +
usage.cacheWrite` to `usageRef.in` and `usage.output` to `usageRef.out`. Replace
`tokensIn: "0", tokensOut: "0"` at `pi.ts:329-330` with
`tokensIn: String(usageRef.in), tokensOut: String(usageRef.out)`.

**Action — REFACTOR:** extract a module-internal `addAssistantUsage(ref, message)`
helper if the subscriber body grows; keep it beside the turn-count logic.

**Output:** `agent.finished` carries real, exactly-summed token counts for every
run outcome.

**Verify:** `node --test src/agent-runner/pi.test.ts` green; `npm run typecheck`
0; `npm run lint` clean.
