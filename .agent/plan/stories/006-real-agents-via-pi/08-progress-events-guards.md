# Story 08 — Progress events, redaction & budget guards

Epic: `.agent/plan/epics/006-real-agents-via-pi.md`

## Goal

The agent's life shows in the event feed (throttled, secret-free), a turn
budget bounds every run via `Agent.abort()`, and no runner path can hang or
crash the daemon.

## Acceptance Criteria

- PiAgentRunner ctor gains `{ emit: (taskId: string, type: EventType,
  payload: Record<string, string>) => void; clock: () => number; maxTurns?:
  number }` (defaults: no-op, `Date.now`, 50). Per-run emissions:
  - `agent.started { workspace }` after workspace prep;
  - `agent.progress { tool, summary }` from subscribed tool-call events —
    `summary` = tool name + its primary path argument only (NEVER raw tool
    arguments), ≤ 200 chars; throttled to at most one per 5000 ms per run
    (first immediate, later ones inside the window dropped);
  - `agent.finished { outcome, evidence? }` always (all three outcomes;
    `evidence` = the verification evidence string when verify ran).
- **Redaction (D0 consequence — the secret now lives in the DB):** the
  runner builds a redactor from the resolved credential value; every
  persisted `reason`/`summary`/payload string passes it (occurrences
  replaced with `***`). Applies to task failures, event payloads, and
  TaskResult summaries.
- Budget: turns counted from the subscribed pi Agent turn events;
  count > `maxTurns` → `Agent.abort()` (verified export,
  `pi-agent-core/dist/agent.d.ts:96`; `waitForIdle()` settles after
  abort) → failed `BudgetExceededError: exceeded <n> turns`, with
  `agent.finished { outcome: 'failed' }` still emitted.
- main.ts: `emit` wired to `EventFeed.append(newEvent(type, { taskId },
  payload))` — synchronous append, so event order holds; the runner never
  imports storage. `KANTHORD_MAX_TURNS` parsed at startup (invalid → one
  stderr line, exit 1; unset → 50).

## Constraints

- Throttle and budget are deterministic under the injected clock/fake
  session — no timers in tests.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — event emission + throttle + redaction

**Requires:** S05-T1; S06-T1; S02-T1 (event literals).

**Input:** `src/agent-runner/pi.ts` (+ tests).

**Action — RED:** hermetic tests with fake clock + recording emit: (a) a
happy run emits `agent.started` → ≥1 `agent.progress` →
`agent.finished{completed}`, in order, each carrying the task id; (b)
three scripted tool calls inside 5 s → exactly one progress; a fourth
after the window → a second; (c) a failed run and an escalated run each
still emit `agent.finished` with their outcome; (d) a scripted tool call
whose arguments contain the credential value → no emitted payload contains
it; a scripted provider error embedding the value → the persisted reason
shows `***`; (e) progress summaries never exceed 200 chars. Fails today:
emission absent.

**Action — GREEN:** implement subscribe → emit mapping, the 5000 ms
throttle, and the redactor.

**Action — REFACTOR:** none.

**Output:** `events --after 0` tells the agent's story without flooding or
leaking.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — turn budget + env wiring

**Requires:** T1; S05-T2.

**Input:** `src/agent-runner/pi.ts`, `src/main.ts` (+ tests).

**Action — RED:** tests: (a) a scripted session that tool-calls every turn
with `maxTurns 3` → failed `BudgetExceededError: exceeded 3 turns` after
three turns via `abort()` (the test's own completion proves boundedness),
`agent.finished{failed}` emitted; (b) `KANTHORD_MAX_TURNS=abc` → startup
error exit 1; unset → default 50 reaches the runner. Fails today: budget
absent.

**Action — GREEN:** implement the counter + abort + env parse in main.

**Action — REFACTOR:** none.

**Output:** a runaway agent is a bounded, named task failure.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
