# EPIC 022 — the event feed and acknowledgement

> Authored 2026-07-30 on top of EPIC 021 (commit `e4af497`, stories under
> `.agent/plan/stories/021-http-planning-writes/`). This is "Target 022" of
> `.agent/plan/stories/019-http-server/retirement.md`. It adds 2 rows: `ROUTES`
> goes 52 → 54. It removes no CLI leaf.
>
> The same planning session renumbered that roadmap (024 ai-provider writes,
> 025 serve-hosted daemon, 026 the UI) — the reasons live in
> `retirement.md` under "Why the numbering changed".

## Goal

The running `kanthord serve` program lets a client learn what changed without
re-polling every collection: `GET /api/event?after=<ulid>` returns one ascending
page of the append-only feed plus the cursor to send next, and
`POST /api/project/:id/acknowledgement` moves that project's read cursor
forward. Pull-based per AGENTS.md — no SSE, no websocket, no server-held client
state beyond the `project_acks` row `AckProject` already writes. After 022 the
Control Center inbox runs on one polled request instead of N collection reads,
and `list event` + `ack project` become retirable.

## Decisions (binding; do not re-open at build time)

### 0. What 022 inherits and may NOT re-open

- **Singular path segments** plus the `PATH_SEGMENTS` allowlist and the
  `NOT_PLURAL` escape hatch (`src/apps/http/routes.test.ts`).
- **`defineRoute` / `RouteDefinition<Input, Output>`** — no per-row `as` cast, no
  `route.present!`.
- **`POST` on a collection → `201` with `location`; `PATCH` on an item →
  `readRow` plus a REQUIRED `If-Match`; an edge toggle → `204`.** 022 adds
  neither a `201` row nor a `PATCH` row, so both iff-rules hold trivially — see
  decision 5.
- **`ETag` on every `200` `kind: "json"` response** = `"` + sha256 of the
  presented DTO + `"` (`src/apps/http/etag.ts`).
- **One view module per resource** under `src/apps/http/views/`, LITERAL field
  lists, no `domain/` import, no object spread of an entity.
- **The error registry holds only what a row can raise** (019 decision 11).
- **The 019 envelope, Basic auth, and the eight middleware in their existing
  order** — add none, reorder none.
- Every story wires its own `HttpDeps` fields, populates them in
  `src/apps/cli/commands/serve.ts`, and bumps the `ROUTES.length` assertion.

### 1. The feed is GLOBAL with an OPTIONAL `?project=` filter

`GET /api/event` — one row, not `GET /api/project/:id/event`. Three reasons from
the code:

- `events` rows may have `projectId IS NULL`.
  `SqliteEventFeed.#resolveProjectId` returns `null` when the owner row is
  absent (`src/events/sqlite.ts:37-64`), so a project-scoped-only route makes
  those events unreachable over HTTP forever.
- 020's own rule: a REQUIRED parent scope is a path segment, an OPTIONAL filter
  is a query parameter. Project scope is optional here, so it is `?project=`.
  The port already takes it as an optional third argument
  (`EventFeed.readAfter(cursor, limit?, projectId?)`, `src/events/port.ts:12`)
  and pushes it into SQL (`sqlite.ts:94-106`) — never fetch-then-filter.
- The Control Center home is cross-project. A project-scoped-only feed forces
  the UI to fan out one poll per project.

### 2. The cursor contract — a CONTINUATION cursor, not a scan watermark

- **`after` is OPTIONAL.** Absent = from the start of the feed. `decode` passes
  `""` to the use case; `id > ''` is true for every ULID, so "no cursor" needs no
  special case in SQL.
- **When present, `after` MUST be a 26-char Crockford ULID** — a new
  `optionalQueryUlid(query, name)` in `src/apps/http/decode.ts`, using the same
  regex `AckProject` already uses (`/^[0-9A-HJKMNP-TV-Z]{26}$/`,
  `src/app/project/ack-project.ts:44`), else `400 invalid_input`. The CLI's
  `--after 0` sentinel (`src/apps/cli/events.ts:51`) is **not** accepted over
  HTTP: "absent" already means the same thing, and a magic non-ULID value in the
  wire contract is CLI history.
- **`nextCursor: string | null` is the last RETURNED event id.** On an empty page
  it echoes the input cursor. It is `null` when `after` was absent AND the page
  is empty. The client rule is one line: `null` → omit `after`; otherwise send it
  back.
