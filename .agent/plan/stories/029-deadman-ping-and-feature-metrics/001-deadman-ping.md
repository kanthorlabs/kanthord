# Story 001 - Dead-Man Ping

Epic: `.agent/plan/epics/029-deadman-ping-and-feature-metrics.md`

## Goal

Once a day the daemon tells the human it is alive and how much it actually did
— through the broker's `slack.dm` — with an idle day explicitly called out, a
failed send escalated, and the schedule surviving restarts.

## Acceptance Criteria

- The schedule follows the Epic 029 fixed semantics: once per calendar day in
  the ops timezone at the configured time; a boundary missed while down sends
  at startup iff the ops day has no successful ping; first boot sends one
  (each case asserted on the fake clock).
- The message contains: alive marker, tasks processed **in the scheduled day
  window** (accounting independent of delivery — a failed prior ping's counts
  are not rolled up; the next ping notes the failed delivery), pending +
  in_flight op counts (Epic 005 states, global), open escalation count; a
  failing count source yields a "counts unavailable" marker, not a blocked
  ping; the body matches the documented example shape (asserted).
- N==0 renders the explicit idle-warning form ("processed 0 tasks — possible
  silent idle") — an alive-but-idle day is detectable from content (phases.md
  2B criterion).
- Two boundary crossings produce two pings with disjoint day windows.
- The ping goes through `slack.dm` with idempotency key = daemon instance id +
  ops date (a retried send cannot double-ping); a send that exhausts retries
  records a **durable open escalation in the local inbox store** — not another
  Slack attempt (broker-independent failure path).
- A missing operator DM target is a config load error.
- Last-ping time + outcome persist durably; after a daemon restart the next
  fire time derives from the durable state (a restart neither skips nor
  duplicates the day's ping — both directions asserted).
- The Epic 026 daemon-ops surface reports last-ping time + outcome.

## Constraints

- Scheduled on the injectable clock (Epic 001) — no real timers; the slack
  double from Epic 022 Story 004.
- The tasks-processed count derives from existing journal/scheduler state — no
  new counter store (division of truth, PRD §6.1).

## Verification Gate

- `npm test` green for `src/ops/deadman-ping.test.ts`.

### Task T1 - Daily fire + content + idle form

**Input:** `src/ops/deadman-ping.ts`, `src/ops/deadman-ping.test.ts`

**Action - RED:** Write tests: (a) one boundary ⇒ one ping matching the example
shape; (b) two boundaries ⇒ two pings, disjoint day windows; (c) N==0 ⇒
idle-warning form; (d) boundary missed while down ⇒ startup send iff none for
the ops day; first boot ⇒ one ping; (e) failed count source ⇒ "counts
unavailable" marker.

**Action - GREEN:** Implement the schedule + message composition over clock,
journal state, and `slack.dm`.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Failure escalation + restart durability + status surface

**Input:** `src/ops/deadman-ping.ts`, `src/ops/deadman-ping.test.ts`

**Action - RED:** Write tests: (a) exhausted `slack.dm` retries ⇒ durable open
inbox escalation naming the ping (locally stored, no further Slack call);
(b) restart mid-day neither skips nor double-fires (both directions); (c) the
day's failed counts stay in that day — the next ping notes the failed
delivery; (d) same-ops-day retry uses the same instance+date idempotency key;
(e) missing DM target ⇒ config load error; (f) daemon-ops view shows last-ping
time + outcome.

**Action - GREEN:** Implement durable last-ping state + restart derivation +
the status field.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
