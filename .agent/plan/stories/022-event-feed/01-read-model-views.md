# Story S1 — the read model, the ULID query reader, the views, the two registry codes

Epic: `.agent/plan/epics/022-event-feed.md` (decisions 2, 4, 6, 7 + the registry
table)

No row lands in this story. `ROUTES` keeps the count it already has, so
`npm run verify` proves every addition in isolation.

## Change

### 1. `src/app/task/read-event-page.ts` (new)

```ts
// src/app/task/read-event-page.ts — the CQRS-lite query behind
// GET /api/event (EPIC 022 decision 4). One page of the feed plus the
// CONTINUATION cursor.
//
// `nextCursor` is the last RETURNED event id. On an empty page it echoes the
// input cursor, so the same poll is repeatable (idempotent polling); it is
// `null` only when the caller started at the head of the feed (`after: ""`)
// and nothing came back. It is NOT a scan watermark: the scoped read filters
// foreign and NULL-project rows inside SQL (`src/events/sqlite.ts:94-106`) and
// the port exposes no watermark.
//
// `ListEvents` is left alone: the CLI owns its own paging, probe and follow
// behaviour (`src/apps/cli/events.ts`).
import type { Event } from "../../domain/event.ts";

/** Narrow structural interface — only the read half of EventFeed is needed. */
interface ReadableEventFeed {
  readAfter(cursor: string, limit?: number, projectId?: string): Event[];
}

export interface ReadEventPageOutput {
  readonly events: readonly Event[];
  readonly nextCursor: string | null;
}

export class ReadEventPage {
  readonly #feed: ReadableEventFeed;

  constructor(feed: ReadableEventFeed) {
    this.#feed = feed;
  }

  execute({
    after,
    limit,
    projectId,
  }: {
    after: string;
    limit?: number;
    projectId?: string;
  }): ReadEventPageOutput {
    const events = this.#feed.readAfter(after, limit, projectId);
    const last = events.at(-1);
    return { events, nextCursor: last?.id ?? (after === "" ? null : after) };
  }
}
```

### 2. `src/apps/http/decode.ts` — a ULID query reader

Insert directly after `optionalQueryString` (which ends at `:56`) and before
`queryList` (`:58`), keeping every existing function unchanged:

```ts
/**
 * A cursor query parameter. `undefined` when absent — for the event feed
 * "absent" means "from the start of the feed", so the row maps it to `""`.
 * When present it must be an exact 26-char uppercase Crockford ULID: the same
 * shape `AckProject` enforces (`src/app/project/ack-project.ts:44`). The value
 * is NOT trimmed — a ULID never carries surrounding space, and trimming would
 * silently accept `" <ulid> "`. The CLI's `--after 0` sentinel
 * (`src/apps/cli/events.ts:51`) is therefore rejected here by design.
 */
export function optionalQueryUlid(
  query: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const raw = query[name];
  if (raw === undefined) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    throw new InvalidInputError(name, "must be a single value");
  }
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(raw)) {
    throw new InvalidInputError(name, "must be a ULID");
  }
  return raw;
}
```

### 3. `src/apps/http/views/event.ts` (new)

```ts
import type { ReadEventPageOutput } from "../../../app/task/read-event-page.ts";

/**
 * `Event` is declared in `src/domain/event.ts`, which `apps/http` may not
 * import. Derived structurally from the app-layer output type instead — the
 * same technique as `views/queue.ts:4-9`.
 */
type FeedEvent = ReadEventPageOutput["events"][number];

export interface EventView {
  readonly id: string;
  readonly type: string;
  readonly taskId?: string;
  readonly objectiveId?: string;
  readonly initiativeId?: string;
  readonly repositoryId?: string;
  readonly payload?: Record<string, string>;
  readonly [key: string]: unknown;
}

/**
 * `events.projectId` is storage-internal (`src/events/sqlite.ts:275-280`) and
 * is never surfaced: the literal field list below is the whole wire contract.
 */
export function eventView(event: FeedEvent): EventView {
  return {
    id: event.id,
    type: event.type,
    ...(event.taskId !== undefined ? { taskId: event.taskId } : {}),
    ...(event.objectiveId !== undefined
      ? { objectiveId: event.objectiveId }
      : {}),
    ...(event.initiativeId !== undefined
      ? { initiativeId: event.initiativeId }
      : {}),
    ...(event.repositoryId !== undefined
      ? { repositoryId: event.repositoryId }
      : {}),
    ...(event.payload !== undefined ? { payload: { ...event.payload } } : {}),
  };
}

export interface EventPageView {
  readonly events: readonly EventView[];
  readonly nextCursor: string | null;
  readonly [key: string]: unknown;
}

export function eventPageView(result: ReadEventPageOutput): EventPageView {
  return {
    events: result.events.map(eventView),
    nextCursor: result.nextCursor,
  };
}
```

