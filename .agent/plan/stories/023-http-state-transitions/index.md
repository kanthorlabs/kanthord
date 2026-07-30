# EPIC 023 — HTTP state transitions — stories

Epic: `.agent/plan/epics/023-http-state-transitions.md`
Prereq: EPIC 022 (sequence order) and, through it, EPIC 021 — `defineRoute`, the
54-row `ROUTES`, the `location` / `readRow` fields, `src/apps/http/etag.ts`,
`src/apps/http/body.ts` (`requireBodyString`, `optionalBodyString`,
`optionalBodyBool`), the `PATH_SEGMENTS` + `NOT_PLURAL` tests, and the 019
envelope / Basic auth / error registry / middleware order all exist and stay
running.

After these stories `kanthord serve` answers 9 more `/api` rows — 63 total —
covering the nine human verdicts (`approve` / `reject` / `retry` task and
objective, `abandon task`, `pause` / `resume initiative`), and
`scripts/e2e/http-transitions-proof.sh` prints `023 ok: …`.

## Dispatch order

Strictly sequential: `01 → 02 → 03 → 04 → 05 → 06`.

- `01` must land first: it admits `PUT`, registers the 12 error codes every later
  row raises, adds the 5 path segments, and narrows `RejectTask`'s return type
  that `02`'s `present` depends on. It lands no row.
- `02`-`05` each land rows plus every wiring edit in the same story, because
  `HttpDeps` fields are REQUIRED — a row added without its `serve.ts` line does
  not typecheck.
- `06` is the Proof and the CLI-coverage inventory; it must be last.

Cumulative `ROUTES.length` after each story: `01` 54, `02` 56, `03` 58, `04` 61,
`05` 63, `06` 63.

## Stories

- S1 — `PUT` admission, the 12 registry codes, the 5 segments, two app-layer edits → `01-registry-and-put-admission.md`
- S2 — the two task verdict rows, `views/verdict.ts`, `views/impact.ts` → `02-task-verdict-rows.md`
- S3 — the task reattempt and abandonment rows → `03-task-reattempt-and-abandonment.md`
- S4 — the three objective verdict rows → `04-objective-verdict-rows.md`
- S5 — the initiative suspension singleton (`PUT` / `DELETE`) → `05-initiative-suspension.md`
- S6 — Proof green, CLI-coverage inventory → `06-proof-and-inventory.md`

## Facts (needed for implementation)

**`ROUTES.length` is 24 in the tree as authored, 54 after EPIC 021 + 022.** Every
row story sets the assertion to the count actually in the file **plus the rows it
lands**. If the base is not 54 when `02` starts, raise an `OPEN:` blocker rather
than guessing. The three counters that move together for a new row:

1. `ROUTES.length` — `src/apps/http/routes.test.ts:248`
   (`assert.equal(ROUTES.length, 24);` today).
2. the expected-id list — `src/apps/http/routes.test.ts:253-276` (array literal;
   ids at `254-275`), looped at `277-279`.
3. `expectedCovered` — `src/apps/http/cli-coverage.test.ts:67-93`, because every
   023 row claims a CLI leaf. Story `06` owns the 023 list; `02`-`05` do not
   touch it.

`leaves.length === 80` (`cli-coverage.test.ts:48-51`) stays true: 023 adds no CLI
leaf. The "uncovered set is non-empty" assertion (`cli-coverage.test.ts:53-63`)
also stays true and is NOT edited.

**`.agent/plan/**` is lane-forbidden to every role** (`scripts/lane-check.sh:13-19`).
No story edits any file under `.agent/plan/`. Marking "Target 023 covered" in
`retirement.md` is a human follow-up.

**Import boundary** (`eslint.config.js:74-78`): a non-test file under
`src/apps/http/` may import from `src/app/**` only — never `src/domain/**`. Tests
are exempt (`eslint.config.js:91-95`). Consequence: `views/impact.ts` may NOT name
`DiscardPreview` / `Damage` from `src/domain/impact.ts` directly; it imports the
types through the `src/app/errors.ts` re-export Story `01` adds.

**View module template** — `src/apps/http/views/conflict.ts:1-24`. Mirror it: an
`import type` of the app-layer input type, a `*View` interface whose LAST member is
`readonly [key: string]: unknown;`, and a `*View(result)` function returning a
LITERAL field list that copies arrays with `[...]` and never spreads the input.

**View leak test template** — `src/apps/http/views/conflict.test.ts:7-29`: build
an input with extra `extra: "leak-me"` fields cast `as unknown as <AppType>`, then
assert `assert.deepEqual(Object.keys(view).sort(), [...])` at every level,
including nested objects and array elements.

**Optional fields use a conditional spread**, never `key: undefined`
(`views/task.ts:79-99`): `...(x !== undefined ? { x } : {})`. A `key: undefined`
survives `Object.keys()` and breaks the leak tests. Value maps are copied with
`{ ...x }`, arrays with `[...x]`.

**`decode` builds its object with conditional spreads too**, because the row unit
tests assert the EXACT object the fake received with `assert.deepEqual`.

**Error classes may be imported straight from their use-case module.** Precedent:
`src/apps/http/error-registry.ts:6` imports `NoConflictCandidateError` from
`../../app/task/get-conflict.ts`. So Story `01` adds only ONE re-export to
`src/app/errors.ts` — the three impact TYPES — and imports the six use-case-owned
error classes directly.

