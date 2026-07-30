# Story S2 — the two rows plus every wiring edit

Epic: `.agent/plan/epics/022-event-feed.md` (route table + decisions 1, 3, 5)
Depends on: Story S1 (`optionalQueryUlid`, `ReadEventPage`, both views, both
registry codes).

`ROUTES` grows by exactly 2 rows, both `200` json.

## Change

### 1. `src/apps/http/routes.ts` — imports

Add `optionalQueryUlid` to the existing `./decode.ts` import block (`:22-26`),
keeping the other names:

```ts
import {
  optionalQueryString,
  optionalQueryInt,
  optionalQueryUlid,
  requirePathParam,
} from "./decode.ts";
```

Add `requireBodyString` to the existing `./body.ts` import (created by EPIC 021
Story S2); if that import does not yet list it, add the name — do not create a
second import statement.

Add the two view imports beside the other `./views/*` imports (`:4-21`):

```ts
import { eventPageView } from "./views/event.ts";
import { acknowledgementView } from "./views/acknowledgement.ts";
```

### 2. `src/apps/http/routes.ts` — the two rows

Append both rows at the END of the `ROUTES` array, after the last existing row
and before the closing `];`:

```ts
  defineRoute({
    id: "event.list",
    method: "GET",
    path: "/api/event",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list event"],
    decode: ({ query }) => {
      // `after` absent means "from the start of the feed": `id > ''` is true for
      // every ULID, so the use case needs no special case. `?limit=` mirrors
      // `queue.get` (`:366`) exactly. The query key is `project`; the use-case
      // field is `projectId`.
      const after = optionalQueryUlid(query, "after");
      const limit = optionalQueryInt(query, "limit", { min: 1, max: 500 });
      const projectId = optionalQueryString(query, "project");
      return {
        after: after ?? "",
        ...(limit !== undefined ? { limit } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
      };
    },
    run: async (deps, input) => deps.readEventPage.execute(input),
    present: (result) => eventPageView(result),
  }),
  defineRoute({
    id: "project.acknowledgement.create",
    method: "POST",
    path: "/api/project/:id/acknowledgement",
    successStatus: 200,
    kind: "json",
    cliCommands: ["ack project"],
    // 200 (not 204) because the answer is the cursor now IN EFFECT, which is the
    // STORED one for a backwards or repeat ack (`ack-project.ts:85-90`). No
    // `location` (nothing addressable is created) and no `readRow`/`If-Match`:
    // the operation is monotonic, so a stale submission cannot overwrite newer
    // state — it no-ops and the response reports the real cursor.
    decode: ({ params, body }) => ({
      projectId: requirePathParam(params, "id"),
      cursor: requireBodyString(body, "cursor"),
    }),
    run: async (deps, input) => deps.ackProject.execute(input),
    present: (result) => acknowledgementView(result),
  }),
```

### 3. `src/apps/http/deps.ts` — two fields

Add the two `import type` lines after the last one (`:20`):

```ts
import type { ReadEventPage } from "../../app/task/read-event-page.ts";
import type { AckProject } from "../../app/project/ack-project.ts";
```

Add the two fields after the interface's current last field (`:46`), before the
closing brace (`:47`):

```ts
  readonly readEventPage: ReadEventPage;
  readonly ackProject: AckProject;
```

### 4. `src/apps/cli/commands/serve.ts` — populate both fields

Add two lines at the end of the `const httpDeps: HttpDeps = { … }` literal
(`:39-60`), after `getObjectiveConflict: deps.getObjectiveConflict,` (`:59`):

```ts
        readEventPage: deps.readEventPage,
        ackProject: deps.ackProject,
```

### 5. `src/apps/cli/deps.ts` — declare `readEventPage` on `CliDeps`

Add the type import beside `ListEvents` (`:45`):

```ts
import type { ReadEventPage } from "../../app/task/read-event-page.ts";
```

Add the field directly after `listEvents: ListEvents;` (`:227`):

```ts
/** EPIC 022 — one page of the feed plus the continuation cursor, for `GET /api/event`. */
readEventPage: ReadEventPage;
```

`ackProject` already exists on `CliDeps` (`:177-178`) — do not add it again.

### 6. `src/composition.ts` — construct `ReadEventPage`

Add the import beside `ListEvents` (`:83`):

```ts
import { ReadEventPage } from "./app/task/read-event-page.ts";
```

Construct it directly after `const listEvents = new ListEvents(events);`
(`:415`), on the same `events` feed (`SqliteEventFeed`, `:198`):

```ts
const readEventPage = new ReadEventPage(events);
```

Add it to the returned deps bundle (opens `:1162`, closes `:1247`) directly after
`listEvents,` (`:1210`):

```ts
    readEventPage,
```

`ackProject` is already constructed (`:210-212`) and already returned (`:1170`) —
do not touch either site.

### 7. `src/apps/http/routes.test.ts` — the two counters

- The row-count assertion (`:248`): set it to **the number currently in the file
  plus 2**, and update the test's title (`:247`) to match the new total. With
  EPIC 021 landed that is `52` → **`54`**. **If the file still asserts `24`, EPIC
  021 has not landed: stop and escalate to the human** — 022 depends on 021's
  `body.ts`, `etag.ts` and route-policy fields, so building on a 24-row tree is a
  sequence violation, not something to work around.
- Append the two ids to the expected-id array (`:253-276`), after the last entry:

```ts
    "event.list",
    "project.acknowledgement.create",
```

## Constraints

- **Both rows are appended at the end of `ROUTES`.** No existing row is moved,
  renamed or re-ordered; route matching is exact-path, so order carries no
  meaning, and appending keeps the diff reviewable.
