# Story 001 - session-event exposure (the unlock)

Epic: `.agent/plan/epics/019.5-task-audit-timeline.md`

## Goal

Surface pi's in-session events to the daemon as **one outbound, read-only** stream, so the
timeline (Story 002) and per-model-call record (Story 003) have a data source. Today
`PiSessionHandle` exposes only `abort/waitForIdle/reset/contextTokens/stopReason`; pi's
`Agent` already emits tool-call / message / usage / stop-reason / error events via
`agent.subscribe` — this story bridges them through the `PiSurface`/`PiSessionHandle` seam.

## Spike (gate)

**Why:** pi's `agent.subscribe` event surface is a pinned-dependency unknown — exactly
what fields each event carries, whether per-model-call **usage** and **account/model** are
observable per call, and the event ordering. Confirm it before the timeline depends on it.

**Do:** exercise `agent.subscribe` against a real pi Agent (reuse the Podman live-smoke
harness) and record: the event kinds emitted, the per-call `usage`/`stopReason`/
`errorMessage` fields, whether the active `model`/account is on each event, and ordering.
Write the result to the epic Findings-Out. If per-call account/usage is **not** observable
without a pi change, record the minimal adapter change and scope Story 003 accordingly.

## Acceptance Criteria

- `PiSessionHandle` exposes a **read-only** event subscription (e.g. `onEvent(cb)` /
  async iterator) that emits an ordered stream of session events: at least
  `tool_call`, `message`, `model_call` (with usage/stop-reason), and `error`.
- A spawned session (a double emitting scripted events) delivers those events, in order,
  to a daemon-side sink; the daemon can consume them without blocking the session.
- The stream is **outbound only** — no consumer can inject or alter a tool call / message
  through it (no inbound extension point; ring-1 hooks stay daemon-owned).
- Events carry the correlation anchor available at spawn (`task_id`, `attempt`,
  `session_id`) so downstream stories can thread them.

## Constraints

- **Bridge `agent.subscribe`, do not reimplement** — the session-event source is pi's
  `Agent` subscription (Decision Anchor: 026 feedback note; the spike confirms the
  surface). The daemon adapts it onto the existing `PiSurface`/`PiSessionHandle` seam.
- **Outbound, read-only** — a single sink (journal/event stream); inbound hooks remain
  daemon-owned (026 feedback: "do not expose code extension points inside ring-1").
- **Injected sink** — the daemon passes an event sink; hermetic tests use a capturing
  double emitting scripted events (no real model call; Epic 016 rule). The real surface is
  the spike + the 019.4 live proof.
- **Non-blocking** — consuming events must not stall the session `waitForIdle` path.

## Verification Gate

- `npm test` green for the session-event suite; typecheck 0; zero-network guard green.
- The spike result is recorded in Findings-Out before Story 003 is built.
- Ordered delivery, read-only (no inbound mutation), and correlation-anchor presence are
  asserted against a scripted-event double.

### Task T1 - session-event stream on PiSessionHandle

**Input:** `src/agent/pi-session.ts`, `src/agent/pi-session.test.ts`,
`src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a test spawns a session with a `PiSurface` double that emits scripted
`tool_call` → `model_call` → `error` events; asserts the daemon sink receives them in
order, each carrying `{task_id, attempt, session_id}`, and that the sink cannot mutate the
session (read-only). A second assertion: `waitForIdle` still resolves while events stream.

**Action - GREEN:** add a read-only event subscription to `PiSessionHandle`/`FakePiSurface`
+ `PiSurface`, forward pi `agent.subscribe` events to an injected daemon sink with the
spawn correlation anchor attached.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/pi-session.test.ts src/daemon/run-loop.test.ts` — T1
green.