**`src/apps/http/error-registry.test.ts` has exactly ONE test that iterates
`DOMAIN_ERROR_MAPPINGS`** — "registry hygiene" at `21-42`. There is no
one-class-per-code test to extend; a new mapping is covered by a per-class
`mapError` test in the style of `44-68`. The snake_case regex is
`/^[a-z]+(_[a-z]+)*$/` (`:29`) — all 12 new codes match. `ALLOWED_STATUSES`
(`:17-19`) already contains `409`, so 023 adds NO status. `428` is 021's job.

**`HttpDeps` is built in `src/apps/cli/commands/serve.ts:39-60`, not in
`composition.ts`.** `composition.ts` needs NO edit in this epic: all nine use
cases are already constructed (`composition.ts:221-228, 429-473, 814-828,
1044-1106`) and already returned in `CliDeps` (`composition.ts:1177-1206`;
interface `src/apps/cli/deps.ts:186-218`) under exactly the names the rows want.
A story that adds an `HttpDeps` field must, in the same story:

1. add the `import type` (`src/apps/http/deps.ts`, last import `:20`);
2. add the `readonly` field (interface `26-47`, last field `:46`);
3. populate it in the `const httpDeps: HttpDeps = { … }` literal
   (`serve.ts:39-60`, last entry `:59`).

**`AbandonTask.execute` is SYNCHRONOUS** (`src/app/task/abandon-task.ts:104`,
returns `AbandonOutcome`, not a promise). `run: async (deps, i) =>
deps.abandonTask.execute(i)` is legal and is the required form — do not add
`await`-only wrappers and do not change the use case.

**`RejectTask.execute` returns `… | undefined` today**
(`src/app/task/reject-task.ts:147`) but no code path returns `undefined` — all six
return sites return an object (`:189,196,204,208,301,385`). Story `01` narrows the
type; Story `02`'s `present` then needs no `undefined` branch.

**`ApproveTask` returns `kind`, not `outcome`** (`approve-task.ts:29-40`), while
`AbandonTask` and `ApproveObjective` return `outcome`. The wire field is `outcome`
everywhere; `taskApprovalView` maps `kind → outcome`. `cause`
(`approve-task.ts:37`) is an arbitrary caught error and must never reach a DTO.

**`dryRun` returns BEFORE the `expectImpact` comparison**
(`reject-task.ts:203-206`, then `:205`). Any test or proof phase asserting a stale
digest must omit `dryRun`, or the comparison is never reached.

**Abandoning a non-running task is `task_not_abandonable`.** The status guard
(`abandon-task.ts:117-120`) precedes the running-job query, so `NoRunningJobError`
and `AmbiguousRunningJobError` need a live running lease and are covered ONLY with
fakes in `03`, never in the Proof.

**No 023 row uses `If-Match`.** The guards travel in the body: `expectedCommit`
(REQUIRED on the three objective rows, `assertCandidateFresh` →
`StaleCandidateError`) and `expectImpact` (optional, → `ImpactChangedError`).
No row sets `readRow`; no row sets `location` (no row answers `201`).

**The dispatcher sets `ETag` on every `200` json response regardless of method**
(EPIC 021 Story S1). The five `200` rows therefore carry an `ETag`, including the
`POST`s; the four `204` rows carry none. Row tests assert both.

**`PUT` admission touches four sites, and one is easy to miss:**

1. `src/apps/http/routes.ts:30` — `HttpMethod` gains `"PUT"`.
2. `src/apps/http/routes.test.ts:92-95` — the allowed-methods array gains
   `"PUT"`; `:96-100` (the `"PUT must never appear"` assertion) is REPLACED by the
   `PUT_ROWS` allowlist rule.
3. `src/apps/http/app.ts:153` — `allowMethods: ["GET", "POST", "PATCH",
"DELETE"]` gains `"PUT"`. **No test asserts this today**, so `05` adds one.
4. Nothing else: `requiresJsonContentType` / `requiresOriginCheck` already list
   `PUT` (`app.ts:26-39`, asserted at `app.test.ts:556-575`) and `matchRoute`
   compares `route.method` as data (`router.ts:70`).

**Test framework**: `node:test` + `node:assert/strict` only, flat `test(...)`
calls, **no `describe`**. Run one file with `node --test <path>`.

**Row unit-test deps pattern** (fakes, no server, no sqlite) —
`src/apps/http/routes.task.test.ts:1-100`: module-scope `KEY`/`AUTH`/`REQUEST_ID`,
a local `makeLogger()`, a `makeDeps()` returning `{ deps, received, <counters> }`
where each use case is `{ execute: … } as HttpDeps["<field>"]` and the whole
object is closed with `as unknown as HttpDeps`; the app is built per test with
`buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID })` and driven
through `request(app.callback())`.

**The Proof and its fixture maker already exist and already fail correctly.**
`scripts/e2e/http-transitions-proof.sh` and
`scripts/e2e/make-transitions-graph.sh` are committed with the epic and fail at
phase C with `expected '200', got '404'`. No story re-authors them; `06` only
makes them pass. If a phase turns out to assert something the epic did not
decide, that is an `OPEN:` blocker, not a licence to edit the assertion.

**`node_modules` may be absent in a fresh worktree** — run `npm ci` before the
first `npm run verify` or any `scripts/e2e/*` script.