- **Neither row declares `location`** (neither is `201`) **nor `readRow`**
  (neither is `PATCH`). EPIC 021's route-policy test enforces both as iff-rules —
  adding either field makes `npm run verify` fail.
- `run` is ONE line per row with no logic: no cursor arithmetic, no defaulting, no
  branching. Every default and every validation lives in `decode`.
- `decode` uses conditional spreads, so an absent `?limit=` / `?project=` yields an
  object with NO such key — the row tests assert the exact object with
  `assert.deepEqual`.
- `decode` for the ack does **not** validate the cursor's ULID shape:
  `AckProject` rule 2 owns that check (`ack-project.ts:74-77`) and throws
  `CursorNotUlidError`, which Story S1 mapped. Two validators for one rule is how
  they drift.
- `?project=` is a FILTER, not a lookup: an unknown project id yields `200` with
  an empty page, never `404`. No existence check is added anywhere.
- `AckProject.execute` is `async`; `ReadEventPage.execute` is synchronous — the
  `async` arrow in `run` covers both, and no `await` is added inside `decode`.
- No middleware is added, removed or reordered. No change to `app.ts`,
  `etag.ts`, `router.ts`, the envelope or Basic auth.
- `src/app/task/list-events.ts`, `src/apps/cli/events.ts` and
  `src/apps/cli/commands/list/event.ts` are NOT modified: the CLI keeps using
  `ListEvents`.

## Verify

- New `src/apps/http/routes.event.test.ts`, built on the
  `src/apps/http/routes.task.test.ts:1-100` pattern (fakes only, no server, no
  sqlite; `makeDeps()` returns `{ deps, received, readEventPageCalls, ackProjectCalls }`
  with each use case as `{ execute: … } as HttpDeps["<field>"]`):
  - `GET /api/event` → `200`, and `received.readEventPage` deep-equals exactly
    `{ after: "" }` (no `limit` key, no `projectId` key);
  - `GET /api/event?after=01ARZ3NDEKTSV4RRFFQ69G5FAV&limit=5&project=p1` → `200`,
    and the received input deep-equals
    `{ after: "01ARZ3NDEKTSV4RRFFQ69G5FAV", limit: 5, projectId: "p1" }`;
  - `GET /api/event?project=p1` → the received input deep-equals
    `{ after: "", projectId: "p1" }`;
  - `GET /api/event?after=0` → `400` code `invalid_input`, and
    `readEventPageCalls` is `0`;
  - `GET /api/event?limit=0` and `?limit=501` and `?limit=abc` → `400` code
    `invalid_input`, `readEventPageCalls` is `0` for each;
  - the `200` response body is `{ data: { events: [...], nextCursor: … } }` —
    `Object.keys(res.body.data).sort()` equals `["events", "nextCursor"]` — and
    `res.headers.etag` is a non-empty string;
  - a fake returning `{ events: [], nextCursor: null }` answers `200` with
    `res.body.data.nextCursor === null`;
  - `POST /api/project/p1/acknowledgement` with
    `{"cursor":"01ARZ3NDEKTSV4RRFFQ69G5FAV"}` and
    `Content-Type: application/json` → `200`, `received.ackProject` deep-equals
    `{ projectId: "p1", cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }`,
    `ackProjectCalls` is `1`, `Object.keys(res.body.data)` equals `["cursor"]`,
    and `res.headers.etag` is a non-empty string;
  - the ack answers `200` with **no** `If-Match` header sent — asserted
    explicitly, as the guard against anyone later giving the row a `readRow`;
  - the ack's response `cursor` is whatever the fake returns, even when it differs
    from the submitted one (fake returns `"01ARZ3NDEKTSV4RRFFQ69G5FAT"` for a
    submitted `"…FAV"`, and the response carries the fake's value) — the monotonic
    no-op is passed through, never rewritten;
  - `POST /api/project/p1/acknowledgement` with `{}` → `400` code
    `invalid_input`, and `ackProjectCalls` is `0`;
  - `POST /api/project/%20/acknowledgement` with a valid body → `400` code
    `invalid_input` (blank id after `.trim()`), `ackProjectCalls` is `0`;
  - a fake `ackProject` throwing `new CursorNotUlidError("nope")` (imported in the
    test from `../../app/project/ack-project.ts`, and `UnknownReferenceError`
    from `../../app/errors.ts` as `routes.task.test.ts:8` does) → `400` code
    `cursor_not_ulid`; throwing
    `new CursorAheadOfFeedError("01ARZ…", null)` → `409` code
    `cursor_ahead_of_feed`; throwing
    `new UnknownReferenceError("project", "p9")` → `404` code
    `unknown_reference`;
  - `PUT /api/event` → `405`, and `/api/events` → `404` code `unknown_route`.
- `src/apps/http/routes.test.ts` — the amended count and id-list assertions pass;
  the static-segment, verb-ban and no-plural assertions pass over both new rows;
  the 021 policy assertions pass (both rows have a `present`, no `location`, no
  `readRow`).
- `node --test src/apps/http/routes.event.test.ts src/apps/http/routes.test.ts src/apps/http/app.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0 — this is also what proves the `HttpDeps` /
  `CliDeps` / `composition.ts` / `serve.ts` wiring is complete, because both
  `HttpDeps` fields are REQUIRED.
- Proof: `scripts/e2e/http-events-proof.sh` now reaches phase F and prints
  `022 ok: …`. Phases B–E are all delivered by this story (phase A is fixture
  only). If any phase fails, the row — not the script — is wrong: the script was
  written and run against the pre-implementation tree by the epic author.
