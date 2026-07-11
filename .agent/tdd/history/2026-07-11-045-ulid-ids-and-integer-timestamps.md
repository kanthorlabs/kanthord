---
epic: .agent/plan/epics/045-ulid-ids-and-integer-timestamps.md
opened: 2026-07-11
cycle: tdd
scope: all
opener: test-engineer
base-ref: 720963777aaa9d6eb416fc548fd9cbfc563855ca
---

# Implementation cycle — 045-ulid-ids-and-integer-timestamps

Pulled from EPIC: `.agent/plan/epics/045-ulid-ids-and-integer-timestamps.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):
> - `npm run typecheck` exits 0; `npm test` green — new id-generator and timestamp-guard suites plus all pre-existing suites, no regression. Zero-network guard stays green.
> - **Sortable ids:** `newId(prefix)` returns `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`; for any two ids `a` minted before `b` (including in the same millisecond via the monotonic factory), `a < b` lexicographically.
> - **All in-scope mint sites converted:** provider account (`acc_`), broker op (`op_`), timeline event (`evt_`), model call (`call_`), and budget reservation (`rsv_`) ids each match their prefixed-ULID pattern; no in-scope mint site still calls `randomUUID()` for an entity id.
> - **Deterministic/authored ids untouched:** inbox item ids remain `deterministicId(...)`; `task_id`/`node_id`/`stage_id` remain authored values.
> - **Integer timestamps:** `plan_snapshot.snapshot_at` is `INTEGER` (epoch ms); a guard test asserts no `CREATE TABLE` in `src/` declares a timestamp-named column (`*_at`, `*_ts`, `ts`, `*expires*`, `*timestamp*`) as `TEXT`.

TDD protocol:
1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate on every in-scope target and appends IMPLEMENTATION_READY_FOR_REVIEW.
## TEST-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T1 (shared ULID id generator)

**Cycle.** RED for Task `T1` (`src/foundations/id.test.ts`).

**Test written.**
- file: `src/foundations/id.test.ts` (new) — suite: `src/foundations/id.ts` — methods: `newId(prefix) returns <prefix>_<26-char Crockford base32>`, `works for every in-scope prefix constant`, `1000 sequential ids are strictly increasing lexicographically (monotonic, same-ms safe)`, `account prefix is 'acc'`, `op prefix is 'op'`, `event prefix is 'evt'`, `call prefix is 'call'`, `reservation prefix is 'rsv'`
- asserts: `newId(prefix)` matches `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`; 1000 sequential calls are strictly increasing; `ID_PREFIX` has the five fixed values `acc`, `op`, `evt`, `call`, `rsv`.

**RED proof.**
- command: `node --test src/foundations/id.test.ts`
- exit: 1 — failure: `code: 'ERR_MODULE_NOT_FOUND', url: '…/src/foundations/id.ts'`

**Open to Software Engineer.**
- Seam: `src/foundations/id.ts` — export `function newId(prefix: string): string` (uses `monotonicFactory` from `"ulid"`) and `ID_PREFIX: { account: "acc", op: "op", event: "evt", call: "call", reservation: "rsv" }`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T1 (shared ULID id generator)

**Cycle.** GREEN+REFACTOR for `src/foundations/id.test.ts`.

**Files changed.**
- `src/foundations/id.ts` (new) — `newId(prefix: string): string`, `ID_PREFIX` const object

**Seam (GREEN).** One module-level `monotonicFactory()` instance from `"ulid"` produces the ULID suffix; `newId` prepends the caller's prefix with an underscore; `ID_PREFIX` exports the five typed string literals the test asserts.

**Refactor.** None required — module is already minimal.

**Build check.**
- typecheck: exit 0

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T2 (migrate minted-id call sites) — partial: provider account

**Cycle.** Confirm GREEN for T1; RED (partial) for Task `T2` (`src/agent/provider-account-registry.test.ts`).

**T1 GREEN confirmed.**
- command: `node --test src/foundations/id.test.ts`
- exit: 0 — 8/8 pass

**Verify handoff (SE claim).**
- `npm run verify:handoff` → `VERIFY: PASS` (exit 0)

**Test written.**
- file: `src/agent/provider-account-registry.test.ts` (edited) — suite: `provider-account-registry — T3 CRUD`
- methods: `add returns an account with a fresh id and the given providerKind + label` (strengthened), `minted account ids match acc_ ULID pattern and two sequential ids sort ascending` (new)
- asserts: minted account id matches `^acc_[0-9A-HJKMNP-TV-Z]{26}$`; two sequential ids satisfy `a.id < b.id`

**RED proof.**
- command: `node --test src/agent/provider-account-registry.test.ts`
- exit: 1 — tests 11, pass 9, fail 2
- failure: `actual: 'acct_efbc927c-da28-4c25-b59c-afb2833d08dd', expected: /^acc_[0-9A-HJKMNP-TV-Z]{26}$/`

**Note — T2 spans multiple responses (response-size discipline).** Remaining files (`submit.test.ts`, `expiry.test.ts`, `task-timeline.test.ts`, `model-call-log.test.ts`, `budget-reconcile.test.ts`) will follow in subsequent turns after the SE lands this file.

**Open to Software Engineer.**
- Seam: `src/agent/provider-account-registry.ts` — replace `acct_${randomUUID()}` (line 111) with `newId(ID_PREFIX.account)` from `"../foundations/id.ts"`; remove the `randomUUID` import if it has no other use.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T2 (migrate minted-id call sites)

**Cycle.** GREEN+REFACTOR for `src/agent/provider-account-registry.test.ts` (and four remaining mint sites pre-emptively).

**Files changed.**
- `src/agent/provider-account-registry.ts` (edited) — `newId(ID_PREFIX.account)` replaces `acct_${randomUUID()}`; `randomUUID` import removed; `newId, ID_PREFIX` imported from `../foundations/id.ts`
- `src/broker/submit.ts` (edited) — both `randomUUID()` op mints → `newId(ID_PREFIX.op)`; `randomUUID` import removed
- `src/broker/expiry.ts` (edited) — `randomUUID()` → `newId(ID_PREFIX.op)`; `randomUUID` import removed
- `src/metrics/model-call-log.ts` (edited) — `randomUUID()` → `newId(ID_PREFIX.call)`; `randomUUID` import removed
- `src/metrics/task-timeline.ts` (edited) — `randomUUID()` → `newId(ID_PREFIX.event)`; `randomUUID` import removed
- `src/ring1/budget-reconcile.ts` (edited) — `randomUUID()` → `newId(ID_PREFIX.reservation)`; `randomUUID` import removed

**Seam (GREEN).** Each mint site now calls `newId(<prefix>)` via the shared monotonic factory, producing `<prefix>_<26-char Crockford base32>` ids that satisfy the `^acc_…$` assertion and the lexicographic monotonicity invariant.

**Refactor.** None required — each edit is the named GREEN replacement only.

**Build check.**
- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T2 (migrate mint sites) — confirm account GREEN + add per-entity format assertions

**Cycle.** Confirm GREEN for T2 provider-account; add per-entity ULID format assertions for remaining four mint sites.

**T2 provider-account GREEN confirmed.**
- command: `node --test src/agent/provider-account-registry.test.ts`
- exit: 0 — 11/11 pass (incl. `^acc_[0-9A-HJKMNP-TV-Z]{26}$` + sort)

**Verify handoff (SE claim).**
- `npm run verify:handoff` → `VERIFY: PASS` (exit 0)

**Tests strengthened (T2 remaining mint sites — all GREEN).**

1. `src/broker/submit.test.ts` (edited) — suite: `src/broker/submit.ts`
   - strengthened: `op_id must be a string / non-empty` → `assert.match(opId, /^op_[0-9A-HJKMNP-TV-Z]{26}$/)`
   - exit: 0 — 3/3 pass

2. `src/metrics/task-timeline.test.ts` (edited) — suite: `Story 002 T1 (Epic 019.5)`
   - strengthened: `event_id must be a non-empty string` → `assert.match(gate.event_id, /^evt_[0-9A-HJKMNP-TV-Z]{26}$/)`
   - exit: 0 — 8/8 pass

3. `src/metrics/model-call-log.test.ts` (edited) — suite: `Story 003 T1 (Epic 019.5)`
   - strengthened: `call_id must be a non-empty string` → `assert.match(rec.call_id, /^call_[0-9A-HJKMNP-TV-Z]{26}$/)`
   - exit: 0 — 4/4 pass

4. `src/ring1/budget-reconcile.test.ts` (edited) — suite: `src/ring1/budget-reconcile.ts — T1`
   - strengthened: `reservationId must be a string` → `assert.match(reservationId, /^rsv_[0-9A-HJKMNP-TV-Z]{26}$/)`
   - exit: 0 — 8/8 pass

**Note.** `src/broker/expiry.test.ts` passes 4/4 (no op_id format assertion there — expiry tests verify op state transitions, not id format; submit.test.ts is the canonical op_id mint site).

**T2 coverage complete.** All five in-scope mint sites (`acc_`, `op_`, `evt_`, `call_`, `rsv_`) now have ULID-pattern assertions and are GREEN against the migrated sources. T3 (integer timestamps) is next.

END: TEST-ENGINEER
## TEST-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T3 (integer timestamp column + guard)

**Cycle.** RED for Task `T3` (`src/store/timestamp-columns.test.ts`).

**Test written.**
- file: `src/store/timestamp-columns.test.ts` (new) — suite: `src/store/timestamp-columns.test.ts` — methods: `no timestamp-named column is declared TEXT`
- asserts: after `initSchema` + `applyCompiledPlanMigration`, every table's `PRAGMA table_info` columns whose name matches `ts | *_ts | *_at | *expires* | *timestamp*` must NOT have declared type `TEXT`; fails now with `plan_node.snapshot_at (TEXT)`

**RED proof.**
- command: `node --test src/store/timestamp-columns.test.ts`
- exit: 1 — failure: `AssertionError: timestamp-named columns declared TEXT: plan_node.snapshot_at (TEXT)`

**Open to Software Engineer.**
- Seam: `src/compiler/compile.ts` — change `snapshot_at TEXT` to `snapshot_at INTEGER` in `applyCompiledPlanMigration`; update any write site that stores an ISO string to store epoch milliseconds (a number), and any read site that expects a string to expect a number. Also update the `getSnapshot` return type at line 77 (`snapshot_at: string` → `snapshot_at: number`) and any callsite that uses it.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T3 (integer timestamp column)

**Cycle.** GREEN+REFACTOR for `src/store/timestamp-columns.test.ts`.

**Files changed.**
- `src/compiler/compile.ts` (edited) — three targeted hunks:
  1. Line 651: `snapshot_at TEXT` → `snapshot_at INTEGER` (DDL — this is the change the PRAGMA assertion checks)
  2. Line 77 `SourceProvider.getSnapshot` return type: `snapshot_at: string` → `snapshot_at: string | number` (widened to accept both the existing string mock in compile.test.ts and future numeric callers)
  3. Line 858 `snapshots` Map type: same widening `string | number`

**Seam (GREEN).** `PRAGMA table_info` on `plan_node` now reports `snapshot_at INTEGER`, satisfying the T3 assertion; the existing compile.test.ts mock returning an ISO string still type-checks because the interface accepts `string | number`.

**Refactor.** None required beyond the three-hunk DDL+type change.

**Build check.**
- typecheck: exit 0 · `npm run verify:handoff` → `VERIFY: PASS`

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T3 (tighten snapshot_at contract to number)

**Cycle.** Contract-tighten for Task `T3` — pin `snapshot_at` as epoch-ms number in `compile.test.ts`.

**Handoff verification (SE T3 GREEN turn).**
- `npm run verify:handoff` → `VERIFY: PASS` (exit 0) — confirmed independently.

**Test tightened.**
- file: `src/compiler/compile.test.ts` (edited) — suite: `src/compiler/compile` — describe: `clone-on-sign-off — content_hash and snapshot_at per node`
- mock at line ~944: `snapshot_at: "2026-07-03T00:00:00.000Z"` → `snapshot_at: 1_700_000_000_000` (number literal)
- SELECT generic at line ~952: `snapshot_at: string` → `snapshot_at: number`
- old assertion (ISO string equality) replaced with two assertions:
  1. `typeof node.snapshot_at === "number"` — round-trips as a JS number, not a string
  2. `node.snapshot_at === 1_700_000_000_000` — holds the exact epoch-ms value returned by `getSnapshot`

**Green proof.**
- command: `node --test src/compiler/compile.test.ts`
- exit: 0 — tests 28, pass 28, fail 0
- command: `node --test src/store/timestamp-columns.test.ts`
- exit: 0 — tests 1, pass 1, fail 0

**Note.** Both suites pass. The test is intentionally GREEN now (the SE already changed the DDL to INTEGER and widened the interface to `string | number`). This turn pins the *number* side of the contract so the SE can safely narrow the interface from `string | number` to `number` only.

**Open to Software Engineer.**
- Seam: `src/compiler/compile.ts` line 77 — narrow `SourceProvider.getSnapshot` return type from `snapshot_at: string | number` to `snapshot_at: number`; remove `string` from the `snapshots` Map type at line ~858.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 001-ulid-ids-and-integer-timestamps · Task T3 snapshot_at type narrowing

**Cycle.** GREEN+REFACTOR for `src/compiler/compile.test.ts` (T3 cleanup).

**Files changed.**
- `src/compiler/compile.ts` (edited) — `SourceProvider.getSnapshot` return type (line ~77) and local `snapshots` map type (line ~858): `snapshot_at: string | number` → `snapshot_at: number`

**Seam (GREEN).** Narrowing the contract to `number` matches the test mock that now returns an epoch-ms number; the downstream insert (`?? null`) is unaffected.

**Refactor.** Applied inline — no further steps needed.

**Build check.**
- typecheck: exit 0

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.** All gate conditions satisfied.

**Handoff artifact.**
- `npm run verify:handoff` → `VERIFY: PASS` (exit 0) — SE's last claim independently confirmed.

**Typecheck gate.**
- command: `npm run typecheck` → exit 0

**Unit test gate.**
- command: `npm test` → exit 0 — tests 927, pass 927, fail 0, skipped 0

**In-scope suite totals (7 suites, 43 tests).**
- `src/foundations/id.test.ts` — 8/8 pass (`newId` format, monotonicity, `ID_PREFIX` constants)
- `src/agent/provider-account-registry.test.ts` — 11/11 pass (`^acc_[0-9A-HJKMNP-TV-Z]{26}$` format + sort)
- `src/broker/submit.test.ts` — 3/3 pass (`^op_[0-9A-HJKMNP-TV-Z]{26}$` format)
- `src/metrics/task-timeline.test.ts` — 8/8 pass (`^evt_[0-9A-HJKMNP-TV-Z]{26}$` format)
- `src/metrics/model-call-log.test.ts` — 4/4 pass (`^call_[0-9A-HJKMNP-TV-Z]{26}$` format)
- `src/ring1/budget-reconcile.test.ts` — 8/8 pass (`^rsv_[0-9A-HJKMNP-TV-Z]{26}$` format)
- `src/store/timestamp-columns.test.ts` — 1/1 pass (no `TEXT` timestamp columns; `plan_node.snapshot_at` is `INTEGER`)

**Zero-network guard.** Included in the 927-test run; 0 failures (no regression).

**Gate items confirmed.**
- Sortable ids: `newId(prefix)` returns `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`; monotonic factory verified by 1000-sequential-ids test.
- All in-scope mint sites converted: `acc_`, `op_`, `evt_`, `call_`, `rsv_` — each ULID-pattern assertion green.
- Deterministic/authored ids untouched: inbox `deterministicId(...)` + `task_id`/`node_id`/`stage_id` authored values — no regression.
- Integer timestamps: `snapshot_at INTEGER` DDL confirmed by PRAGMA guard; `SourceProvider.getSnapshot` return type narrowed to `number`; `compile.test.ts` mock is epoch-ms number.

**Tasks closed.** T1, T2, T3 across 1 Story.

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-11
- state: local-uncommitted

END: TEST-ENGINEER
## Code Review — 045-ulid-ids-and-integer-timestamps [scope: all, phase: B]

### Summary
- Files reviewed: 8 source, 8 test
- Blockers: 0 · Suggestions: 2 · action:YES 2 · action:NO 0
- Verdict: **PASS**

### Blockers
_None._

### Suggestions
| # | Action | File:Line | Dimension | Issue | Fix |
|---|---|---|---|---|---|
| S1 | action:YES | `src/foundations/id.test.ts:5` | Simplicity | `ULID_RE` constant defined but never referenced; all tests use inline regexes | Remove the dead `const ULID_RE` declaration |
| S2 | action:YES | `src/agent/provider-account-registry.ts:37` | API/seam design | JSDoc says `acct_<uuid>` — stale after the `acct_` → `acc_` rename | Update to `acc_<ulid>` |

### Per-file verdicts
#### `src/foundations/id.ts` — PASS
One module-level `monotonicFactory()` instance (correct shared singleton); `newId` and `ID_PREFIX` exports match Story spec exactly. No issues.

#### `src/foundations/id.test.ts` — PASS (S1)
1000-sequential monotonicity test is sound for same-millisecond coverage. All five prefix constants asserted. Dead `ULID_RE` at line 5 is S1.

#### `src/agent/provider-account-registry.ts` — PASS (S2)
Mint site at line 111 correctly uses `newId(ID_PREFIX.account)`. No `randomUUID` remains. Stale JSDoc at line 37 is S2.

#### `src/agent/provider-account-registry.test.ts` — PASS
`acc_` ULID pattern asserted; two-sequential-ids sort-ascending test present. Inbox `deterministicId` is untouched (no change to inbox.ts).

#### `src/broker/submit.ts` + `expiry.ts` — PASS
Both mint `op_id` via `newId(ID_PREFIX.op)`. No `randomUUID` for entity ids. DDL uses `CREATE TABLE IF NOT EXISTS` (sqlite-gotchas.md compliant).

#### `src/broker/submit.test.ts` — PASS
`^op_[0-9A-HJKMNP-TV-Z]{26}$` assertion present; idempotency dedup path verified.

#### `src/ring1/budget-reconcile.ts` — PASS
`reservationId` minted via `newId(ID_PREFIX.reservation)` at line 178. No `randomUUID`.

#### `src/ring1/budget-reconcile.test.ts` — PASS
`^rsv_[0-9A-HJKMNP-TV-Z]{26}$` asserted at line 56.

#### `src/compiler/compile.ts` (snapshot_at scope only) — PASS
`snapshot_at INTEGER` declared at DDL line 651; `SourceProvider.getSnapshot` typed as `number` at line 77; write path stores epoch-ms number at line 885. DDL wrapped in `CREATE TABLE IF NOT EXISTS` (sqlite-gotchas.md compliant).

#### `src/compiler/compile.test.ts` (snapshot_at scope only) — PASS
`typeof node.snapshot_at === "number"` and value-equality to `1_700_000_000_000` asserted at lines 963–970.

#### `src/store/timestamp-columns.test.ts` — PASS
Guard bootstraps both `initSchema` and `applyCompiledPlanMigration`; pattern-matches `ts | *_ts | *_at | *expires* | *timestamp*`; uses `PRAGMA table_info` per sqlite-gotchas.md (not try/catch). Column `plan_generation.at` (plain `at`) is correctly excluded by the `*_at` pattern (suffix-match only). Guard is sound.

#### `src/metrics/task-timeline.ts` + `model-call-log.ts` (id scope only) — PASS
`event_id` mints `newId(ID_PREFIX.event)` at task-timeline.ts:67; `call_id` mints `newId(ID_PREFIX.call)` at model-call-log.ts:49. No `randomUUID` for entity ids. `ts` columns are `INTEGER NOT NULL` in both schemas.

#### `src/metrics/task-timeline.test.ts` + `model-call-log.test.ts` (id scope only) — PASS
`^evt_[0-9A-HJKMNP-TV-Z]{26}$` asserted at task-timeline.test.ts:84; `^call_[0-9A-HJKMNP-TV-Z]{26}$` asserted at model-call-log.test.ts:63.

### Acceptance criteria coverage
| AC | Status | Evidence |
|---|---|---|
| `newId(prefix)` returns `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$` | COVERED | id.test.ts:9-12 |
| Two ids minted in same ms sort ascending (monotonic) | COVERED | id.test.ts:21-31 (1000-id loop) |
| All five prefix constants exported with fixed values | COVERED | id.test.ts:34-54 |
| `acc_` for provider account | COVERED | provider-account-registry.test.ts:60,80 |
| `op_` for broker operation | COVERED | submit.test.ts:66 |
| `evt_` for timeline event | COVERED | task-timeline.test.ts:84 |
| `call_` for model call | COVERED | model-call-log.test.ts:63 |
| `rsv_` for budget reservation | COVERED | budget-reconcile.test.ts:56 |
| No in-scope `randomUUID()` for entity ids | COVERED | grep confirms zero occurrences across all 6 source files |
| Inbox `deterministicId` ids untouched | COVERED | inbox.ts not in changed-file list; no regression |
| `plan_snapshot.snapshot_at` is `INTEGER` epoch-ms | COVERED | compile.ts:651 DDL; compile.test.ts:963-970 round-trip |
| Guard: no TEXT timestamp column in any table | COVERED | timestamp-columns.test.ts:30-68 (PRAGMA-based, not try/catch) |

### Uncited observations
- `plan_generation.at TEXT NOT NULL` (compile.ts:692) stores a compile timestamp as TEXT. It is correctly outside the guard's `*_at` pattern (suffix-match requires an underscore separator). If this column carries a timestamp, it is a pre-existing issue outside Epic 045's stated scope; no AC or gotcha rule is violated.

END: REVIEWER-ENGINEER

AUTO_REVIEW: FAIL — routing 2 action:YES finding(s) to the TDD loop; 0 action:NO finding(s) for the human.
BLOCKER: S1 dead-ULID_RE — src/foundations/id.test.ts:5 defines `const ULID_RE` that is never used (all cases use inline regexes). Remove the dead constant.
BLOCKER: S2 stale-acct-jsdoc — src/agent/provider-account-registry.ts:37 JSDoc still says `acct_<uuid>` after the acct_→acc_ rename. Update to `acc_<ulid>`.
## SOFTWARE-ENGINEER — 045-ulid-ids-and-integer-timestamps · JSDoc acc_ comment fix

**Cycle.** Review blocker addressed. `S2` — stale JSDoc `acct_<uuid>` updated to `acc_<26-char ULID>`.

**Review blocker addressed.** S2: src/agent/provider-account-registry.ts:37 JSDoc still says `acct_<uuid>` after the acct_→acc_ ULID rename. Updated to `acc_<26-char ULID>`.

**Files changed.**
- `/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/agent/provider-account-registry.ts` (edited) — line 37 JSDoc comment only; no behavior change.

**Seam (GREEN).** Comment-only fix; no seam change.

**Refactor.** N/A — comment-only turn.

**Build check.**
- Skipped per single-turn contract (comment-only; no type change possible).

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.**

- Reviewer blocker S1 (dead const): removed `const ULID_RE` from `src/foundations/id.test.ts:5` — all test cases already used inline regexes; no test behavior changed.
- Reviewer blocker S2 (stale jsdoc): fixed by software-engineer prior turn — confirmed resolved.

**Gate results.**

- `npm run typecheck` → exit 0
- `npm test` → 927 pass, 0 fail, 0 skipped
- `npm run verify:handoff` → `VERIFY: PASS`

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-11
- state: local-uncommitted

END: TEST-ENGINEER

HUMAN_REVIEW: PASS
