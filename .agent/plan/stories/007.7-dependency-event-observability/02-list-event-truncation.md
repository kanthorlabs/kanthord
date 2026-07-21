# Story 2 — S2 (N5): truncation signal for `list event`

Epic: `.agent/plan/epics/007.7-dependency-event-observability.md`

## Goal

`list event --after 0 --json` silently truncates at its page cap with **no
signal** — no next cursor, no "N more". A reader who does not know to raise
`--limit` or page by cursor sees a partial, stale feed and can mis-conclude that
terminal events never fired (N5). This nearly produced a false "silent
completion" data-loss report during the E2E. This story makes a capped page
self-describing: when more events exist beyond the returned page, the CLI emits a
resumable next cursor; when the page reaches the tail, it emits nothing.

## Contract (tests assert this)

Scope is `runEvents` (`src/apps/cli/events.ts`), **non-follow mode only**.

- **Single page, no auto-drain (non-follow).** A non-follow read returns **one
  page** of at most the page size. The page size is `--limit` when given, else a
  **default of 10**. The current behavior — where a full non-follow page
  `continue`s and re-reads the next page until exhaustion — is **removed** for
  non-follow. (`--follow` keeps its streaming multi-read + sleep loop **and its
  existing limit handling** unchanged; see below.)
- **Truncation detection via a `pageSize + 1` probe.** The non-follow read asks
  the feed for one extra row (`readAfter(cursor, pageSize + 1)`). If the extra
  row comes back (`returned.length > pageSize`), a next page exists: show only
  the first `pageSize` rows and remember there is more. This folds the "is there
  more?" check into the single read (no separate lookahead query) and covers both
  an explicit small `--limit` and the default-page case (the N5 trigger). An
  invalid explicit `--limit` (≤ 0 or non-integer) is passed to the feed unchanged
  so it still rejects with the existing `RangeError` → exit 1.
- **JSON mode signal.** When truncated, after the per-event ndjson lines, emit
  **one** additional final stdout line — a JSON object
  `{"nextCursor":"<lastReturnedEventId>"}`. When the page reaches the tail, emit
  **no** sentinel line. The per-event ndjson lines are unchanged (one event
  object per line); the sentinel is a separate trailing line, so the feed stays
  ndjson-parseable line by line.
- **Human mode signal.** When truncated, after the per-event stderr lines, print
  **one** extra stderr line naming the resumable cursor, e.g.
  `more available — pass --after <lastReturnedEventId>`. When the page reaches
  the tail, print nothing extra.
- **Empty page.** When no events exist after the cursor, emit no sentinel/hint
  and exit 0 (unchanged).
- **`--follow` unchanged.** Follow mode keeps streaming past the cursor with its
  poll/sleep loop and emits **no** truncation sentinel (a follower is never
  "truncated" — it waits for more). The existing follow test must stay green.
- Exit code stays **0** in all these cases.

## Constraints

- Driving-adapter change only (`src/apps/cli/events.ts`). No use-case, port, or
  domain change — the `ReadableEventFeed.readAfter(cursor, limit?)` seam already
  supports the `pageSize + 1` read. The ULID cursor stays the paging primitive
  (epic Non-goal: no offset paging, no total counts).
- Surgical: touch the non-follow branch of the read loop plus the JSON/human
  emit paths. Do not change the `agent.progress` display throttle, the
  `RangeError` handling, or `--follow` semantics.
- **Known test change (expected, call it out in the turn):**
  `src/apps/cli/events.test.ts` "events --limit 2 makes three immediate reads
  for 5 events…" asserts the removed non-follow auto-drain. Rewrite it to the new
  contract: a non-follow `--limit 2` over 5 events returns the first 2 events
  **plus** a trailing `{"nextCursor":"<2nd-id>"}` sentinel (json) / a
  `more available` line (human), in a single read.

## Verification Gate

- `node --test src/apps/cli/events.test.ts` — with a fake feed of 5 events:
  - non-follow `--limit 2 --json`: stdout has 2 event lines then a final
    `{"nextCursor":"<id-of-2nd-event>"}` line; exit 0.
  - non-follow `--limit 2` (human): stderr has 2 event lines then one
    `more available — pass --after <id-of-2nd-event>` line; exit 0.
  - non-follow `--limit 10 --json` (page covers all 5): 5 event lines, **no**
    sentinel line; exit 0.
  - non-follow `--after <last-id>` (nothing after): no events, no sentinel,
    exit 0.
  - non-follow **default page (no `--limit`)** over 12 events: 10 event lines
    then a `{"nextCursor":"<id-of-10th-event>"}` sentinel; exit 0.
  - non-follow default page over < 10 events: all events, **no** sentinel; exit 0.
  - `--limit 0` / non-integer `--limit` still exits 1 with the feed's
    `RangeError` message (validation preserved).
  - `--follow` test (existing) still passes: streams every event once, no
    sentinel, exits 0 on abort.
- `npm run typecheck` exits 0; `npm run lint` clean.