- **Why it is not called a "scan watermark".** The scoped read is
  `WHERE id > ? AND projectId = ? ORDER BY id ASC LIMIT ?`, so SQLite drops
  foreign and NULL-project rows INSIDE the query and the port exposes no
  watermark. `events.at(-1)?.id` is therefore the last MATCHING event, and
  echoing `after` on an empty page advances past nothing. The justification for
  the echo is **idempotent polling**: an empty page must not lose the client's
  place, so the same poll is repeatable. The cost is that a scoped poll re-scans
  the same id range each time; the `events_project_cursor` index (011 Story 3)
  serves exactly that read, so the cost is an index seek, not a table scan.
  A real watermark would need a new port method and a second query — not built,
  no proved need (see Non-goals).
- `null` and not `""` because `optionalQueryString` rejects a blank value with
  `400 invalid_input` (`src/apps/http/decode.ts:52-54`); a DTO that echoed `""`
  would hand the client a value the same API refuses.
- **No `hasMore` / `total`.** A page whose length equals the effective limit MAY
  have more; the client calls again with `nextCursor`. The CLI's `limit + 1`
  probe (`src/apps/cli/events.ts:80,108`) stays CLI-only, because a probe means
  `run` computing something and `RouteDefinition.run` is one line with no logic
  of its own (`src/apps/http/routes.ts:63-68`).

**Recorded, deliberately not fixed:** the comment at
`src/apps/cli/events.ts:30-33` calls the CLI's `nextCursor` "the last scanned row
id" and says it "lets a project-scoped feed step past foreign events". Against
the SQL above that wording is inaccurate. It is a comment, not behaviour, and it
is outside this epic's edit scope.

### 3. `?limit=` mirrors `queue.get`

`optionalQueryInt(query, "limit", { min: 1, max: 500 })` — the exact call
`queue.get` already makes (`src/apps/http/routes.ts:366`). Absent → the field is
omitted from the use-case input and the adapter's own default of **100** applies
(`src/events/sqlite.ts:71`). `min: 1` also makes the adapter's `RangeError`
(`sqlite.ts:67-69`) unreachable from this row, so `RangeError` is NOT registered
(019 decision 11).

### 4. A read use case, so `run` stays one line

`present(result)` never sees the request, so it cannot echo the input cursor on an
empty page, and that logic may not live in `run`. So 022 adds one small
CQRS-lite query, `src/app/task/read-event-page.ts`, beside the existing
`list-events.ts` and on the same `ReadableEventFeed` structural interface:

```ts
execute({ after, limit, projectId }): { events: Event[]; nextCursor: string | null } {
  const events = this.#feed.readAfter(after, limit, projectId);
  const last = events.at(-1);
  return { events, nextCursor: last?.id ?? (after === "" ? null : after) };
}
```

