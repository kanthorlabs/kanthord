# Story 005 - event feed

Epic: `.agent/plan/epics/003-persistence-queue-events.md`

## Goal

The storage half of pull-based notifications: append-only events with
cursor reads, proving a poller sees every event exactly once across
polls.

## Acceptance Criteria

- `src/events/port.ts`: `EventFeed { append(event: Event): void;
  readAfter(cursor: string, limit?: number): Event[] }`.
- `readAfter` returns events with `id > cursor` ascending, at most
  `limit` (default 100). `limit` must be a positive integer — anything
  else throws `RangeError` (debate finding). `'0'` (below any current
  ULID) reads from the start — the EPIC 005 CLI contract
  `events --after 0` builds on this.
- **Cursor-safety precondition (debate finding):** correctness requires
  appended ids to be strictly increasing. That holds because all events
  come from `newEvent` in one single-writer process (EPIC 002 S006
  asserts strictly increasing successive ids). Documented on the port;
  events from foreign id sources are out of contract.
- Exactly-once polling: repeatedly calling `readAfter(cursor, n)` and
  advancing `cursor` to the last returned id yields every appended event
  exactly once, across appends interleaved between polls.

## Constraints

- Adapter `src/events/sqlite.ts` (`SqliteEventFeed`),
  constructor-injected `DatabaseSync`. Events are never updated or
  deleted (append-only; no retention — epic non-goal). `Event.payload`
  stays deferred — EPIC 005 adds the column with its own migration when
  the failure reason lands.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - port + adapter + poller proof

**Requires:** S002-T1 (schema: `events`); EPIC 002 S006 (`Event`,
`newEvent`).

**Input:** `src/events/port.ts` (new), `src/events/sqlite.ts` (new),
`src/events/sqlite.test.ts` (new); consumes `Event`/`newEvent` from
`domain/event.ts`, `openDatabase`, `MIGRATIONS` (test-side).

**Action - RED:** temp-DB tests (task rows seeded for FK): (a) append
three events, `readAfter('0')` returns all three in `id` order; (b) with
`cursor` = last id, append two more, `readAfter(cursor)` returns exactly
the two new ones; (c) `readAfter(<latest id>)` → `[]`; (d) paging with
page size 2 over 5 events, with one append between polls, yields all
events exactly once — no gap, no duplicate; (e) `limit` 0, -1, and 1.5
each throw `RangeError`. Fails today: module does not exist.

**Action - GREEN:** implement `SqliteEventFeed` (`INSERT`;
`SELECT … WHERE id > ? ORDER BY id LIMIT ?` with the limit guard).

**Action - REFACTOR:** none.

**Output:** `EventFeed` port + `SqliteEventFeed` per the Acceptance
Criteria.

**Verify:** `npm test` green (all five RED cases); `npm run typecheck`
exit 0.
