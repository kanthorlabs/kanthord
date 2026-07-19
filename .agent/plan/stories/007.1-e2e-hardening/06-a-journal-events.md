# Story 06 — A: private journal — un-throttle capture + verification/turn/token events

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

The private SQLite `events` journal is the authoritative, local-only, un-throttled
record. Three missing data points are added so the `diagnostics export` (Story 09)
has something to project:

- **A3** — every `agent.progress` tool call is captured (not 1-per-5s). The 1-per-5s
  cap moves to the `events` feed DISPLAY in `runEvents` (human mode only; `--json`
  always emits all events).
- **A4** — verification runs emit `task.verification` journal events with
  `verifierKind`, `phase`, `exitClass`, `durationMs`, and `timedOut` fields.
- **A6** — `agent.finished` carries numeric turn/token fields (`turns`,
  `tokensIn`, `tokensOut`) as string-serialized values in the payload.

Migration 7 (anchored by Story 01 T3) is extended to recreate the `events`
table so its `type` CHECK includes `"task.verification"`.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/domain/event.ts — EVENT_TYPES gains one new entry
export const EVENT_TYPES = [
  "task.created",
  "task.ready",
  "task.started",
  "task.completed",
  "task.failed",
  "task.dependencies_changed",
  "task.escalated",
  "task.approved",
  "task.rejected",
  "task.discarded",
  "task.blocked",
  "agent.started",
  "agent.progress",
  "agent.finished",
  "task.verification", // NEW — A4
] as const;
export type EventType = (typeof EVENT_TYPES)[number]; // type-checks unchanged users

// A4 — task.verification payload keys (all values are strings per Event.payload):
// { verifierKind: "cmd",
//   phase: "start" | "end",
//   exitClass?: "pass" | "fail" | "timeout",   // present on phase "end"
//   durationMs?: string,                       // numeric ms as string, phase "end"
//   timedOut?:   "true" | "false" }            // phase "end"
//
// Emitted in PiAgentRunner.#doRun via this.#emit(task.id, "task.verification", payload)
// — once before runVerificationCmd (phase:"start"), once after (phase:"end").