`ListEvents` and `src/apps/cli/events.ts` are **not touched** — the CLI owns its
own paging, probe, follow and throttle behaviour, and re-planning it is out of
scope. The small duplication is the accepted trade (AGENTS.md: "a copied 15-line
trivial use case is the accepted trade"). It is not use-case-calls-use-case: the
new query talks to the port.

### 5. `POST …/acknowledgement` answers `200` + the effective cursor, and needs NO `If-Match`

- **`200`, not `204`.** `AckProject.execute` returns `{cursor}`, and that value is
  NOT always the submitted one: rule 4 makes a backwards or repeat ack a silent
  no-op that returns the STORED cursor
  (`src/app/project/ack-project.ts:85-90`). `204` would tell the client "your
  cursor is now in effect" when it is not. `200 {"cursor":"<in effect>"}` is the
  only honest answer.
- **Not `201` + `Location`.** Nothing addressable is created; the resource is a
  singleton whose readable form already exists as `digest.since` on the project
  overview — it is NESTED under `digest`, not a top-level field, so the wire path
  is `overview.digest.since` (`src/apps/http/views/project.ts:56-57,102-103`).
  021 already set the precedent that a
  POST which creates no addressable thing answers `200`
  (`initiative.graph.apply`, `graph.readiness.check`,
  `project.resource.create`), and `location` is required only iff
  `successStatus === 201`, so 021's route-contract test passes unchanged.
- **No `If-Match` — an explicit, named refinement of 021 decision 3, not a
  formality.** 021's reason for "POST needs no precondition" was "there is no
  prior state to be stale about". That reason does NOT hold here: this POST
  mutates an existing singleton cursor, so prior state exists. The correct reason
  is domain-specific: `AckProject` is **monotonic**, so a stale submission cannot
  overwrite newer state — it no-ops (rule 4) and the response tells the client
  the cursor really in effect. Optimistic concurrency would add a mandatory extra
  round trip (the ack has no paired item GET row to read a validator from) and
  prevent nothing.
- **Body:** `{"cursor":"<ulid>"}`, read with 021's
  `requireBodyString(body, "cursor")`. `decode` does NOT pre-check the ULID
  shape: `AckProject` rule 2 owns that check and throws `CursorNotUlidError`,
  which the registry maps. Two validators for one rule is how they drift.
- **The cursor you ack MUST come from the project-scoped feed**
  (`GET /api/event?project=<id>`). `AckProject` rule 3 rejects a cursor greater
  than `latestProjectEventId(projectId)` (`ack-project.ts:80-83`), so a GLOBAL
  `nextCursor` **may be** ahead of that project's latest event →
  `409 cursor_ahead_of_feed`. It is ahead only when the global page ends on
  another project's or an unowned event; if the project owns the latest global
  event, acking the global cursor succeeds. The Proof therefore FORCES that
  ordering and asserts it (phase D) rather than assuming it.

### 6. Two new path segments — confirmed against the test, not assumed

`PATH_SEGMENTS` gains `event` and `acknowledgement`.

- Neither is in `BANNED_VERBS` (`src/apps/http/routes.test.ts:8-35`). The list
  DOES contain **`ack`** — but the check is an EXACT segment match
  (`BANNED_VERBS.includes(s.toLowerCase())`, `routes.test.ts:80`), and
  `"acknowledgement"` is not `"ack"`. That is the point of the noun: `ack` is the
  verb, `acknowledgement` is the resource, and the verb lives in the method.
- Both are singular and neither ends in `s`, so `NOT_PLURAL` stays as 021 left it
  (`readiness` only).

### 7. Views — one module, literal fields, no `domain/` import

New `src/apps/http/views/event.ts`:

- `eventView(e)` →
  `{id, type, taskId?, objectiveId?, initiativeId?, repositoryId?, payload?}`.
  An absent optional field is OMITTED, never `null`, matching the entity's
  optionality (`src/domain/event.ts:37-45`). `events.projectId` is
  storage-internal and is NEVER surfaced (`src/events/sqlite.ts:275-280`) —
  asserted by a test, because a client that could read it would start depending
  on it.
- `eventPageView(page)` → `{events: eventView[], nextCursor}`.
- Both take a LOCAL structural type, not `import type { Event }` — eslint
  `boundaries` forbids `apps/` → `domain/`; the same pattern as
  `src/apps/cli/events.ts:2-10`.

New `src/apps/http/views/acknowledgement.ts`: `acknowledgementView({cursor})` →
`{cursor}`.

## Route table (2 rows covering 2 CLI leaves)

`kind` is `"json"` for both rows.

| id                               | path                               | method | status | use case        | `cliCommands` |
| -------------------------------- | ---------------------------------- | ------ | ------ | --------------- | ------------- |
| `event.list`                     | `/api/event`                       | GET    | 200    | `ReadEventPage` | `list event`  |
| `project.acknowledgement.create` | `/api/project/:id/acknowledgement` | POST   | 200    | `AckProject`    | `ack project` |

`ROUTES` goes from 52 rows to **54**; `routes.test.ts`'s row-count assertion
becomes 54. `HttpDeps` gains `readEventPage: ReadEventPage` and
`ackProject: AckProject`; `composition.ts` constructs `ReadEventPage` and exposes
it on the deps bundle; `src/apps/cli/commands/serve.ts` maps both into
`httpDeps` (`ackProject` is already on `CliDeps` —
`src/apps/cli/deps.ts:178`).

`decode` mapping, stated because the names differ:

- `event.list` →
  `{after: optionalQueryUlid(query, "after") ?? "", limit?, projectId?}` — the
  query key is `project`, the use-case field is `projectId`.
- `project.acknowledgement.create` →
  `{projectId: requirePathParam(params, "id"), cursor: requireBodyString(body, "cursor")}`.

## Error registry additions (019 decision 11: only what a row can raise)

| class                    | code                   | status |
| ------------------------ | ---------------------- | ------ |
| `CursorNotUlidError`     | `cursor_not_ulid`      | 400    |
| `CursorAheadOfFeedError` | `cursor_ahead_of_feed` | 409    |

`400` for the malformed cursor — it is bad input, and a distinct class gets a
distinct code under 019's one-class-one-code rule, so it is not folded into
`invalid_input`. `409` for the ahead-of-feed cursor: the value is well-formed and
the request conflicts with observable server state, exactly like the other `409`s
in the registry. Both classes are exported from
`src/app/project/ack-project.ts:17,28`; the story adds `app/errors.ts`
re-exports if that is what 021's registry pattern settled on.

`UnknownReferenceError` → `404 unknown_reference` and `InvalidInputError` →
`400 invalid_input` already exist. Deliberately NOT registered: the feed
adapter's `RangeError` (unreachable — decision 3). No new status joins
`ALLOWED_STATUSES` — `400` and `409` are both already there.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **`routes.test.ts`**: the row count is 54; the two new `PATH_SEGMENTS` entries;
  the existing verb-ban and no-plural assertions pass over both rows; `location`
  is absent on both (neither is `201`) and `readRow` is absent on both (neither
  is `PATCH`) — 021's contract test already encodes both as iff-rules.
- **`read-event-page.test.ts`** with a fake feed: a non-empty page →
  `nextCursor` is the last RETURNED event's id; an empty page with
  `after: "01J…"` → `nextCursor` echoes the input; an empty page with
  `after: ""` → `nextCursor` is `null`; `limit` and `projectId` are forwarded to
  `readAfter` VERBATIM. There is deliberately NO fake test for "a scoped page
  skips foreign rows": a fake cannot model SQL filtering and the port exposes no
  watermark, so such a test would assert behaviour the real adapter does not
  provide. Argument forwarding is what this use case actually owns.
- **Per row, three unit tests with fakes**, exactly as 020/021 required:
  `decode` maps query, params and body to the exact use-case input (absent
  `after` → `""`; `after=notaulid` and a lowercase ULID → `400 invalid_input`;
  `limit=0`, `limit=501`, `limit=abc`, a repeated `?limit=` →
  `400 invalid_input`; `?project=` → the `projectId` field; a blank `:id` →
  `400 invalid_input`); `run` calls the injected fake exactly once with that
  input; `present` returns objects whose `Object.keys()` equal the declared
  literal list, asserted key by key.
- **`views/event.test.ts`**: an event with only `taskId` presents no
  `objectiveId` / `initiativeId` / `repositoryId` / `payload` keys at all; a feed
  row carrying a `projectId` property presents NO `projectId`; `payload` passes
  through as an object.
- **Dispatch**: both `200` rows carry an `ETag` from 021's dispatcher with no
  per-row work; neither row touches the `If-Match` path.
- **`error-registry.test.ts`**: one `mapError` test per new class, in the style of
  the existing per-class tests (`error-registry.test.ts:44-68`) — `mapError` of a
  `CursorNotUlidError` is `cursor_not_ulid` / `400` with the registry's explicit
  message (so the submitted cursor is not echoed back), and of a
  `CursorAheadOfFeedError` is `cursor_ahead_of_feed` / `409`. Plus the existing
  "registry hygiene" test (`:21-42`) still passing: both codes match its
  snake_case regex (`:29`) and both statuses are already in `ALLOWED_STATUSES`
  (`:17-19`), so 022 adds no status. There is deliberately no
  "each code maps from exactly one class" iterator — the file has exactly one
  test that iterates `DOMAIN_ERROR_MAPPINGS` (the hygiene test), and inventing a
  second iterator is not this epic's job.
- **`cli-coverage.test.ts`**: `list event` and `ack project` name real Commander
  leaves, and the uncovered set shrinks by 2.
- **Boundary lint**: no file under `src/apps/http/` imports from `src/domain/` or
  `src/apps/cli/` — including the two new views.

Proof: `scripts/e2e/http-events-proof.sh` — deterministic, no model, no outbound
network (loopback only), no server left running. Run from the repo root:

```bash
scripts/e2e/http-events-proof.sh
```

It must print `022 ok: …`. It reuses the `node:http` request helper verbatim from
`scripts/e2e/http-reads-proof.sh` — one request-helper shape per HTTP proof.

**Fixture assumptions, stated explicitly** (a proof that hides these is not
deterministic):

- The proof is **single-writer**: the fixture is built, then `serve` starts, and
  nothing appends during the read phases. Every "walks the whole feed" assertion
  is over that frozen snapshot.
- The fixture holds **well under 100 events**, so the unpaged page IS the whole
  feed and the paged-vs-unpaged comparison is valid. Phase B asserts the count is
  `< 100` before comparing.
- Phase D **forces** the ordering it needs: p2's task is created AFTER p1's last
  event, and the phase asserts `globalNextCursor > p1ScopedNextCursor` BEFORE
  asserting the `409`.
- A project with ZERO events is constructible: no `project.*` event type exists
  (`src/domain/event.ts:4-33`), so a project with no initiative and no task has
  no events, `latestProjectEventId` returns `undefined`, and rule 3 answers
  `409`.

Phases:

- **A** — a temp `KANTHORD_DB` is migrated; the CLI builds the fixture (project
  p1 with an initiative, an objective and two tasks joined by a dependency edge —
  chosen because `CreateTask` and `AddDependency` append real events, so the feed
  has deterministic content with a real `projectId` and **no daemon and no model
  are needed**), plus p2 with a later task and p3 with nothing; `serve --port 0`
  starts in an isolated working directory carrying its own `.env`; the bound port
  is read from the `listening` JSON log line; `/healthz` answers `200`.
- **B** — the feed: `GET /api/event` with no `after` → `200`, ids strictly
  ascending, count `< 100`, `nextCursor` equal to the last id, an `ETag` present,
  and no event DTO carrying a `projectId` key. Re-requesting with
  `?after=<nextCursor>` → `200`, zero events, `nextCursor` unchanged (the
  idempotent empty page). `?limit=1` → exactly one event whose id is the
  `nextCursor`; paging with that cursor walks the snapshot with no duplicate and
  no gap, and the concatenation equals the unpaged page.
- **C** — the failure surface: `?after=0` → `400 invalid_input` (the CLI sentinel
  is not accepted); `?after=` blank → `400 invalid_input`; `?limit=0`,
  `?limit=501`, `?limit=x` → `400 invalid_input`; `?project=<unknown>` → `200`
  with zero events (a filter, not a lookup — stated so a later epic does not
  "fix" it into a `404`).
- **D** — scoping and the ack: `?project=<p1>` and `?project=<p2>` return
  disjoint sets; the global cursor is asserted GREATER than p1's scoped cursor;
  acking p1 with its scoped cursor → `200` with the same value, and
  `GET /api/project/<p1>/overview` shows `digest.since` equal to it; replaying the SAME
  ack → `200` with the SAME cursor (idempotent no-op, not an error); acking an
  EARLIER cursor → `200` carrying the cursor STILL IN EFFECT, not the one sent
  (the monotonic no-op, proved on the wire); acking p1 with the GLOBAL cursor →
  `409 cursor_ahead_of_feed`; `{"cursor":"nope"}` → `400 cursor_not_ulid`; a
  missing `cursor` field → `400 invalid_input`; an unknown project id →
  `404 unknown_reference`; p3 (zero events) → `409 cursor_ahead_of_feed`.
- **E** — the inherited gates over the new rows: no `If-Match` on the ack →
  `200` (NOT `428` — the ack is a POST); an unauthenticated feed read and an
  unauthenticated ack → `401`, **and the overview proves `digest.since` did not move**;
  `Content-Type: text/plain` on the ack → `415`; `Host: evil.example` → `403`;
  `PUT /api/event` → `405`; `/api/events` (plural) → `404 unknown_route`.
- **F** — the `API_KEY` appears in no log line; `SIGTERM` shuts the server down
  and the port stops accepting.

Ran against the CURRENT tree (2026-07-30, commit `e4af497`, `ROUTES.length === 24`
because 021 is planned but not yet implemented): the script exits `1` in phase B
at the first feed request —

```
--- A: migrate, CLI fixture (p1 with events, p2 later, p3 empty), then serve
project created: 01KYS67Z4912TA3PCC4JDW3Y20
initiative created: init-one
objective created: obj-one
task created: task one
task created: task two
dependency added: 01KYS682G3NWE7WZFXVR1376FP → 01KYS681N3NQVTR5MJGN6YRSAW
project created: 01KYS6844PPRSNPF63J6K5CSM3
initiative created: init-two
objective created: obj-two
task created: task three
project created: 01KYS687DA5CNHGXTQ4K5Y6JAT
    bound port: 61414
    p1=01KYS67Z4912TA3PCC4JDW3Y20 p2=01KYS6844PPRSNPF63J6K5CSM3 p3=01KYS687DA5CNHGXTQ4K5Y6JAT
--- B: GET /api/event — the page, the continuation cursor, the ETag
FAILED: feed status — expected '200', got '404'
```

Phase A passes in full — the migration runs, the three-project CLI fixture is
created (the `task created` and `dependency added` lines are the events the feed
will serve), `serve` binds, and an authenticated `/healthz` answers `200` — so
the first failure is the missing capability, not a broken fixture.

`404` (not `405`) is the exactly right failure, and it was checked directly
against the router, not inferred:

```
$ node -e '…matchRoute(ROUTES, m, p).kind…'
GET /api/event → not_found
POST /api/project/x/acknowledgement → not_found
GET /api/events → not_found
ROUTES.length = 24
```

`ROUTES` has no row whose path is `/api/event`, so `matchRoute` returns
`not_found` (`src/apps/http/router.ts:72`) and never reaches
`method_not_allowed`; `app.ts:205-206` turns that into
`404 unknown_route`. This differs from 021's first failure (`405`, because
`/api/project` already exists as a `GET`).

