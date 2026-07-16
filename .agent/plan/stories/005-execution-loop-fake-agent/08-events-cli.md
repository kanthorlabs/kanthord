# Story 08 — Events CLI (`events --after`, `--follow`)

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

The pull-based notification surface: `events --after <cursor>` prints the
lifecycle stream in ULID order; `--follow` polls with a cursor so a client
sees every event exactly once.

## Acceptance Criteria

- `app/task/list-events.ts` — `ListEvents.execute({ after, limit? })` —
  CQRS-lite query straight on `EventFeed.readAfter` (no domain objects).
- Handler `runEvents` for `events --after <cursor> [--limit <n>] [--json]
  [--follow] [--poll-interval <ms>]`:
  - human output (stderr, EPIC 004 convention): one line per event —
    `<id> <type> <taskId>` plus ` <payload JSON>` when present; `--json`:
    ndjson on stdout (one event object per line);
  - `--after 0` reads from the start (EPIC 003 contract);
  - **paging (debate finding):** the cursor advances to the last printed
    id after every page; while a page comes back **full**
    (`length === limit`) the next page is read immediately — sleep only
    after a short/empty page;
  - `--follow`: after a short/empty page, `sleep(pollIntervalMs)` (default
    1000) and poll again from the advanced cursor, until aborted; exit 0;
  - **stop seam (debate finding):** the handler receives an `AbortSignal`;
    the follow loop checks it before each page and each sleep;
    `process.once('SIGINT', → abort)` is wired in the handler; tests abort
    programmatically — no real signals, no real timers.
- `--limit` must be a positive integer (the port's `RangeError` surfaces
  as a one-line CLI error).

## Constraints

- No new storage; `readAfter` is the EPIC 003 surface + S02-T2's payload.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — ListEvents + `events` command

**Requires:** S02-T2 (payload round-trip); EPIC 003 S005-T1 (`readAfter`);
EPIC 004 S01 (command table).

**Input:** `src/app/task/list-events.ts` (new) + test;
`src/apps/cli/events.ts` (new) + test; register `events` in `COMMANDS`
(locked grammar exception, see index).

**Action — RED:** tests: (a) seeded feed, `events --after 0` prints all
events in id order (human lines; `--json` ndjson deep-equals the events,
payload included); (b) `--after <mid-cursor>` prints only newer events;
(c) full-page paging: 5 events, `--limit 2` → three immediate reads, no
sleep between full pages, every event exactly once; (d) `--follow` with
injected sleep: two polls with an append in between print every event
exactly once, then abort exits 0; (e) `--limit 0` → one-line error,
exit 1. Fails today: modules do not exist.

**Action — GREEN:** implement query + handler per the AC.

**Action — REFACTOR:** none.

**Output:** the epic's notification surface: `events --after 0` shows
`ready → started → completed` per task in ULID order.

**Verify:** `npm test` green (all five cases); `npm run typecheck` exit 0.