// A6 — agent.finished payload gains:
// { outcome: string, turns: string, tokensIn: string, tokensOut: string }
// turns   = String(turnCount)   (already tracked in PiAgentRunner)
// tokensIn/tokensOut = from agent.state usage data if pi-agent-core exposes it;
//                      "0" as a guarded placeholder when not available.
// Grep the installed @earendil-works/pi-agent-core .d.ts for agent.state.usage
// before implementing; do NOT guess the field name.
```

```ts
// src/storage/sqlite/migrations.ts — migration 7 extension
// Story 01 T3 appended migration 7 with name "epic-007.1-e2e-hardening".
// This story EXTENDS the migration 7 DDL (before it is applied to any DB):
// add the events table recreate that widens the type CHECK to include
// "task.verification".
//
// DDL to add (after the Story 01 resource columns):
//   CREATE TABLE events_new2 (
//     id     TEXT PRIMARY KEY,
//     type   TEXT NOT NULL CHECK (type IN (
//              'task.created','task.ready','task.started','task.completed',
//              'task.failed','task.dependencies_changed','task.escalated',
//              'task.approved','task.rejected','task.discarded','task.blocked',
//              'agent.started','agent.progress','agent.finished',
//              'task.verification'  -- NEW
//            )),
//     taskId TEXT NOT NULL REFERENCES tasks(id),
//     payload TEXT
//   );
//   INSERT INTO events_new2 SELECT * FROM events;
//   DROP TABLE events;
//   ALTER TABLE events_new2 RENAME TO events;
```

```ts
// src/apps/cli/events.ts — display-side throttle (A3)
// Track lastProgressShownMs per taskId in a Map<string, number>.
// In human (non-JSON) mode: skip printing an agent.progress event for a taskId
// if the same taskId was printed within the last 5000 ms (wall-clock at display time).
// JSON mode: always emit all events (no throttle).
// The Map is local to each runEvents call — not persisted.
```

## Constraints

- `src/domain/event.ts` imports nothing outside `src/domain/`. The constant
  addition is the only change; the `newEvent` function and `Event` interface
  are unchanged.
- `Event.payload` remains `Record<string, string>`. All new fields (durationMs,
  turns, tokensIn, tokensOut, timedOut) are stored as string representations and
  parsed by the consumer (Story 09 export). Do NOT change the payload type.
- The throttle gate in `src/agent-runner/pi.ts` (the `lastProgressAt` block and
  all `now`/`lastProgressAt` variables in the `tool_execution_start` subscribe
  callback) is removed entirely. The display throttle is the ONLY place this cap
  lives.
- Migration 7 DDL must not use `CREATE TABLE IF NOT EXISTS` — the `user_version`
  guard is the idempotency mechanism (per the codebase convention). The events
  table recreate uses a temporary name `events_new2` to avoid conflict with
  migration 5's `events_new`.
- This story does NOT fix A7 (`base_commit` null) — that is Story 11's scope.

## Verification Gate

- `node --test src/domain/event.test.ts` — `EVENT_TYPES` includes
  `"task.verification"` and `EventType` is assignable from it.
- `node --test src/agent-runner/pi.test.ts` — (a) 3 consecutive `tool_execution_start`
  events produce 3 `agent.progress` emissions (no gate); (b) `agent.finished`
  payload carries `turns`, `tokensIn`, `tokensOut` keys; (c) a task with 1
  verification command emits 2 `task.verification` events (phase "start" then
  "end"); the "end" event payload carries `exitClass`, `durationMs`, `timedOut`.
- `node --test src/apps/cli/events.test.ts` — (a) human mode: 3 consecutive
  `agent.progress` events for the same taskId within 1 s produce 1 output line;
  (b) `--json` mode: same 3 events produce 3 output lines.
- `npm run typecheck && npm run lint` clean.

---

### Task T1 — extend migration 7 + EVENT_TYPES domain change

**Requires:** Story 01 T3 (migration 7 appended and named; `events` table exists in
its migration-5 shape at the time story 06 starts).

**Input:** `src/domain/event.ts`, `src/domain/event.test.ts`,
`src/storage/sqlite/migrations.ts`.

**Action — RED:** In `src/domain/event.test.ts`: assert `EVENT_TYPES.includes(
"task.verification" as EventType)` and that `"task.unknown"` is not assignable to
`EventType` (compile-time). Also assert that migrating a fresh in-memory SQLite DB
to version 7 and then inserting an event row with `type = "task.verification"`
succeeds, and with `type = "task.unknown"` throws a CHECK violation. Fails today:
`"task.verification"` is absent from `EVENT_TYPES`; the migration 7 DDL does not
recreate the events table.

**Action — GREEN:** Add `"task.verification"` to the `EVENT_TYPES` array in
`src/domain/event.ts`. Extend the migration 7 `up` function in
`src/storage/sqlite/migrations.ts` with the events table recreate DDL (see Locked
contracts above) — append the DDL to the end of the existing migration 7 `up` body.

**Action — REFACTOR:** None.

**Output:** `EventType` includes `"task.verification"`; migration 7 recreates the
events table with the widened type CHECK; existing event rows are preserved.

**Verify:** `node --test src/domain/event.test.ts` green; `npm run typecheck` exit 0.

---

### Task T2 — A3: un-throttle capture; add display throttle

**Requires:** T1.

**Input:** `src/agent-runner/pi.ts`, `src/agent-runner/pi.test.ts`,
`src/apps/cli/events.ts`, `src/apps/cli/events.test.ts`.

**Action — RED:**

- In `src/agent-runner/pi.test.ts`: inject a fake clock; fire 3 `tool_execution_start`
  events within 1000 ms; assert `emit` was called exactly 3 times with type
  `"agent.progress"`. Fails today: the 1-per-5s gate allows only 1.
- In `src/apps/cli/events.test.ts`: create a fake `listEvents` returning 3
  `agent.progress` events for the same `taskId` with no time gap; call `runEvents`
  in human (non-JSON) mode; assert `stderr.length === 1` (only the first is shown).
  Call again with `--json`; assert `stdout.length === 3`. Fails today: no
  display throttle exists.

**Action — GREEN:**

- In `src/agent-runner/pi.ts`: remove the `lastProgressAt` variable, the
  `now` assignment inside the `tool_execution_start` subscribe callback, and the
  `if (lastProgressAt === undefined || now - lastProgressAt >= 5000)` guard.
  Keep the `emit` call and the `buildSummary` call unchanged — emit on every
  `tool_execution_start`.
- In `src/apps/cli/events.ts`: add `const lastProgressMs = new Map<string,
number>()` before the loop. In the event-printing block, when `event.type ===
"agent.progress"` and `!json`: check `Date.now() - (lastProgressMs.get(
event.taskId) ?? 0) < 5000`; if true, skip the line; otherwise update the map
  and print. JSON mode skips the check entirely.

**Action — REFACTOR:** None.

**Output:** Every tool-call occurrence is captured in the journal; the human events
display throttles `agent.progress` at 5 s per taskId.

**Verify:** `node --test src/agent-runner/pi.test.ts src/apps/cli/events.test.ts`
green; `npm run typecheck` exit 0.

---

### Task T3 — A4: emit task.verification events

**Requires:** T1, T2.

**Input:** `src/agent-runner/pi.ts`, `src/agent-runner/pi.test.ts`.

**Action — RED:** In `src/agent-runner/pi.test.ts`: run a `#doRun` scenario with
a fake verifier that executes 1 verification command (exit 0); assert the captured
`emit` calls include 2 events of type `"task.verification"`: one with `phase:
"start"` before the command runs, and one with `phase: "end"` after — the end
event must carry `exitClass: "pass"`, a `durationMs` string parseable as a
non-negative integer, and `timedOut: "false"`. Also test a failing command (exit 1):
assert end event `exitClass: "fail"`. Fails today: no `task.verification` events
are emitted.