### 4. `src/apps/http/views/acknowledgement.ts` (new)

```ts
export interface AcknowledgementResult {
  readonly cursor: string;
}

export interface AcknowledgementView {
  readonly cursor: string;
  readonly [key: string]: unknown;
}

/** The cursor now IN EFFECT — see `src/app/project/ack-project.ts:85-94`. */
export function acknowledgementView(
  result: AcknowledgementResult,
): AcknowledgementView {
  return { cursor: result.cursor };
}
```

### 5. `src/apps/http/routes.test.ts` — two path segments

Append to the END of the `PATH_SEGMENTS` array (declared at `:42`; its last entry
today is `"conflict",` at `:58`, closing bracket `:59`), one entry per line:

```ts
  "event",
  "acknowledgement",
```

`NOT_PLURAL` (`:68`) is NOT touched: neither segment ends in `s`. `BANNED_VERBS`
(`:8-34`) is NOT touched: it contains `"ack"`, but the check is an exact segment
match (`:80`) and `"acknowledgement"` is not `"ack"`.

### 6. `src/apps/http/error-registry.ts` — two domain mappings

Add the import after the existing use-case-module import at `:7`:

```ts
import {
  CursorNotUlidError,
  CursorAheadOfFeedError,
} from "../../app/project/ack-project.ts";
```

Append to `DOMAIN_ERROR_MAPPINGS` as its last two entries, directly before the
closing `];` (`:37` today):

```ts
  {
    type: CursorNotUlidError,
    code: "cursor_not_ulid",
    status: 400,
    message: "the cursor is not a ULID",
  },
  {
    type: CursorAheadOfFeedError,
    code: "cursor_ahead_of_feed",
    status: 409,
    message: "the cursor is ahead of the project event feed",
  },
```

### 7. `src/apps/http/error-registry.test.ts` — two per-class tests

Add two `mapError` tests in the style of the existing per-class tests
(`:44-68`), after the last of them.

## Constraints

- **No route is added, removed or renamed.** The `ROUTES.length` assertion
  (`routes.test.ts:248`) and the expected-id list (`:253-276`) are NOT touched by
  this story.
- **`src/app/task/list-events.ts`, `src/apps/cli/events.ts` and
  `src/events/port.ts` are NOT modified.** `ReadEventPage` reuses the port's
  existing `readAfter(cursor, limit?, projectId?)` signature; no port method is
  added.
- `ReadEventPage.execute` is **synchronous** (mirrors `ListEvents.execute`) and
  forwards `limit` / `projectId` straight through, `undefined` included. It adds
  no validation: `min: 1` in the row's `decode` (Story S2) is what keeps the
  adapter's `RangeError` (`src/events/sqlite.ts:67-69`) unreachable.
- `optionalQueryUlid` does **not** trim and does **not** upper-case its input.
  `"0"`, `""`, a lowercase ULID and a padded ULID all throw
  `InvalidInputError(name, "must be a ULID")`.
- Both messages in the registry are **explicit**, not the default
  `(err as Error).message` path (`error-registry.ts:116`), so neither response
  echoes the submitted cursor value back.
- No re-export is added to `src/app/errors.ts` — the mappings import the classes
  from their use-case module, matching `error-registry.ts:7`.
- Neither view file imports from `src/domain/**` (`eslint.config.js:74-78`).
  `views/event.ts` derives its row type from `ReadEventPageOutput`.
- Both view interfaces carry `readonly [key: string]: unknown;` as their LAST
  member; optional fields use conditional spreads, never `key: undefined`.

## Verify

- New `src/app/task/read-event-page.test.ts` — a local `FakeEventFeed`
  implementing `readAfter` (mirror `src/app/task/list-events.test.ts:1-50`):
  - a non-empty page: `nextCursor` equals the LAST returned event's id;
  - an empty page with `after: "01ARZ3NDEKTSV4RRFFQ69G5FAV"`: `nextCursor` equals
    that same input string, and `events` is `[]`;
  - an empty page with `after: ""`: `nextCursor` is `null`
    (`assert.equal(out.nextCursor, null)`);
  - a non-empty page with `after: ""`: `nextCursor` is the last event's id, NOT
    `null`;
  - argument forwarding: a recording fake asserts `readAfter` was called with
    exactly `("01ARZ…", 5, "p1")` for
    `execute({ after: "01ARZ…", limit: 5, projectId: "p1" })`, and with
    `("", undefined, undefined)` for `execute({ after: "" })`;
  - `execute({ after: "", limit: 0 })` propagates the fake's `RangeError`
    (mirrors `list-events.test.ts:46-50`) — the use case adds no validation of
    its own.
  - There is deliberately **no** test asserting that a scoped page "skips foreign
    rows": a fake cannot model SQL filtering, so such a test would assert
    behaviour the real adapter does not provide.
