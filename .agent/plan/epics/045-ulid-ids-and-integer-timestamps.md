# 045 ULID ids and integer timestamps

## Outcome

Every system-**minted** id in kanthord becomes a prefixed ULID
(`<prefix>_<26-char Crockford base32>`, e.g. `evt_01J9Z3K7XQ8F2N5R6T7V8W9XYZ`)
produced by one shared generator. ULIDs are **lexicographically sortable by
creation time**, so ids sort in the order they were created — directly useful for
the audit timeline (Epic 019.5), the broker op ledger, and any future
"newest-first" listing, without a separate timestamp sort. A shared
**monotonic** factory guarantees that even ids minted in the same millisecond
still sort in creation order.

Separately, every **timestamp column** is stored as an `INTEGER` (epoch
milliseconds) — the compact, sortable representation — never a TEXT ISO string.
Timestamp columns are already `INTEGER` throughout except one
(`plan_snapshot.snapshot_at`), which this epic converts; a guard test then keeps
any new TEXT timestamp column from creeping in.

This is greenfield: there is no persisted production data, so id-format and
column-type changes need **no migration or backfill** — only the mint sites,
column definitions, and their read/write code change.

## Decision Anchors

- **Ulrich, this conversation (2026-07-11)** — adopt ULID
  (`https://github.com/ulid/javascript`, the `ulid` npm package) for every minted
  prefixed id so ids are naturally lexicographically sortable; store every
  timestamp column as bigint/INTEGER for efficient storage. Route as a dedicated
  story through the TDD loop.
- **Scope decision (this conversation)** — **minted ids only.** `task_id`,
  `node_id`, and `stage_id` are **authored** in artifact/plan frontmatter
  (`src/compiler/compile.ts` reads `taskFm.id`), not minted, so they keep their
  human-authored values and are out of scope.
- **Idempotency exclusion (audit finding, this conversation)** — inbox item ids
  are **deterministic** (`deterministicId("besc"|"apv", op_id)`,
  `src/inbox/inbox.ts:97,129`) so a retried escalation dedupes to the same row.
  They must stay deterministic; ULID would reintroduce duplicates. Out of scope.
- **Dependency** — use the `ulid` package directly (`monotonicFactory`), not a
  hand-rolled base32 encoder (spec-correctness + monotonicity are the library's
  job). Added to `package.json` at authoring time (`ulid@^3`).
- **Epic 019.5 alignment** — the timeline's sortable-id goal and the S6 "two
  calls in the same millisecond" fix motivate the **monotonic** factory: same-ms
  ids still sort in creation order.

## Stories

- `001-ulid-ids-and-integer-timestamps.md` — a shared id generator
  (`newId(prefix)` over ULID's monotonic factory) with fixed prefix constants;
  migrate every in-scope minted-id call site to it; convert the one TEXT
  timestamp column to INTEGER and guard against new TEXT timestamp columns.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — new id-generator and
  timestamp-guard suites plus all pre-existing suites, no regression. Zero-network
  guard stays green.
- **Sortable ids:** `newId(prefix)` returns `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`;
  for any two ids `a` minted before `b` (including in the same millisecond via the
  monotonic factory), `a < b` lexicographically.
- **All in-scope mint sites converted:** provider account (`acc_`), broker op
  (`op_`), timeline event (`evt_`), model call (`call_`), and budget reservation
  (`rsv_`) ids each match their prefixed-ULID pattern; no in-scope mint site still
  calls `randomUUID()` for an entity id.
- **Deterministic/authored ids untouched:** inbox item ids remain
  `deterministicId(...)`; `task_id`/`node_id`/`stage_id` remain authored values.
- **Integer timestamps:** `plan_snapshot.snapshot_at` is `INTEGER` (epoch ms); a
  guard test asserts no `CREATE TABLE` in `src/` declares a timestamp-named column
  (`*_at`, `*_ts`, `ts`, `*expires*`, `*timestamp*`) as `TEXT`.

## Dependencies

- `ulid@^3` (added to `package.json`).
- Epic 019.4 (provider-account `acct_` id — renamed to `acc_` here).
- Epic 019.5 (timeline `event_id` / per-call `call_id` — the sortable-id
  beneficiaries).
- Epics 004/005/013 (scheduler/broker/ring-1 minted ids and timestamp columns).

## Non-Goals

- **No authored-id changes.** `task_id`, `node_id`, `stage_id` stay as authored in
  plan frontmatter.
- **No inbox-id change.** Deterministic idempotency ids stay deterministic.
- **No verb-adapter `requestId` change.** The async-verb adapters' internal
  `requestId` handles (`src/broker/verbs/*.ts`) are transient, in-memory
  correlation keys returned to the broker (which owns the durable `op_id`); they
  are not durable cross-cutting entity ids. A separate follow-up may unify them.
- **No change to non-id UUIDs.** Writer-lock tokens (`src/store/writer-lock.ts`)
  and temp filenames (`src/store/git-store.ts`) are not entity ids.
- **No JS `BigInt` runtime type.** Epoch-ms fits JS `number` (< 2^53); columns are
  SQLite `INTEGER` (64-bit) — "bigint" here means the integer column, not the JS
  `BigInt` type.
- **No data migration.** Greenfield; no backfill.

## Findings Out

- `none` (unless the id-generator task discovers a real ULID-surface constraint).