**Action — GREEN:** In `PiAgentRunner.#doRun`, wrap the `runVerificationCmd` call
inside the verification loop:

1. Before the call: `this.#emit(task.id, "task.verification", { verifierKind: "cmd", phase: "start" })`.
2. Record `const t0 = this.#clock()`.
3. Call `runVerificationCmd`. Record `const t1 = this.#clock()`.
4. Determine `timedOut` (`ev.exitCode === -1` = timeout or spawn error).
5. After the call: `this.#emit(task.id, "task.verification", { verifierKind: "cmd", phase: "end", exitClass: ev.exitCode === 0 ? "pass" : (timedOut ? "timeout" : "fail"), durationMs: String(t1 - t0), timedOut: timedOut ? "true" : "false" })`.
   Do NOT include the command text or output in the payload (sanitization rule).

**Action — REFACTOR:** If the before/after emit pattern is repeated for multiple
commands, extract a small synchronous `emitVerif(phase, extra?)` closure (captures
`task.id` and `this.#emit`).

**Output:** Each verification command produces a `start` and `end` journal event;
timing and exit outcome recorded; command text never in payload.

**Verify:** `node --test src/agent-runner/pi.test.ts` green; `npm run typecheck` 0.

---

### Task T4 — A6: turn/token fields in agent.finished

**Requires:** T1, T2, T3.

**Input:** `src/agent-runner/pi.ts`, `src/agent-runner/pi.test.ts`.

**Action — RED:** In `src/agent-runner/pi.test.ts`: run a full scenario to
completion; assert the `agent.finished` emit call's payload contains all four
keys `outcome`, `turns`, `tokensIn`, `tokensOut`; and that `parseInt(payload.turns, 10)`
equals the number of `turn_end` events the fake agent fired. Fails today: payload
has only `{ outcome }`.

**Action — GREEN:** In `PiAgentRunner.run()` (the public outer method that calls
`#doRun` and then emits `agent.finished`): pass extended payload:

```ts
this.#emit(task.id, "agent.finished", {
  outcome: result.outcome,
  turns: String(turnCount),
  tokensIn: String(/* agent.state usage field if available, else */ 0),
  tokensOut: String(/* agent.state usage field if available, else */ 0),
});
```

Before implementing `tokensIn`/`tokensOut`: grep the installed
`node_modules/@earendil-works/pi-agent-core` `.d.ts` files for `usage`, `inputTokens`,
`outputTokens`, or `promptTokens` on `AgentState`. If found, use those fields;
if absent, use `0` as an explicit placeholder — do NOT guess a field name (a
wrong field name silently yields `NaN` which is worse than `0`).
Move `turnCount` out of the turn-budget subscribe block into the outer scope of
`#doRun` so it is readable when emitting `agent.finished`.

**Action — REFACTOR:** None.

**Output:** Every `agent.finished` event carries `turns`, `tokensIn`, `tokensOut`;
the turn count matches the actual number of turns.

**Verify:** `node --test src/agent-runner/pi.test.ts` green; `npm run typecheck` 0;
`npm run verify` clean.