## Stories

Each story keeps `npm run verify` green on its own.

- **S1 — the read model, the decoder and the views.**
  `src/app/task/read-event-page.ts` + test; `optionalQueryUlid` in `decode.ts` +
  test; `src/apps/http/views/event.ts` and `views/acknowledgement.ts` + tests;
  `PATH_SEGMENTS` gains `event` and `acknowledgement`; `error-registry.ts` gains
  `cursor_not_ulid` and `cursor_ahead_of_feed` with the one-class-per-code test.
  No row lands, so `verify` proves the additions in isolation.
- **S2 — the two rows.** `event.list` and `project.acknowledgement.create` in
  `ROUTES`; `HttpDeps` gains `readEventPage` and `ackProject`; `composition.ts`
  constructs `ReadEventPage` and exposes it; `serve.ts` populates both fields;
  `routes.test.ts`'s row count becomes 54; the per-row decode/run/present tests
  and the two `ETag` dispatch assertions.
- **S3 — the Proof and the inventory.** `scripts/e2e/http-events-proof.sh`
  (already written, already failing for the right reason) must print
  `022 ok: …`; `cli-coverage.test.ts` records the 2 claimed leaves.
  **Marking Target 022 covered in
  `.agent/plan/stories/019-http-server/retirement.md` is a HUMAN follow-up, not
  part of S3**: `scripts/lane-check.sh:13-19` exits `1` on `.agent/plan/*` for
  every role, so no story may edit the plan tree. S3 reports the follow-up at
  handoff.

## Non-goals

- **SSE, websockets, long-poll, `If-None-Match` / `304`** — pull-based per
  AGENTS.md.
- **Retention, pruning, compaction, or any `DELETE` on an event.**
- **Per-event read receipts** — the only cursor is per-project, and it is the one
  `project_acks` already holds.
- **A `hasMore` / `total` field, `?before=`, descending order, or filtering by
  `type` / task / objective** — no consumer exists yet (decision 2).
- **A real scan-watermark cursor** — it would need a new port method and a second
  query (decision 2).
- **Any change to `ListEvents`, `src/apps/cli/events.ts`, or the CLI's
  `--follow` / progress-throttle behaviour**, and no CLI leaf is retired.
- **Any UI work** — the Control Center inbox that polls this feed is Target 026 (the UI);
  022's UI-facing deliverable is the surface it polls.
- **Any change to auth, CORS, the Host check, the CSRF gate, the middleware
  order, the logger, the envelope, or 021's `location` / `readRow` / `If-Match`
  rules.**
