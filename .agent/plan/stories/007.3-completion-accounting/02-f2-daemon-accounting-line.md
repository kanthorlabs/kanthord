# Story 2 — F2: daemon accounting stdout line

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

The daemon prints one `task <id>: <outcome>` line per non-idle outcome
(`src/app/task/run-daemon.ts:93-95`) and the emit callback logs `agent.started`
and `task.verification` (`src/composition.ts:285-297`) — but there is **no**
`agent.finished` line, so real token counts (Story 1) never reach the owner's
terminal. This story adds a dedicated `agent finished` stdout line, decoupled
from task completion, so changed tasks that stop at `awaiting_confirmation` and
failed/escalated runs also report usage.

## Locked output format (the epic Proof greps this verbatim)

The line MUST match `agent finished: turns=[0-9]+ tokensIn=[1-9][0-9]* tokensOut=[1-9][0-9]*`
for a real run. Emit:

```
task <taskId>: agent finished: turns=<turns> tokensIn=<tokensIn> tokensOut=<tokensOut>
```

using the `turns/tokensIn/tokensOut` values from the `agent.finished` payload
(Story 1). It is emitted from the **emit callback** (which sees every
`agent.finished`, regardless of task outcome), NOT from the `run-daemon.ts`
outcome line.

## Constraints

- Add one `else if (type === "agent.finished")` branch to the emit callback at
  `composition.ts:285-297`; read `payload.turns / payload.tokensIn /
payload.tokensOut`. Keep appending the event to `events` unchanged.
- Do NOT couple this to the `run-daemon.ts` completion line, and do NOT remove or
  alter that line.
- Use the same `effectiveLogger.info` seam the other emit-callback lines use — no
  `console.log`.

## Verification Gate

The composition/daemon test that exercises the emit callback shows the
`agent finished:` line for a run that finishes without completing the task;
`npm run typecheck` 0; `npm run lint` clean.

---

### Task T1 — emit `agent finished` from the emit callback

**Requires:** Story 1 (the payload must carry real `tokensIn/tokensOut`).

**Input:** `src/composition.ts` and the test that covers the daemon emit callback
(extend the existing composition/daemon test; if none isolates the callback, add
a focused test that invokes the callback with an `agent.finished` payload and a
fake logger).

**Action — RED:** a test that drives the emit callback with
`("t1", "agent.finished", { outcome, turns: "8", tokensIn: "1234", tokensOut:
"567" })` and asserts the fake logger received
`task t1: agent finished: turns=8 tokensIn=1234 tokensOut=567`. Also assert the
event was still appended to the feed. Fails today: no such branch, no such line.

**Action — GREEN:** add the `agent.finished` branch to the emit callback
producing the locked line; leave `events.append(...)` intact.

**Action — REFACTOR:** none.

**Output:** the daemon prints a truthful per-agent-finished accounting line,
decoupled from task completion.

**Verify:** the emit-callback test green; `npm run typecheck` 0; `npm run lint`
clean.
