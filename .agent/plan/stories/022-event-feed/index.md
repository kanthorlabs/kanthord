# EPIC 022 — the event feed and acknowledgement — stories

Epic: `.agent/plan/epics/022-event-feed.md`
Prereq: EPIC 021 (sequence order) — `defineRoute`, the 52-row `ROUTES`, the
`location` / `readRow` fields, `src/apps/http/etag.ts`, `src/apps/http/body.ts`
(`requireBodyString`), the `PATH_SEGMENTS` + `NOT_PLURAL` tests and the 019
envelope / Basic auth / error registry / middleware order all exist and stay
running.

After these stories `kanthord serve` answers 2 more `/api` rows — 54 total —
covering `list event` and `ack project`: `GET /api/event?after=<ulid>` returns one
ascending page plus a continuation cursor, `POST /api/project/:id/acknowledgement`
answers `200` with the cursor in effect, and
`scripts/e2e/http-events-proof.sh` prints `022 ok: …`.

## Dispatch order

Strictly sequential: `01 → 02 → 03`.

- `01` must land first: the row in `02` calls `optionalQueryUlid`, `ReadEventPage`
  and both view functions, and asserts the two registry codes.
- `02` lands both rows plus every wiring edit in one story, because `HttpDeps`
  fields are REQUIRED — a row added without its `serve.ts` line does not
  typecheck.
- `03` is the Proof and the CLI-coverage inventory; it must be last.

Cumulative `ROUTES.length` after each story: `01` 52, `02` 54, `03` 54.

## Stories

- S1 — the read model, the ULID query reader, the views, the two registry codes → `01-read-model-views.md`
- S2 — the two rows plus every wiring edit → `02-feed-and-ack-rows.md`
- S3 — Proof green, CLI-coverage inventory → `03-proof-and-inventory.md`

## Facts (needed for implementation)

**`ROUTES.length` is 24 in the tree as authored, 52 after EPIC 021.** Story `02`
sets the assertion to the count that is actually in the file **plus 2**. The three
counters that move together for a new row:

1. `ROUTES.length` — `src/apps/http/routes.test.ts:248` (`assert.equal(ROUTES.length, 24);` today).
2. the expected-id list — `src/apps/http/routes.test.ts:253-276` (array literal; ids at `254-275`).
3. `expectedCovered` — `src/apps/http/cli-coverage.test.ts:67-93` (entries at `68-92`), because both rows claim CLI leaves.

`leaves.length === 80` (`cli-coverage.test.ts:48-51`) stays true: 022 adds no CLI
leaf. The "uncovered set is non-empty" assertion (`cli-coverage.test.ts:53-63`)
also stays true.

**`.agent/plan/**` is lane-forbidden to every role** (`scripts/lane-check.sh:13-19`
exits `1` for `.agent/plan/*`). So marking "Target 022 covered" in
`.agent/plan/stories/019-http-server/retirement.md` is a **human** follow-up, NOT
part of Story `03`. No story edits any file under `.agent/plan/`.

**Import boundary** (`eslint.config.js:74-78`): a non-test file under
`src/apps/http/` may import from `src/app/**` only — never `src/domain/**`. Tests
are exempt (`eslint.config.js:91-95`). Consequence: `views/event.ts` may NOT name
`Event` from `src/domain/event.ts`; it derives the row type structurally from the
app-layer output type, exactly as `views/queue.ts:4-9` does for `DecisionItem`.

**View module template** — `src/apps/http/views/health.ts:1-14`. Mirror it: a
`*Result` input type (or an imported/derived `app/` type), a `*View` output
interface carrying `readonly [key: string]: unknown;` as its LAST member, a
`*View(result)` function returning a LITERAL field list, and a leak test that
casts an over-populated object through `as unknown as` and asserts
`Object.keys(view).sort()`.