- `src/apps/http/decode.test.ts` — seven new tests appended after the
  `optionalQueryString` group (`:99-119`), in that file's exact style
  (`assert.throws(fn, (err: unknown) => err instanceof InvalidInputError && err.field === "after")`):
  - `optionalQueryUlid({}, "after")` is `undefined`;
  - `optionalQueryUlid({ after: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, "after")` returns
    that string unchanged;
  - `{ after: "0" }` throws, field `"after"`;
  - `{ after: "" }` throws, field `"after"`;
  - `{ after: "01arz3ndektsv4rrffq69g5fav" }` (lowercase) throws;
  - `{ after: " 01ARZ3NDEKTSV4RRFFQ69G5FAV " }` (padded) throws;
  - `{ after: ["01ARZ3NDEKTSV4RRFFQ69G5FAV", "x"] }` throws, field `"after"`.
- New `src/apps/http/views/event.test.ts` — the test file imports the domain type
  for its casts (`import type { Event } from "../../../domain/event.ts";`), which
  is legal in a test file (`eslint.config.js:91-95`) and is exactly what
  `views/queue.test.ts:5` does; the view module itself still may not:
  - leak test (mirror `views/health.test.ts:5-16`): an event object carrying an
    extra `projectId: "p1"` and `secret: "leak-me"`, cast
    `as unknown as Event`, presents
    `Object.keys(view).sort() === ["id", "type"]` — asserting explicitly that
    `"projectId" in view === false`;
  - every optional field absent: `taskId`, `objectiveId`, `initiativeId`,
    `repositoryId` and `payload` are all absent via `"x" in view === false` (not
    just `undefined`);
  - every optional field present: `Object.keys(view).sort()` equals
    `["id", "initiativeId", "objectiveId", "payload", "repositoryId", "taskId", "type"]`;
  - `payload` is a COPY: mutating the source object after presenting does not
    change `view.payload`;
  - `eventPageView({ events: [e1, e2], nextCursor: "01ARZ…" })` gives
    `Object.keys(view).sort() === ["events", "nextCursor"]`, `view.events.length === 2`,
    and each item's keys are the event view's keys;
  - `eventPageView({ events: [], nextCursor: null })` gives
    `{ events: [], nextCursor: null }` — the `null` survives presentation.
- New `src/apps/http/views/acknowledgement.test.ts`: the leak test — an object
  carrying `cursor` plus `stored: "leak-me"` cast
  `as unknown as AcknowledgementResult` presents
  `Object.keys(view).sort() === ["cursor"]`.
- `src/apps/http/error-registry.test.ts`:
  - `mapError(new CursorNotUlidError("nope"))` is
    `{ code: "cursor_not_ulid", status: 400, message: "the cursor is not a ULID" }`
    — and the message does NOT contain `"nope"`;
  - `mapError(new CursorAheadOfFeedError("01ARZ…", null))` is
    `{ code: "cursor_ahead_of_feed", status: 409, message: "the cursor is ahead of the project event feed" }`;
  - the existing "registry hygiene" test (`:21-42`) still passes — both new codes
    are snake_case and both statuses are already in `ALLOWED_STATUSES`.
- `src/apps/http/routes.test.ts` — the existing static-segment test passes with
  `event` and `acknowledgement` in `PATH_SEGMENTS` (no row uses them yet, so the
  list is simply larger than the set in use).
- `node --test src/app/task/read-event-page.test.ts src/app/task/list-events.test.ts src/apps/http/decode.test.ts src/apps/http/views/event.test.ts src/apps/http/views/acknowledgement.test.ts src/apps/http/error-registry.test.ts src/apps/http/routes.test.ts src/apps/cli/error-map.test.ts` passes.
- `npm run verify` exits 0.
- Proof: none directly. `scripts/e2e/http-events-proof.sh` still fails in phase B
  with `expected '200', got '404'` — no row exists yet. Regression: run
  `scripts/e2e/http-reads-proof.sh` (`020 ok: …`) and
  `scripts/e2e/http-writes-proof.sh` (`021 ok: …`); both must still pass.
