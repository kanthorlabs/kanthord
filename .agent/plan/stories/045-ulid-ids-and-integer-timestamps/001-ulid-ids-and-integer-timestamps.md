# Story 001 - ULID ids and integer timestamps

Epic: `.agent/plan/epics/045-ulid-ids-and-integer-timestamps.md`

## Goal

Adopt one shared ULID-based id generator for every in-scope minted id so ids are
prefixed and lexicographically sortable by creation time, and store the one
remaining TEXT timestamp column as an integer — with a guard that keeps new TEXT
timestamp columns out.

## Acceptance Criteria

- A shared `newId(prefix)` returns `` `${prefix}_${ulid}` `` where `ulid` is a
  26-character Crockford base32 string; the returned id matches
  `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`.
- For two ids `a` then `b` minted from the shared generator — **including two
  minted within the same millisecond** — `a < b` compares true (monotonic,
  creation-order-sortable).
- Each in-scope minted id uses its fixed prefix and matches the prefixed-ULID
  pattern: provider account `acc_`, broker operation `op_`, timeline event
  `evt_`, model call `call_`, budget reservation `rsv_`.
- No in-scope mint site mints an entity id with `randomUUID()` any more.
- Inbox item ids remain produced by `deterministicId(...)` (unchanged); a retried
  escalation/approval for the same `op_id` still resolves to the same item id.
- `plan_snapshot.snapshot_at` is an `INTEGER` column holding epoch milliseconds;
  values written round-trip back as a number.
- A guard test asserts that, across the tables created by `initSchema` plus the
  compiler's `plan_snapshot` table, no column whose name matches a timestamp
  pattern (`ts`, `*_ts`, `*_at`, `*expires*`, `*timestamp*`) is declared `TEXT`.

## Constraints

- **Use the `ulid` package's `monotonicFactory`** (Epic Decision: dependency) —
  create one process-wide monotonic generator in the shared id module; do not call
  bare `ulid()` per site and do not hand-roll base32. The monotonic factory is
  what makes same-millisecond ids sort in creation order ([[phase2-epic-019-5-status]] S6).
- **Minted ids only** (Epic scope decision) — do not touch `task_id`, `node_id`,
  `stage_id` (authored in plan frontmatter) or inbox `deterministicId` ids.
- **`acct_` → `acc_`** (Epic decision) — rename the provider-account prefix; this
  is the durable id format from Epic 019.4, changed here (greenfield, no backfill).
- **Integer timestamps** (Epic decision) — timestamp columns are SQLite `INTEGER`
  epoch-ms; no TEXT ISO strings. Only `snapshot_at` needs converting; the rest are
  already `INTEGER`.
- **No migration** — greenfield; change definitions and mint/read/write code only.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green (new id + timestamp-guard suites +
  all pre-existing suites, no regression); zero-network guard green.
- The id-generator, per-entity prefix, deterministic-inbox, and timestamp-guard
  ACs above are each asserted by a Task test below.

### Task T1 - shared ULID id generator

**Input:** `src/foundations/id.ts`, `src/foundations/id.test.ts`

**Action - RED:** a test imports `newId` and the prefix constants and asserts:
`newId(<prefix>)` matches `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`; 1000 sequential
`newId` calls are strictly increasing lexicographically (monotonic, same-ms
safe); the exported prefix constants have the fixed values `acc`, `op`, `evt`,
`call`, `rsv`. Fails with `ERR_MODULE_NOT_FOUND` (no `src/foundations/id.ts`).

**Action - GREEN:** implement `src/foundations/id.ts` — one module-level
`monotonicFactory()` instance from `ulid`; `export function newId(prefix: string)`
returning `` `${prefix}_${monotonic()}` ``; export the prefix constants
(`ID_PREFIX = { account: "acc", op: "op", event: "evt", call: "call",
reservation: "rsv" }` or equivalent named exports).

**Action - REFACTOR:** none.

**Verify:** `node --test src/foundations/id.test.ts` — T1 cases green.

### Task T2 - migrate minted-id call sites

**Input:** `src/agent/provider-account-registry.ts`,
`src/agent/provider-account-registry.test.ts`, `src/broker/submit.ts`,
`src/broker/submit.test.ts`, `src/broker/expiry.ts`, `src/broker/expiry.test.ts`,
`src/metrics/model-call-log.ts`, `src/metrics/model-call-log.test.ts`,
`src/metrics/task-timeline.ts`, `src/metrics/task-timeline.test.ts`,
`src/ring1/budget-reconcile.ts`, `src/ring1/budget-reconcile.test.ts`

**Action - RED:** per entity, assert the minted id matches its prefixed-ULID
pattern and that two ids minted in sequence sort ascending: provider account id
`^acc_[0-9A-HJKMNP-TV-Z]{26}$`; broker `op_id` `^op_...$`; timeline `event_id`
`^evt_...$`; model `call_id` `^call_...$`; budget `reservationId` `^rsv_...$`.
Update any existing assertion that expects `acct_` or a raw UUID. These fail now
(current ids are `acct_<uuid>` or bare `randomUUID()`).

**Action - GREEN:** replace each mint site with `newId(<prefix>)` from
`src/foundations/id.ts`: `provider-account-registry.ts:111` (`acct_${randomUUID()}`
→ `newId(account)`); `broker/submit.ts` and `broker/expiry.ts` op-id mints;
`metrics/model-call-log.ts` `call_id`; `metrics/task-timeline.ts` `event_id`;
`ring1/budget-reconcile.ts` `reservationId`.

**Action - REFACTOR:** remove the now-unused `randomUUID` import from each file
whose only use was an in-scope entity id (leave imports still used for
out-of-scope UUIDs, e.g. tokens/temp names, alone).

**Verify:** `node --test` on the six affected suites — all green; grep confirms no
in-scope mint site still calls `randomUUID()` for an entity id.

### Task T3 - integer timestamp column + guard

**Input:** `src/compiler/compile.ts`, `src/store/timestamp-columns.test.ts`

**Action - RED:** a guard test bootstraps a store (`initSchema` plus the
compiler's `plan_snapshot` table), reads each table's columns via
`PRAGMA table_info`, and asserts no column whose name matches
`ts | *_ts | *_at | *expires* | *timestamp*` has declared type `TEXT`. Fails now
because `plan_snapshot.snapshot_at` is `TEXT`.

**Action - GREEN:** in `src/compiler/compile.ts`, declare `snapshot_at INTEGER`
and change its writer to store epoch milliseconds (a number) and any reader to
treat it as a number.

**Action - REFACTOR:** none.

**Verify:** `node --test src/store/timestamp-columns.test.ts` and the compiler
suite — green; the guard asserts zero TEXT timestamp columns.