**Optional fields use a conditional spread**, never `key: undefined`
(`views/task.ts:79-99`): `...(x !== undefined ? { x } : {})`. A `key: undefined`
survives `Object.keys()` and breaks the leak tests. Value maps are copied with
`{ ...x }`, arrays with `[...x]`.

**`decode` builds its object with conditional spreads too**, because the row unit
tests assert the EXACT object the fake received with `assert.deepEqual`.

**Error classes may be imported straight from their use-case module.** Precedent:
`src/apps/http/error-registry.ts:7` imports `NoConflictCandidateError` from
`../../app/task/get-conflict.ts`, and `src/apps/cli/error-map.ts:68-71` already
imports both cursor errors from `../../app/project/ack-project.ts`. So Story `01`
adds NO re-export to `src/app/errors.ts`.

**`src/apps/http/error-registry.test.ts` has exactly ONE test that iterates
`DOMAIN_ERROR_MAPPINGS`** — "registry hygiene" at `21-42`. There is no
one-class-per-code test to extend; a new mapping is covered by a per-class
`mapError` test in the style of `44-68`. The hygiene test's snake_case regex is
`/^[a-z]+(_[a-z]+)*$/` (`:29`) — `cursor_not_ulid` and `cursor_ahead_of_feed` both
match. `ALLOWED_STATUSES` (`:17-19`) already contains `400` and `409`, so 022 adds
no status.

**`HttpDeps` is built in `src/apps/cli/commands/serve.ts:39-60`, not in
`composition.ts`.** A story that adds an `HttpDeps` field must, in the same story:

1. add the field to `src/apps/http/deps.ts` (interface `26-47`, last field `:46`);
2. populate it in the `const httpDeps: HttpDeps = { … }` literal
   (`serve.ts:39-60`).

**`ackProject` already exists end to end; `readEventPage` does not.**
`AckProject` is constructed at `src/composition.ts:210-212` (two arguments:
`projectAckRepository` and an inline `{ get: (id) => projectRepository.get(id) }`),
exposed on `CliDeps` at `src/apps/cli/deps.ts:177-178`, and returned in the deps
bundle at `composition.ts:1170`. `ReadEventPage` is new, so Story `02` also
constructs it (`composition.ts` beside `const listEvents = new ListEvents(events);`
at `:415`, where `events` is the `SqliteEventFeed` built at `:198`), declares it on
`CliDeps` (beside `listEvents: ListEvents;` at `deps.ts:227`) and returns it in the
bundle (beside `listEvents,` at `composition.ts:1210`).

**`ListEvents` and `src/apps/cli/events.ts` are NOT touched by any story.** The
CLI keeps its own paging, `limit + 1` probe, follow loop and progress throttle.
`ReadEventPage` is a separate 20-line query on the same port — the accepted
duplication (AGENTS.md).

**The dispatcher sets `ETag` on every `200` json response regardless of method**
(EPIC 021 Story S1, `app.ts` dispatch: `if (route.successStatus === 200) ctx.set("ETag", …)`).
Both 022 rows are `200` json, so BOTH carry an `ETag`, including the `POST` ack.
That is expected, not a defect — the row tests assert the header is present.

**Test framework**: `node:test` + `node:assert/strict` only, flat `test(...)` calls,
**no `describe`**. Run one file with `node --test <path>`.

**Row unit-test deps pattern** (fakes, no server, no sqlite) —
`src/apps/http/routes.task.test.ts:1-100`: module-scope `KEY`/`AUTH`/`REQUEST_ID`,
a local `makeLogger()`, a `makeDeps()` returning `{ deps, received, <counters> }`
where each use case is `{ execute: … } as HttpDeps["<field>"]` and the whole object
is closed with `as unknown as HttpDeps`; the app is built per test with
`buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID })` and driven
through `request(app.callback())`.

**`node_modules` may be absent in a fresh worktree** — run `npm ci` before the
first `npm run verify` or any `scripts/e2e/*` script.
