---
epic: .agent/plan/epics/023-http-state-transitions.md
opened: 2026-07-30
opener: test-engineer
base-ref: c2e049b2c50c5167d8216f421a4e1021b5566b34
---

# Implementation cycle — 023-http-state-transitions

Pulled from EPIC: `.agent/plan/epics/023-http-state-transitions.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
>
> Hermetic coverage required beyond the Proof:
>
> - **`routes.test.ts`**: the five new `PATH_SEGMENTS` entries with no
>   `NOT_PLURAL` addition; `PUT` accepted in the method list but ONLY for a row in
>   the one-entry `PUT_ROWS` allowlist, with a negative control proving a second
>   `PUT` row fails the policy test; the verb-ban and no-plural rules passing over
>   all nine rows; decision 10's item-scope assertion; `location` and `readRow`
>   unset on all nine; `present` set on the five `200` rows and unset on the four
>   `204` rows; the row count is the tree's base + 9.
> - **Per row, three unit tests with fakes** (the 020/021 discipline): `decode`
>   maps path + body to the exact use-case input — including `id → taskId` /
>   `objectiveId` / `initiativeId`, a blank id rejected by `requirePathParam`, a
>   missing `expectedCommit`, a missing `reason` and an out-of-range `resolution`
>   each → `400 invalid_input`; `run` calls the injected fake exactly once with
>   that input; `present` returns an object whose `Object.keys()` equal the
>   declared literal list, asserted key-by-key.
> - **Outcome coverage:** all four `ApproveOutcome` kinds present correctly with
>   `kind` mapped to `outcome`; a fake returning
>   `{kind:"landing_failed", cause:{secret:"x"}}` yields a DTO with no `cause` and
>   no `secret` anywhere in the enveloped body.
> - **Repeat semantics:** one test per line of decision 7's table, with the fake
>   returning or raising exactly what the code returns or raises.
> - **Suspension:** two `PUT`s call `PauseInitiative` twice and both answer `204`;
>   `DELETE` calls `ResumeInitiative`; neither response carries an `ETag`; a
>   `PUT` without `Content-Type: application/json` is rejected by the existing
>   gate.
> - **Not reachable from a sequential Proof, so hermetic-only:**
>   `NoRunningJobError` and `AmbiguousRunningJobError` need a live running lease,
>   so they are covered with fakes here and never asserted in the Proof.
> - **Registry:** the 12 mappings, each from exactly one class, every status
>   already in `ALLOWED_STATUSES`.
> - **App-layer changes (decision 8):** `RejectTask`'s narrowed return type
>   compiles with no `undefined` branch at any call site and its existing tests
>   stay green; the three impact types import from `src/app/errors.ts`.
> - **Boundary lint:** no file under `src/apps/http/` imports `src/domain/` or
>   `src/apps/cli/`, including the two new views.
> - **CLI-retirement inventory** (`cli-coverage.test.ts`): the nine claimed leaves
>   all name real Commander leaves, and the "uncovered set is non-empty" assertion
>   at `:53-63` still holds untouched.
>
> Proof: `scripts/e2e/http-transitions-proof.sh` — deterministic, no model, no
> outbound network (loopback and `file://` only), no server and no daemon left
> running. Run from the repo root:
>
> ```bash
> scripts/e2e/http-transitions-proof.sh
> ```
>
> It must print `023 ok: …`. The fixture is authored by
> `scripts/e2e/make-transitions-graph.sh` and needs THREE packages, because the
> three verdict shapes need three different run outcomes:
>
> - **verdict** — one task whose scripted turns write a file and then call the
>   built-in `escalate` tool (`src/agent-runner/pi.ts:554-561`; a `FakeTurnMap`
>   keyed by task title, `src/agent-runner/fake-session.ts:86-108`), so it stops at
>   `awaiting_confirmation` WITH a proposal commit (`pi.ts:717-741`,
>   `run-next-task.ts:452-470`). The proposal commit is what makes a repeated
>   approve the idempotent `200` branch instead of a `409`.
> - **integration** — one task that writes what its Verification checks, so it
>   COMPLETES and its objective reaches `awaiting_confirmation` with a `commitOid`.
>   An escalated task never completes, so the verdict package cannot also serve
>   this case (`landing-proof.sh:59-66` records the same lifecycle fact).
> - **failure** — two tasks whose turns write nothing, so each fails its own
>   Verification and reaches `failed`: one is rejected, the other re-queued.
>
> Phases:
>
> - **A** — the fixture through the CLI only: `db migrate`, a project, a `file://`
>   bare repository, a dummy provider assigned to the project (the chain must be
>   non-empty or every task fails), the three packages imported with
>   `--bind source=<repo>`, and one bounded `run daemon --until-idle` pass. The
>   daemon exits non-zero because two tasks fail on purpose, so its exit code is
>   ignored and the phase instead asserts every fixture invariant explicitly: the
>   escalated task is `awaiting_confirmation`, its `result.proposalCommit` is
>   non-empty, the objective is `awaiting_confirmation`, and both failure tasks are
>   `failed`.
> - **B** — `serve --port 0` in an isolated working directory carrying its own
>   `.env`; the bound port read from the `listening` JSON log line; an
>   authenticated `/healthz` answers `200`.
> - **C** — `POST /api/task/<id>/approval` `{}` → `200`, `outcome === "approved"`,
>   an `ETag` present, and no `kind` or `cause` key in the DTO; the task is
>   `completed`; the SAME request replayed → `200` with the same outcome.
> - **D** — `POST /api/task/<id>/rejection`
>   `{"resolution":"discard","dryRun":true}` → `200` with a `digest`, and the task
>   is still `failed` (the dry run wrote nothing). Then, **without `dryRun`**, a
>   wrong `expectImpact` → `409 impact_changed` with the status unchanged. Then the
>   fresh digest → `200` and the task is `discarded`. Then
>   `{"resolution":"retry"}` → `409 rejection_conflict`, still `discarded`.
> - **E** — `GET /api/objective/<id>` yields `commitOid`; `POST …/approval` `{}` →
>   `400 invalid_input`; with a wrong 40-hex `expectedCommit` →
>   `409 stale_candidate`, with BOTH the status unchanged AND the initiative branch
>   ref unmoved (SQLite cannot roll back a moved ref, so the refusal must precede
>   the git work); with the real one → `200 {"outcome":"integrated"}`; replayed →
>   `409 objective_not_awaiting_confirmation`.
> - **F** — `POST /api/task/<id>/reattempt` `{"note":"try harder"}` → `204`, the
>   task is `pending`, and the note is readable on `GET /api/task/<id>`; a second
>   reattempt → `409 task_not_retryable`. `POST …/abandonment` `{"reason":"stuck"}`
>   on a NON-running task → `409 task_not_abandonable` (the status guard fires
>   before the running-job query, `abandon-task.ts:117-120`); a missing `reason` →
>   `400 invalid_input`.
> - **G** — `PUT /api/initiative/<id>/suspension` `{}` → `204` with no body and no
>   `ETag`, and `paused` is `true`; a second `PUT` → `204` (idempotent);
>   `DELETE` → `204` and `paused` is `false`; a second `DELETE` → `204`.
> - **H** — the 021 convention is not weakened: `PATCH /api/initiative/<id>` with
>   no `If-Match` → `428 precondition_required`; with a stale validator →
>   `412 precondition_failed` and the name unchanged; with the real validator →
>   `200` carrying the new name and a DIFFERENT `ETag`. 023 owns no `PATCH` row, so
>   this phase is a deliberate regression check on 021 — a lost update on a verdict
>   screen is the risk that motivated the convention.
> - **I** — no bulk approval, and the gates still fire on a transition row:
>   `POST /api/task/approval` → `404 unknown_route`;
>   `POST /api/task/<id>/approve` → `404 unknown_route`;
>   `Content-Type: text/plain` → `415`; `Origin: http://127.0.0.1:1` → `403`; an
>   unauthenticated `PUT` on the suspension → `401` and `paused` proves nothing was
>   written.
> - **J** — the `API_KEY` appears in no log line; `SIGTERM` shuts the server down
>   and the port stops accepting.
>
> **Ran against the CURRENT tree** (2026-07-30, commit `e4af497`, EPIC 021 not yet
> implemented). The script exits `1` in phase C at the first verdict:
>
> ```
> --- A: fixture through the CLI only — one escalated task, one integrated-ready objective, two failed tasks
> project created: 01KYS7B268HKH4VY758T3QVFJ2
> repository created: 01KYS7B35BQ982RHSNACW82PKP
> ai-provider registered: 01KYS7B3Y0NEBQZD8YJNKY6REH
>     escalated task 01KYS7B5GA4RKS3V4NG4K4VAYE (proposal 82517df7), objective 01KYS7B6BAVA1ZJZP9N72EY92D, failed tasks 01KYS7B72XW0B3V9YNR7VT3Q6A / 01KYS7B72XW0B3V9YNR7VT3Q69
> --- B: serve on an ephemeral port
>     bound port: 65322
> --- C: approve a real escalated task over HTTP, then prove the repeat is idempotent
> FAILED: approve task status — expected '200', got '404'
> FAILED: scripts/e2e/http-transitions-proof.sh line 237
> ```
>
> Phases A and B pass in full — the three fixtures reach exactly the states the
> verdicts need, `serve` binds, and an authenticated `/healthz` answers `200` — so
> the first failure is the missing capability, not a broken fixture. `404` (not
> `405`) is the exactly right failure: `/api/task/:id/approval` is not a route at
> all, so `matchRoute` reports `not_found`. The missing thing is the transition row.

TDD protocol:

1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate and appends IMPLEMENTATION_READY_FOR_REVIEW.

## TEST-ENGINEER — S1 registry and PUT admission · RED

**Cycle.** RED for Story `01-registry-and-put-admission.md` (no `### Task`
headings in this epic's stories — the whole Story is the Task unit; its
`## Verify` section names the test targets and assertions).

**Test written.**

- file: `src/apps/http/error-registry.test.ts` (edited) — suite:
  `error-registry.test.ts` — methods: 12 new tests under
  `// ─── EPIC 023 Story S1 — the 12 verdict-row error mappings ───` asserting
  `mapError` on `StaleCandidateError`, `ObjectiveNotAwaitingConfirmationError`,
  `TaskNotAwaitingConfirmationError`, `ImpactChangedError`,
  `RejectionConflictError`, `TaskNotRetryableError`,
  `ObjectiveNotRetryableError`, `TaskNotAbandonableError`, `NoRunningJobError`,
  `AmbiguousRunningJobError`, `ProposalMissingError`,
  `ProposalWorkspaceMissingError`; plus `"023 S1: registry hygiene still
passes with the 12 new codes (27 + 12 = 39 mappings)"` pinning
  `DOMAIN_ERROR_MAPPINGS.length === 39`.
- file: `src/apps/http/routes.test.ts` (edited) — suite: `routes.test.ts` —
  added the 5 new `PATH_SEGMENTS` entries (`approval`, `rejection`,
  `reattempt`, `abandonment`, `suspension`), the test-owned `PUT_ROWS` /
  `isAllowedPutRow` allowlist, replaced the blanket `"PUT must never appear"`
  assertion with `isAllowedPutRow(route)`, and two new tests: `"PUT policy
negative control: a PUT row outside PUT_ROWS is rejected"` and
  `"transition rows are item-scoped: every verdict path carries :id"`
  (decision 10's guard, currently vacuous since no 023 row exists yet —
  becomes load-bearing from Story 02).
- asserts: every one of the 12 new error classes (all already implemented by
  prior epics — 012/task/objective work) maps through the HTTP error
  registry to its named `snake_case` code and `409` status instead of falling
  back to `internal`/500; the registry keeps exactly one mapping per class
  and 39 total once Story S1 lands.

**RED proof.**

- command: `node --test src/apps/http/error-registry.test.ts`
- exit: non-zero — failure (representative, all 12 new + the count assertion fail the same way):
  ```
  ✖ 023 S1: mapError maps ProposalWorkspaceMissingError to proposal_workspace_missing/409 (0.072833ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    + actual - expected
    + 'internal'
    - 'proposal_workspace_missing'
  ...
  ✖ 023 S1: registry hygiene still passes with the 12 new codes (27 + 12 = 39 mappings) (0.070459ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    27 !== 39
  ```
- `node --test src/apps/http/routes.test.ts` already passes (14/14) — the
  new `PUT_ROWS` / item-scope tests exercise only test-owned constants and a
  currently-empty route set, so they are not RED yet; they become load-bearing
  once Story 02 lands a row. `npm run typecheck` is clean (all 12 error
  classes already exist in `src/app/**` from prior epics; only the HTTP
  registry wiring is missing).

**Open to Software Engineer.**

- `src/apps/http/error-registry.ts` — add the imports named in Story S1 item
  5 (`StaleCandidateError`, `ObjectiveNotAwaitingConfirmationError`,
  `TaskNotAwaitingConfirmationError`, `ImpactChangedError`,
  `ProposalWorkspaceMissingError` from `../../app/errors.ts`;
  `RejectionConflictError` from `../../app/task/reject-task.ts`;
  `TaskNotRetryableError` from `../../app/task/retry-task.ts`;
  `ObjectiveNotRetryableError` from `../../app/objective/retry-objective.ts`;
  `TaskNotAbandonableError`, `NoRunningJobError`, `AmbiguousRunningJobError`
  from `../../app/task/abandon-task.ts`; `ProposalMissingError` from
  `../../app/task/approve-task.ts`) and append the 12 mappings to
  `DOMAIN_ERROR_MAPPINGS`, each `status: 409`, no `message` override.
- The rest of Story S1's `## Change` section (the `RejectTask` return-type
  narrowing, the `app/errors.ts` impact-type re-export, `HttpMethod` gaining
  `"PUT"`, `app.ts`'s `allowMethods` gaining `"PUT"`) is also open to the
  Software Engineer this turn — no test in this cycle exercises those seams
  directly yet (the `HttpMethod`/`allowMethods` PUT admission has no route
  using it until Story S5), but Story S1's own Verify section requires them
  and `npm run verify` gates on them being present per the Story file.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S1 registry and PUT admission · GREEN

**Cycle.** GREEN for Story `01-registry-and-put-admission.md`, closing the
`error-registry.test.ts` RED plus the Story's remaining open items (`routes.ts`
`HttpMethod`, `app.ts` `allowMethods`, `reject-task.ts` return-type narrowing,
`app/errors.ts` impact-type re-export). `routes.test.ts` was already edited by
the test-engineer (`PUT_ROWS` / `isAllowedPutRow` / item-scope test) and needed
no production change to pass, since it exercises test-owned constants.

**Files changed.**

- `src/apps/http/error-registry.ts` (edited) — added imports for the 12 error
  classes (5 extended from the existing `../../app/errors.ts` import, 1 from
  `../../app/task/reject-task.ts`, 1 from `../../app/task/retry-task.ts`, 1 from
  `../../app/objective/retry-objective.ts`, 3 from
  `../../app/task/abandon-task.ts`, 1 from `../../app/task/approve-task.ts`);
  appended 12 entries to `DOMAIN_ERROR_MAPPINGS` in the Story's exact order,
  each `status: 409`, no `message` override.
- `src/app/errors.ts` (edited) — added
  `export type { DiscardPreview, Damage, DamageEffect } from "../domain/impact.ts";`
  after the landing re-export block, with the one-line comment named by the
  Story.
- `src/app/task/reject-task.ts` (edited) — `RejectTask.execute`'s return type
  narrowed from `Promise<{ skipped: string[]; preview: DiscardPreview } | undefined>`
  to `Promise<{ skipped: string[]; preview: DiscardPreview }>`; no other line
  touched.
- `src/apps/http/routes.ts` (edited) — `HttpMethod` gains `"PUT"`:
  `"GET" | "POST" | "PUT" | "PATCH" | "DELETE"`.
- `src/apps/http/app.ts` (edited) — `@koa/cors` `allowMethods` gains `"PUT"`:
  `["GET", "POST", "PUT", "PATCH", "DELETE"]`.

**Seam (GREEN).** `mapError` now recognizes all 12 new error classes via
`DOMAIN_ERROR_MAPPINGS`'s `instanceof` scan, satisfying the 12 new
`error-registry.test.ts` assertions and the `39`-mapping count (27 existing

- 12). No behaviour change to `RejectTask`, `app.ts` middleware ordering, or
  route dispatch — only the method union and CORS advertisement are widened, as
  Story S1 scopes.

**Refactor.** None named beyond the GREEN edits themselves — Story S1's
`## Change` section IS the target end state; no further cleanup applies.

**Build check.**

- typecheck: exit 0 (`npm run typecheck`, `tsc --noEmit`, clean — confirms the
  `RejectTask` narrowing has no `undefined` call-site fallout, per Story
  Constraint).

**Assumptions.**

- VERIFIED: all 12 error class constructors and their export sites match the
  Story's table exactly (grepped each `export class` declaration in
  `reject-task.ts`, `retry-task.ts`, `retry-objective.ts`, `abandon-task.ts`,
  `approve-task.ts`).
- VERIFIED: `routes.test.ts` already carries the `PUT_ROWS` allowlist,
  `isAllowedPutRow`, the negative control, and the item-scope test from the
  test-engineer's RED turn — no production edit was needed for those to pass
  since they only exercise test-owned helpers and the currently-empty `ROUTES`.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S1 registry and PUT admission · confirm GREEN

**Cycle.** Confirm GREEN for Story `01-registry-and-put-admission.md`.

**Handoff verification gate.** SE's last turn claims `npm run typecheck` exit 0.
Independently re-ran `npm run verify:handoff` → `VERIFY: PASS` (also embeds a
clean `tsc --noEmit`). Gate passes.

**Confirm GREEN proof.**

- `node --test src/apps/http/error-registry.test.ts` — found ONE pre-existing
  hardcoded-count regression still red: `"021 S3: DOMAIN_ERROR_MAPPINGS.length
is 27 …"` (a test-owned invariant from a prior epic, not touched by the SE,
  now stale because Story S1 grew the array to 39). Bumped it in place to `"021
S3: DOMAIN_ERROR_MAPPINGS.length is 39 (27 existing + 023 S1's 12 new)"` /
  `assert.equal(DOMAIN_ERROR_MAPPINGS.length, 39)` — a test-file edit, in lane.
  Re-ran: 32/32 pass.
- `node --test src/apps/http/routes.test.ts` — 14/14 pass (`PUT_ROWS`,
  `isAllowedPutRow`, item-scope guard, row count 54 unchanged).
- `node --test src/app/task/reject-task.test.ts` — 15/15 pass (narrowed return
  type, no behaviour change).
- `node --test src/apps/http/app.test.ts` — 50/50 pass (`allowMethods` widened,
  middleware order untouched).
- `npm run verify` (full gate: 3257 tests, typecheck, verify:handoff, lint, db
  status) — exit 0, all green.

Story S1 is closed.

## TEST-ENGINEER — S2 task verdict rows · RED

**Cycle.** RED for Story `02-task-verdict-rows.md` (no `### Task` headings —
the whole Story is the Task unit; its `## Verify` section names the targets).

**Test written.**

- file: `src/apps/http/views/verdict.test.ts` (new) — suite: `verdict.test.ts`
  — methods: 5 tests for `taskApprovalView` over each `ApproveOutcome` variant
  (`approved`, `conflict` with/without `conflictFiles`, `target_moved`,
  `landing_failed`).
- asserts: `outcome` mirrors `result.kind` and `kind` is never a key on the
  view; `canonicalSHA` only on `approved`; `conflictFiles` only on `conflict`
  when present, copied not aliased (mutating the source array after the call
  does not change the view); `message` only on `landing_failed`; `cause` is
  never read, and `JSON.stringify(view)` never contains the secret a `cause`
  might carry.
- file: `src/apps/http/views/impact.test.ts` (new) — suite: `impact.test.ts`
  — methods: 3 tests for `discardPreviewView` and `taskRejectionView`.
- asserts: `discardPreviewView`'s top-level keys are exactly
  `counts,damage,digest`; each damage entry is exactly `effect,target`; each
  target is exactly `id,name,type`; extra input fields (cast `as unknown as
DiscardPreview`) never leak through; `counts` keys are exactly the three
  `DamageEffect` literals; `taskRejectionView`'s keys are exactly
  `preview,skipped` and `skipped` is a copy (mutating the source array
  afterwards does not change the view).
- file: `src/apps/http/routes.task.test.ts` (edited) — suite:
  `routes.task.test.ts` — added a `makeVerdictDeps()` fake-deps builder plus 9
  new tests under `// ─── EPIC 023 Story S2 — task.approval.create,
task.rejection.create ───`.
- asserts: `decode` for `task.approval.create` produces exactly `{ taskId:
"t1" }` and a blank `:id` is `400 invalid_input`; the fake is called exactly
  once and the response is `200` with an `ETag` header and no `kind` key;
  `decode` for `task.rejection.create` with `{resolution:"discard",
reason:"r", dryRun:true, expectImpact:"d"}` produces the exact matching
  object, and `{resolution:"retry"}` alone produces `{taskId,resolution}` with
  no `undefined`-valued keys; an empty body and an out-of-range `resolution`
  are each `400 invalid_input`; a fake raising `TaskNotAwaitingConfirmationError`
  / `RejectionConflictError` / `ImpactChangedError` maps through the row to
  `409` with the exact code (proves Story S1's registry rows are reachable
  through a real dispatch, not just unit-tested against `mapError` directly).
- file: `src/apps/http/routes.test.ts` (edited) — row count bumped `54 → 56`;
  `task.approval.create` and `task.rejection.create` added to the
  known-route-ids list.

**RED proof.**

- `node --test src/apps/http/views/verdict.test.ts src/apps/http/views/impact.test.ts`
  → both suites fail at import time: `ERR_MODULE_NOT_FOUND` — neither
  `./verdict.ts` nor `./impact.ts` exists yet.
- `node --test src/apps/http/routes.task.test.ts` → 9/16 fail, all nine new
  tests, representative line:
  ```
  ✖ POST /api/task/t1/approval where the fake raises TaskNotAwaitingConfirmationError is 409 task_not_awaiting_confirmation (1.134041ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    404 !== 409
  ```
  (`/api/task/:id/approval` is not yet a route, so `matchRoute` answers
  `unknown_route` → `404` — exactly the missing-capability signature the EPIC
  itself recorded for phase C).
- `node --test src/apps/http/routes.test.ts` → fails:
  ```
  ✖ every route id from the EPIC 020 and 021 route tables is present in ROUTES
    AssertionError: missing route id task.approval.create
  ```
- `npx tsc --noEmit` → 7 errors, all the missing seam:
  ```
  src/apps/http/routes.task.test.ts(198,19): error TS2339: Property 'approveTask' does not exist on type 'HttpDeps'.
  src/apps/http/routes.task.test.ts(216,19): error TS2339: Property 'rejectTask' does not exist on type 'HttpDeps'.
  src/apps/http/views/impact.test.ts(3,55): error TS2307: Cannot find module './impact.ts' or its corresponding type declarations.
  src/apps/http/views/verdict.test.ts(3,34): error TS2307: Cannot find module './verdict.ts' or its corresponding type declarations.
  ```

**Open to Software Engineer.**

- `src/apps/http/views/verdict.ts` (new) — export `taskApprovalView(result:
ApproveOutcome): TaskApprovalView` per Story S2 item 1's exact mapping
  rules (`ApproveOutcome` from `src/app/task/approve-task.ts`).
- `src/apps/http/views/impact.ts` (new) — export `discardPreviewView(result:
DiscardPreview): DiscardPreviewView` and `taskRejectionView(result: {
skipped: string[]; preview: DiscardPreview }): TaskRejectionView`, importing
  `DiscardPreview` from `../../../app/errors.ts` (Story S1's re-export), per
  Story S2 item 2.
- `src/apps/http/routes.ts` — append the two rows `task.approval.create`
  (`POST /api/task/:id/approval`) and `task.rejection.create` (`POST
/api/task/:id/rejection`) per Story S2 item 3's exact `decode`/`run`/
  `present` shapes, using `requireBodyString` / `optionalBodyString` /
  `optionalBodyBool` from `src/apps/http/body.ts`.
- `src/apps/http/deps.ts` — add `readonly approveTask: ApproveTask;` and
  `readonly rejectTask: RejectTask;` to `HttpDeps`.
- `src/apps/cli/commands/serve.ts` — wire `approveTask: deps.approveTask,` and
  `rejectTask: deps.rejectTask,` into the `httpDeps` literal (both already on
  `CliDeps`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S2 task verdict rows · GREEN (blocked on test-file cast)

**Cycle.** GREEN for Story `02-task-verdict-rows.md`, closing the RED left by
the test-engineer's last turn (`views/verdict.test.ts`, `views/impact.test.ts`,
`routes.task.test.ts`'s 9 new tests, `routes.test.ts`'s row-count bump).

**Files changed.**

- `src/apps/http/views/verdict.ts` (new) — `taskApprovalView(result:
ApproveOutcome): TaskApprovalView`, mapping `kind → outcome`, conditional
  spreads for `canonicalSHA` / `conflictFiles` (copied via `[...]`) /
  `message`, never reading or emitting `cause`, per Story S2 item 1 exactly.
- `src/apps/http/views/impact.ts` (new) — `discardPreviewView(result:
DiscardPreview): DiscardPreviewView` and `taskRejectionView(result: {
skipped: string[]; preview: DiscardPreview }): TaskRejectionView`, both
  importing `DiscardPreview` from `../../../app/errors.ts` (Story S1's
  re-export), per Story S2 item 2 exactly (literal `damage`/`counts`/`digest`
  mapping, `skipped` copied with `[...]`).
- `src/apps/http/routes.ts` (edited) — imported `taskApprovalView` from
  `./views/verdict.ts` and `taskRejectionView` from `./views/impact.ts`;
  appended the two rows `task.approval.create` and `task.rejection.create` at
  the end of `ROUTES`, per Story S2 item 3's exact `decode`/`run`/`present`
  shapes (using the already-imported `requireBodyString` /
  `optionalBodyString` / `optionalBodyBool` from `./body.ts`). One necessary
  deviation from the Story's literal snippet: `resolution: resolution as
"retry" | "discard"` instead of the shorthand `resolution,` — the
  conditional-spread return object otherwise widens `resolution`'s inferred
  type back to `string` (verified: a minimal repro with the same
  `{ x, ...(cond ? {y} : {}) }` shape against an explicitly-typed return
  loses literal narrowing even though the guard above already proved `x` is
  `"retry" | "discard"`), which fails `deps.rejectTask.execute(input)` at the
  `run` line. The `as` is a safe assertion over an already-validated value,
  not a widening of `RejectTask`'s accepted input.
- `src/apps/http/deps.ts` (edited) — added `import type { ApproveTask }` /
  `import type { RejectTask }`; added `readonly approveTask: ApproveTask;` and
  `readonly rejectTask: RejectTask;` to `HttpDeps`.
- `src/apps/cli/commands/serve.ts` (edited) — added `approveTask:
deps.approveTask,` and `rejectTask: deps.rejectTask,` to the `httpDeps`
  literal.

**Seam (GREEN).** The two new rows dispatch through the existing
`RouteDefinition` machinery to the injected `approveTask` / `rejectTask`
instances; `taskApprovalView` / `taskRejectionView` present their results with
the exact literal key sets the new `views/*.test.ts` suites assert, closing
the `ERR_MODULE_NOT_FOUND` RED and the `routes.task.test.ts` / `routes.test.ts`
RED for the two new route ids.

**Refactor.** None named beyond the GREEN edits — Story S2's `## Change`
section IS the target end state.

**Build check.**

- typecheck: **NOT clean** — one error remains, confined entirely to
  `src/apps/http/routes.task.test.ts(199,17)` (a test file, out of my lane):
  ```
  error TS2352: Conversion of type '{ execute: (input: unknown) => Promise<{
  skipped: never[]; preview: {...} }> }' to type 'RejectTask' may be a mistake
  because neither type sufficiently overlaps with the other. ... is missing
  the following properties from type 'RejectTask': #store, #queue, #feed,
  #uow, #buildPreview
  ```

**Root-cause investigation (verified, not guessed).** I reproduced this in
isolation against the real `RejectTask` class outside the test file (scratch
file, deleted before this turn): a plain interface with the identical
`execute` signature (no private fields) casts fine; `ApproveTask` (same
private-field style) casts fine for an equally-nested literal return; only
`RejectTask`, cast via a single `as RejectTask` on a FRESH literal whose
`execute` resolves to a nested object literal (the `{skipped, preview:
{damage, counts, digest}}` shape), fails TS's bidirectional "sufficient
overlap" comparability check. Casting the same fake through `as unknown as
RejectTask` (or building the returned object via an intermediate typed
variable instead of an inline literal) compiles cleanly — this is exactly the
pattern the test file already uses one level up, at line 217
(`} as unknown as HttpDeps;`), and inside `makeDeps()` at line 79. This is a
TypeScript comparability quirk tied to this exact class's private-field shape
plus a fresh nested-literal cast, not a defect in `RejectTask`, `HttpDeps`, or
any file in my lane — production types match Story S2 and Story S1's
directives exactly (`readonly rejectTask: RejectTask;`, unchanged), and I
cannot narrow or reshape that type without violating "never weaken a
spec-required field" (AGENTS.md / instructions).

**Open to Test Engineer.** `src/apps/http/routes.task.test.ts:199` — the
`rejectTask` fake's cast `} as HttpDeps["rejectTask"],` (line 216) needs
`as unknown as HttpDeps["rejectTask"]` (matching the file's own existing
pattern at lines 79 and 217) so the inner assertion doesn't fail TS's
comparability check before the outer `as unknown as HttpDeps` ever runs. No
other line needs to change; `approveTask`'s cast at line 198 is unaffected
(it does not exhibit the same comparability failure) and needs no edit.

**Assumptions.**

- VERIFIED: reproduced the TS2352 failure against the real `RejectTask` /
  `HttpDeps` types in an isolated scratch file (created and deleted this
  turn, never committed), confirming it is inherent to the class shape + cast
  syntax and not caused by any edit in this turn's `Input:` files.
- VERIFIED: `npx tsc --noEmit` reports exactly the one error above; no other
  diagnostic anywhere in the tree.

ATTEMPT-FAILED: S2 — typecheck blocked by a pre-existing test-file cast (`routes.task.test.ts:216`) that fails TS's comparability check against the real `RejectTask` class; fix is a one-line `as unknown as` change in the test file, outside my lane.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S2 task verdict rows · confirm GREEN

**Cycle.** Confirm GREEN for Story `02-task-verdict-rows.md`, repairing three
test-file bugs found while confirming (all test-file edits, in TE's lane per
the existing precedent for test-owned invariants).

**Handoff verification gate.** SE's last turn (`ATTEMPT-FAILED: S2`) did not
claim a clean typecheck — it reported one remaining `tsc --noEmit` error,
scoped entirely to `routes.task.test.ts:216` (a test file), and asked the
test-engineer to fix the cast. Independently confirmed the SE's diagnosis by
re-running `npx tsc --noEmit` myself: exactly the one TS2352 error the SE
quoted, nothing else, confined to that line.

**Repairs made (test files only, no production edit).**

1. `src/apps/http/routes.task.test.ts:216` — changed
   `} as HttpDeps["rejectTask"],` to `} as unknown as HttpDeps["rejectTask"],`,
   matching the file's own existing pattern at lines 79/217, per the SE's
   exact diagnosis. `npx tsc --noEmit` → exit 0, clean.
2. `src/apps/http/routes.task.test.ts:244-245` — the new approval test read
   `res.body.outcome` / `"kind" in res.body`, but every route response is
   enveloped under `data` (confirmed against sibling suites:
   `app.test.ts:332`, `routes.project.test.ts:199`, etc. all read
   `res.body.data.*`). Fixed to `res.body.data.outcome` /
   `"kind" in res.body.data` — a test-authoring bug in my own prior RED turn,
   not a production defect.
3. `src/apps/http/cli-coverage.test.ts:145-152` — the hardcoded
   "uncovered set shrank … " count (`24`) is a test-owned invariant computed
   over `ROUTES`' `cliCommands`; Story S2 added `task.approval.create` /
   `task.rejection.create`, whose `cliCommands` are `approve task` /
   `reject task` — both previously uncovered leaves — so the uncovered count
   correctly drops to `22`. Same class of staleness as 021 S3's
   `DOMAIN_ERROR_MAPPINGS.length` fix in the prior turn. Bumped the assertion
   and its comment to `22`, renamed the test to mention 023 S2's 2 leaves.
   The Story's own gate line ("the 'uncovered set is non-empty' assertion at
   `:53-63` still holds untouched") is unaffected — that is a _different_
   test at lines 53-63 and was never touched.

**Confirm GREEN proof.**

- `npx tsc --noEmit` → exit 0.
- `node --test src/apps/http/routes.task.test.ts` → 16/16 pass.
- `node --test src/apps/http/views/verdict.test.ts src/apps/http/views/impact.test.ts src/apps/http/routes.test.ts` → 22/22 pass.
- `node --test src/apps/http/cli-coverage.test.ts` → 6/6 pass.
- `npm run verify:handoff` → `VERIFY: PASS` (embeds a clean `tsc --noEmit`).
- `npm test` (full suite) → `tests 3274 / pass 3274 / fail 0`.
- `npm run verify` (typecheck + test + verify:handoff + lint + db status) →
  exit 0 end to end: `VERIFY: PASS`, `eslint .` clean, `db status` printed
  with `schema: 29`, no failing gate.

Story S2 is closed.

## TEST-ENGINEER — S3 task reattempt and abandonment · RED

**Cycle.** RED for Story `03-task-reattempt-and-abandonment.md` (no `###
Task` headings — the whole Story is the Task unit; its `## Verify` section
names the test targets).

**Test written.**

- file: `src/apps/http/views/verdict.test.ts` (edited) — added 4 tests for
  `abandonmentView` (`{outcome, taskId}` exactly, for both `abandoning` and
  `already_abandoning` outcomes; no extra key leaks).
- file: `src/apps/http/routes.task.test.ts` (edited) — extended
  `makeVerdictDeps()` with `retryTask` / `abandonTask` fakes and added 11 new
  tests under `// ─── EPIC 023 Story S3 — task.reattempt.create,
task.abandonment.create ───`.
- asserts: `decode` for `task.reattempt.create` from `{note, rebuild,
carryNote}` produces exactly `{taskId, note, rebuild, carryNote}` with no
  `undefined`-valued keys when the optional fields are absent, and a blank
  `:id` is `400 invalid_input`; `run` calls `retryTask.execute` exactly once
  and the row answers `204` with no body and no `ETag`; `decode` for
  `task.abandonment.create` requires `reason` (missing → `400 invalid_input`)
  and produces exactly `{taskId, reason}`; `run` calls `abandonTask.execute`
  exactly once and `present` maps the `AbandonOutcome` to `{outcome, taskId}`
  at `200`; a fake `retryTask.execute` raising `TaskNotRetryableError` maps to
  `409 task_not_retryable`; a fake `abandonTask.execute` raising
  `TaskNotAbandonableError` maps to `409 task_not_abandonable`; a fake raising
  `NoRunningJobError` maps to `409 no_running_job`; a fake raising
  `AmbiguousRunningJobError` maps to `409 ambiguous_running_job` (the two
  running-job errors named by the EPIC as "not reachable from a sequential
  Proof, so hermetic-only").
- file: `src/apps/http/routes.test.ts` (edited) — row count bumped `56 → 58`;
  `task.reattempt.create` and `task.abandonment.create` added to the
  known-route-ids list.

**RED proof.**

- command: `node --test src/apps/http/views/verdict.test.ts`
- exit: non-zero — module-load failure (named export missing):
  ```
  SyntaxError: The requested module './verdict.ts' does not provide an export named 'abandonmentView'
  ```
- command: `node --test src/apps/http/routes.task.test.ts`
- exit: non-zero — 11/27 fail, all eleven new tests, representative line:
  ```
  ✖ POST /api/task/t1/reattempt decodes {note,rebuild,carryNote} exactly, calls the fake once, answers 204 with no ETag (1.778375ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    404 !== 204
  ```
  (`/api/task/:id/reattempt` and `/api/task/:id/abandonment` are not yet
  routes, so `matchRoute` answers `unknown_route` → `404`; the blank-id and
  blank-reason 400-expecting tests likewise see `404` first, for the same
  missing-route reason.)
- command: `node --test src/apps/http/routes.test.ts`
- exit: non-zero — 2 failures:
  ```
  ✖ ROUTES holds exactly 58 rows: … — AssertionError: 56 !== 58
  ✖ every route id from the EPIC 020 and 021 route tables is present in ROUTES
    AssertionError: missing route id task.reattempt.create
  ```
- command: `npx tsc --noEmit`
- exit: non-zero — 8 errors, all the missing seam:
  ```
  src/apps/http/routes.task.test.ts(242,30): error TS2339: Property 'retryTask' does not exist on type 'HttpDeps'.
  src/apps/http/routes.task.test.ts(249,30): error TS2339: Property 'abandonTask' does not exist on type 'HttpDeps'.
  src/apps/http/routes.task.test.ts(484,8): error TS2339: Property 'retryTask' does not exist on type 'HttpDeps'.
  src/apps/http/routes.task.test.ts(520,8): error TS2339: Property 'abandonTask' does not exist on type 'HttpDeps'.
  src/apps/http/routes.task.test.ts(569,8): error TS2339: Property 'abandonTask' does not exist on type 'HttpDeps'.
  src/apps/http/routes.task.test.ts(587,8): error TS2339: Property 'abandonTask' does not exist on type 'HttpDeps'.
  src/apps/http/routes.task.test.ts(605,8): error TS2339: Property 'abandonTask' does not exist on type 'HttpDeps'.
  src/apps/http/views/verdict.test.ts(3,28): error TS2305: Module '"./verdict.ts"' has no exported member 'abandonmentView'.
  ```

**Open to Software Engineer.**

- `src/apps/http/views/verdict.ts` — add `abandonmentView(result:
AbandonOutcome): { outcome: string; taskId: string }` per Story S3's
  literal `{outcome, taskId}` mapping, importing `AbandonOutcome` from
  `src/app/task/abandon-task.ts`.
- `src/apps/http/routes.ts` — append `task.reattempt.create` (`POST
/api/task/:id/reattempt` → `204`, `RetryTask`, body `{note?, rebuild?,
carryNote?}`) and `task.abandonment.create` (`POST
/api/task/:id/abandonment` → `200`, `AbandonTask`, body `{reason}`
  REQUIRED) per Story S3 item 3's exact `decode`/`run`/`present` shapes.
- `src/apps/http/deps.ts` — add `readonly retryTask: RetryTask;` and
  `readonly abandonTask: AbandonTask;` to `HttpDeps`.
- `src/apps/cli/commands/serve.ts` — wire `retryTask: deps.retryTask,` and
  `abandonTask: deps.abandonTask,` into the `httpDeps` literal (both already
  on `CliDeps`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S3 task reattempt and abandonment · GREEN

**Cycle.** GREEN for Story `03-task-reattempt-and-abandonment.md`, closing the
RED left by the test-engineer's last turn (`views/verdict.test.ts`'s
`abandonmentView` tests, `routes.task.test.ts`'s 11 new tests,
`routes.test.ts`'s row-count bump to 58).

**Files changed.**

- `src/apps/http/views/verdict.ts` (edited) — added
  `import type { AbandonOutcome } from "../../../app/task/abandon-task.ts";`
  and the third export, `AbandonmentView` interface + `abandonmentView(result:
AbandonOutcome): AbandonmentView` returning `{ outcome: result.outcome,
taskId: result.taskId }`, per Story S3 item 1 verbatim (no conditional
  spread needed — both variants carry both fields).
- `src/apps/http/routes.ts` (edited) — imported `abandonmentView` alongside
  the existing `taskApprovalView` import; appended two rows at the end of
  `ROUTES`:
  - `task.reattempt.create` — `POST /api/task/:id/reattempt`, `successStatus:
204`, no `present`, `decode` building `{taskId, note?, rebuild?,
carryNote?}` via `optionalBodyString`/`optionalBodyBool` with the
    conditional-spread pattern (no `undefined`-valued keys), `run: async
(deps, input) => deps.retryTask.execute(input)`.
  - `task.abandonment.create` — `POST /api/task/:id/abandonment`,
    `successStatus: 200`, `decode` building `{taskId, reason}` with
    `reason` via `requireBodyString` (required, per Story S3's explicit
    warning not to make it optional), `run: async (deps, input) =>
deps.abandonTask.execute(input)` (the `async` wrapper is required form
    since `AbandonTask.execute` is synchronous — no `await` gymnastics
    added), `present: (result) => abandonmentView(result)`.
- `src/apps/http/deps.ts` (edited) — added
  `import type { RetryTask } from "../../app/task/retry-task.ts";` and
  `import type { AbandonTask } from "../../app/task/abandon-task.ts";`;
  added `readonly retryTask: RetryTask;` and `readonly abandonTask:
AbandonTask;` to `HttpDeps`.
- `src/apps/cli/commands/serve.ts` (edited) — added `retryTask:
deps.retryTask,` and `abandonTask: deps.abandonTask,` to the `httpDeps`
  literal (both already present on `CliDeps` at `src/apps/cli/deps.ts:210,220`,
  so no upstream wiring change was needed).

**Seam (GREEN).** The two new rows dispatch through the existing
`RouteDefinition`/`defineRoute` machinery to the injected `retryTask` /
`abandonTask` instances; `abandonmentView` presents the `AbandonTask` result
with the exact `{outcome, taskId}` key set the `views/verdict.test.ts` suite
asserts, and the `204` row's absent `present` satisfies the no-body/no-`ETag`
policy test in `routes.test.ts`.

**Refactor.** None named beyond the GREEN edits — Story S3's `## Change`
section IS the target end state.

**Build check.**

- typecheck: exit 0 (`npm run typecheck`, `tsc --noEmit`, clean).

**Assumptions.**

- VERIFIED: `AbandonTask.execute` is synchronous
  (`src/app/task/abandon-task.ts:104`), matching the Story's explicit note;
  the `run` arrow still returns a `Promise` via the `async` wrapper, matching
  the shape every other row uses.
- VERIFIED: `CliDeps` already carries `retryTask` (line 210) and
  `abandonTask` (line 220) in `src/apps/cli/deps.ts`, so `serve.ts`'s new
  lines type-check against existing fields with no upstream change.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S3 task reattempt and abandonment · confirm GREEN

**Cycle.** Confirm GREEN for Story `03-task-reattempt-and-abandonment.md`,
repairing three test-file bugs found while confirming (all test-file edits, in
TE's lane per the existing precedent for test-owned invariants).

**Handoff verification gate.** SE's last turn claims a clean `npm run
typecheck`. Independently re-ran `npm run verify:handoff` → `VERIFY: PASS`
(embeds a clean `tsc --noEmit`). Gate passes.

**Repairs made (test files only, no production edit).**

1. `src/apps/http/routes.task.test.ts` — the S3 RED turn's `retryTaskCalls` /
   `abandonTaskCalls` counters were destructured out of `makeVerdictDeps()`'s
   return object at call time, freezing the getter's value at `0` before the
   HTTP request ran (`const { deps, received, retryTaskCalls } =
makeVerdictDeps();` reads the getter immediately, not after the call).
   Fixed both `"POST /api/task/t1/reattempt … calls the fake once …"` and
   `"POST /api/task/t1/abandonment … calls the fake once …"` to keep the
   returned object (`const verdictDeps = makeVerdictDeps();`) and read
   `verdictDeps.retryTaskCalls` / `verdictDeps.abandonTaskCalls` after the
   request — a test-authoring bug in my own prior RED turn, not a production
   defect.
2. `src/apps/http/cli-coverage.test.ts:145-153` — the hardcoded "uncovered set
   shrank by …" count is a test-owned invariant over `ROUTES`' `cliCommands`;
   Story S3 added `task.reattempt.create` / `task.abandonment.create`, whose
   `cliCommands` are `retry task` / `abandon task` — both previously
   uncovered leaves — so the uncovered count correctly drops from `22` to
   `20`. Same class of staleness as the S2 turn's fix. Bumped the assertion,
   its comment, and the test name to mention Story S3's 2 leaves. The
   Story's own gate line ("do not touch `cli-coverage.test.ts` (Story S6 owns
   it)" belongs to S4, not S3 — S3's own Verify section required no such
   restriction) and the `:53-63` non-empty-uncovered-set assertion are
   unaffected.

**Confirm GREEN proof.**

- `node --test src/apps/http/routes.task.test.ts` → 27/27 pass (stable across
  3 repeated runs; the flaky-looking failure on `NoRunningJobError` in the
  first raw run was a side effect of the frozen-getter bug's timing, not an
  independent flake — gone after the fix).
- `node --test src/apps/http/views/verdict.test.ts` → 8/8 pass
  (`abandonmentView`).
- `node --test src/apps/http/routes.test.ts` → 14/14 pass (row count 58).
- `node --test src/apps/http/cli-coverage.test.ts` → 6/6 pass.
- `npx tsc --noEmit` → exit 0.
- `npm run verify` (typecheck + test + verify:handoff + lint + db status) →
  exit 0 end to end: 3288 tests / 3287 pass before the `cli-coverage.test.ts`
  fix (1 fail, the stale-count assertion above), then re-ran clean after the
  bump.

Story S3 is closed.

## TEST-ENGINEER — S4 objective verdict rows · RED

**Cycle.** RED for Story `04-objective-verdict-rows.md` (no `### Task`
headings — the whole Story is the Task unit; its `## Verify` section names
the test targets).

**Test written.**

- file: `src/apps/http/views/verdict.test.ts` (edited) — added 2 tests for
  `objectiveApprovalView` (`integrated`, `conflict`), each proving the view
  has exactly the `["outcome"]` key and drops an `extra` field on the input.
- file: `src/apps/http/views/impact.test.ts` (edited) — added 2 tests for
  `objectiveRejectionView`: exact top-level key `["preview"]` with the
  nested preview's keys exactly `counts,damage,digest`; and a negative
  assertion that the view never carries a `skipped` key (unlike
  `taskRejectionView`).
- file: `src/apps/http/routes.verdict.test.ts` (new) — suite:
  `routes.verdict.test.ts` — 17 tests, following the `routes.conflict.test.ts`
  fakes-only precedent, covering all three new rows:
  - `objective.approval.create`: `decode` maps `{expectedCommit}` → exactly
    `{objectiveId, expectedCommit}`; an empty body and a blank
    `expectedCommit` are each `400 invalid_input` with the fake uncalled; a
    blank `:id` is `400 invalid_input`; the row calls the fake once and
    answers `200` with `data.outcome === "integrated"` and an `ETag`; a fake
    returning `{outcome:"conflict"}` ALSO answers `200` (decision 4 — not
    `409`); fakes raising `StaleCandidateError` /
    `ObjectiveNotAwaitingConfirmationError` map to `409 stale_candidate` /
    `409 objective_not_awaiting_confirmation`.
  - `objective.rejection.create`: `decode` maps the full body
    `{expectedCommit, reason, dryRun, expectImpact}` exactly; with only
    `expectedCommit` the decoded input carries no `resolution` key (proving
    decision 6's split); an empty body and a blank `:id` are `400
invalid_input`; a fake raising `ImpactChangedError` maps to `409
impact_changed`.
  - `objective.reattempt.create`: `decode` maps `{expectedCommit, note}`
    exactly; the row answers `204` with an empty body and no `ETag`; an
    empty body and a blank `:id` are `400 invalid_input`; a fake raising
    `ObjectiveNotRetryableError` maps to `409 objective_not_retryable`.
- file: `src/apps/http/routes.test.ts` (edited) — row count bumped `58 → 61`;
  `objective.approval.create`, `objective.rejection.create`,
  `objective.reattempt.create` added to the known-route-ids list. The
  existing item-scope test iterates `ROUTES` directly, so no edit was needed
  there for the new rows to become load-bearing.

**RED proof.**

- command: `node --test src/apps/http/views/verdict.test.ts
src/apps/http/views/impact.test.ts`
- exit: non-zero — both suites fail at import time (named export missing):
  ```
  error TS2305: Module '"./verdict.ts"' has no exported member 'objectiveApprovalView'.
  error TS2305: Module '"./impact.ts"' has no exported member 'objectiveRejectionView'.
  ```
- command: `node --test src/apps/http/routes.verdict.test.ts`
- exit: non-zero — 17/17 fail, all new tests, representative line:
  ```
  ✖ POST /api/objective/o1/approval calls the fake once, answers 200 with data.outcome integrated and an ETag
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    404 !== 200
  ```
  (none of the three objective verdict paths is a route yet, so `matchRoute`
  answers `unknown_route` → `404` for every request — the same
  missing-capability signature the EPIC records for phase C/E, now over the
  objective rows).
- command: `node --test src/apps/http/routes.test.ts`
- exit: non-zero — 2 failures:
  ```
  ✖ ROUTES holds exactly 61 rows: … — AssertionError: 58 !== 61
  ✖ every route id from the EPIC 020 and 021 route tables is present in ROUTES
    AssertionError: missing route id objective.approval.create
  ```
- command: `npx tsc --noEmit`
- exit: non-zero — 7 errors, all the missing seam:
  ```
  src/apps/http/routes.verdict.test.ts(134,8): error TS2339: Property 'approveObjective' does not exist on type 'HttpDeps'.
  src/apps/http/routes.verdict.test.ts(165,8): error TS2339: Property 'approveObjective' does not exist on type 'HttpDeps'.
  src/apps/http/routes.verdict.test.ts(183,8): error TS2339: Property 'approveObjective' does not exist on type 'HttpDeps'.
  src/apps/http/routes.verdict.test.ts(279,8): error TS2551: Property 'rejectObjective' does not exist on type 'HttpDeps'.
  src/apps/http/routes.verdict.test.ts(348,8): error TS2551: Property 'retryObjective' does not exist on type 'HttpDeps'.
  src/apps/http/views/impact.test.ts(6,3): error TS2305: Module '"./impact.ts"' has no exported member 'objectiveRejectionView'.
  src/apps/http/views/verdict.test.ts(6,3): error TS2305: Module '"./verdict.ts"' has no exported member 'objectiveApprovalView'.
  ```

**Open to Software Engineer.**

- `src/apps/http/views/verdict.ts` — add `objectiveApprovalView(result:
{outcome: "integrated" | "conflict"}): ObjectiveApprovalView` per Story S4
  item 1's exact literal mapping (no imported result type — `ApproveObjective`
  exports none).
- `src/apps/http/views/impact.ts` — add `objectiveRejectionView(result:
{preview: DiscardPreview}): ObjectiveRejectionView` per Story S4 item 2's
  exact literal mapping (no `skipped` field).
- `src/apps/http/routes.ts` — append the three rows `objective.approval.create`
  (`POST /api/objective/:id/approval`), `objective.rejection.create` (`POST
/api/objective/:id/rejection`, no `resolution` field), and
  `objective.reattempt.create` (`POST /api/objective/:id/reattempt`, `204`,
  no `present`) per Story S4 item 3's exact `decode`/`run`/`present` shapes.
- `src/apps/http/deps.ts` — add `readonly approveObjective: ApproveObjective;`,
  `readonly rejectObjective: RejectObjective;`, `readonly retryObjective:
RetryObjective;` to `HttpDeps`.
- `src/apps/cli/commands/serve.ts` — wire `approveObjective:
deps.approveObjective,`, `rejectObjective: deps.rejectObjective,`,
  `retryObjective: deps.retryObjective,` into the `httpDeps` literal (all
  already on `CliDeps`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S4 objective verdict rows · GREEN

**Cycle.** GREEN for Story `04-objective-verdict-rows.md`, closing the RED left
by the test-engineer's last turn (`views/verdict.test.ts`'s
`objectiveApprovalView` tests, `views/impact.test.ts`'s
`objectiveRejectionView` tests, `routes.verdict.test.ts`'s 17 new tests,
`routes.test.ts`'s row-count bump to 61).

**Files changed.**

- `src/apps/http/views/verdict.ts` (edited) — added `ObjectiveApprovalView`
  interface + `objectiveApprovalView(result: {outcome: "integrated" |
"conflict"}): ObjectiveApprovalView` returning `{outcome: result.outcome}`,
  per Story S4 item 1 verbatim (no imported result type — `ApproveObjective`
  exports none).
- `src/apps/http/views/impact.ts` (edited) — added `ObjectiveRejectionView`
  interface + `objectiveRejectionView(result: {preview: DiscardPreview}):
ObjectiveRejectionView` returning `{preview: discardPreviewView(result.preview)}`,
  per Story S4 item 2 verbatim (no `skipped` field, unlike `taskRejectionView`).
- `src/apps/http/routes.ts` (edited) — imported `objectiveApprovalView`
  alongside the existing verdict imports and `objectiveRejectionView` alongside
  the existing impact import; appended three rows at the end of `ROUTES`:
  - `objective.approval.create` — `POST /api/objective/:id/approval`,
    `successStatus: 200`, `decode` building `{objectiveId, expectedCommit}`
    (`expectedCommit` via `requireBodyString`, REQUIRED), `run: async (deps,
input) => deps.approveObjective.execute(input)`, `present: (result) =>
objectiveApprovalView(result)`.
  - `objective.rejection.create` — `POST /api/objective/:id/rejection`,
    `successStatus: 200`, `decode` building `{objectiveId, expectedCommit,
reason?, dryRun?, expectImpact?}` via the conditional-spread pattern (no
    `resolution` field, per epic decision 6), `run: async (deps, input) =>
deps.rejectObjective.execute(input)`, `present: (result) =>
objectiveRejectionView(result)`.
  - `objective.reattempt.create` — `POST /api/objective/:id/reattempt`,
    `successStatus: 204`, no `present`, `decode` building `{objectiveId,
expectedCommit, note?}`, `run: async (deps, input) =>
deps.retryObjective.execute(input)`.
- `src/apps/http/deps.ts` (edited) — added `import type { ApproveObjective }`
  from `../../app/objective/approve-objective.ts`, `import type {
RejectObjective }` from `../../app/objective/reject-objective.ts`, `import
type { RetryObjective }` from `../../app/objective/retry-objective.ts`;
  added `readonly approveObjective: ApproveObjective;`, `readonly
rejectObjective: RejectObjective;`, `readonly retryObjective:
RetryObjective;` to `HttpDeps`.
- `src/apps/cli/commands/serve.ts` (edited) — added `approveObjective:
deps.approveObjective,`, `rejectObjective: deps.rejectObjective,`,
  `retryObjective: deps.retryObjective,` to the `httpDeps` literal (all three
  already present on `CliDeps` at `src/apps/cli/deps.ts:216-218`, so no
  upstream wiring change was needed).
- `src/composition.ts` — no change, per the Story's explicit note (all three
  use cases already constructed and returned in `CliDeps`).

**Seam (GREEN).** The three new rows dispatch through the existing
`RouteDefinition`/`defineRoute` machinery to the injected `approveObjective` /
`rejectObjective` / `retryObjective` instances; `objectiveApprovalView` /
`objectiveRejectionView` present their results with the exact literal key sets
the `views/*.test.ts` suites assert, and the `204` reattempt row's absent
`present` satisfies the no-body/no-`ETag` policy; `expectedCommit` is REQUIRED
via `requireBodyString` on all three rows, never defaulted, closing the
`ERR_MODULE_NOT_FOUND`/missing-export RED and the `routes.verdict.test.ts` /
`routes.test.ts` RED for the three new route ids.

**Refactor.** None named beyond the GREEN edits — Story S4's `## Change`
section IS the target end state.

**Build check.**

- typecheck: exit 0 (`npm run typecheck`, `tsc --noEmit`, clean).

**Assumptions.**

- VERIFIED: `CliDeps` already carries `approveObjective` (line 216),
  `retryObjective` (line 217), `rejectObjective` (line 218) in
  `src/apps/cli/deps.ts`, so `serve.ts`'s new lines type-check against
  existing fields with no upstream change.
- VERIFIED: `ApproveObjective.execute`, `RejectObjective.execute`, and
  `RetryObjective.execute` accept `objectiveId` + `expectedCommit` (+ the
  optional fields) matching the `decode` shapes above, confirmed by a clean
  `tsc --noEmit` with no call-site errors at the three new `run` lines.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S4 objective verdict rows · confirm GREEN

**Cycle.** Confirm GREEN for Story `04-objective-verdict-rows.md`, repairing
one stale test-owned invariant found while confirming (test-file edit only,
same class of staleness as the S2/S3 fixes).

**Handoff verification gate.** SE's last turn claims a clean `npm run
typecheck`. Independently re-ran `npm run verify:handoff` → `VERIFY: PASS`
(embeds a clean `tsc --noEmit`). Gate passes.

**Repairs made (test file only, no production edit).**

- `src/apps/http/cli-coverage.test.ts:145-153` — Story S4 landed 3 new
  `cliCommands` leaves (`approve objective`, `reject objective`, `retry
objective`), so the "uncovered set shrank by …" hardcoded count is stale
  (`20 !== 17`). Bumped the assertion, its comment, and the test name to
  mention Story S4's 3 leaves (`17`). Same class of invariant staleness the
  S2/S3 confirm-GREEN turns already repaired.

**Confirm GREEN proof.**

- `node --test src/apps/http/routes.verdict.test.ts` → 17/17 pass.
- `node --test src/apps/http/views/verdict.test.ts src/apps/http/views/impact.test.ts src/apps/http/routes.test.ts` → 29/29 pass (row count 61).
- `node --test src/apps/http/cli-coverage.test.ts` → 6/6 pass (after the repair).
- `npx tsc --noEmit` → exit 0.
- `npm run verify` (typecheck + test + verify:handoff + lint + db status) →
  exit 0 end to end: 3309 tests / 3309 pass, `VERIFY: PASS`, `eslint .` clean,
  db status printed.

Story S4 is closed.

## TEST-ENGINEER — S5 initiative suspension singleton · RED

**Cycle.** RED for Story `05-initiative-suspension.md` (no `### Task`
headings — the whole Story is the Task unit; its `## Verify` section names
the test targets).

**Test written.**

- file: `src/apps/http/routes.initiative.test.ts` (edited) — added a
  `makeSuspensionDeps()` fake-deps builder plus 9 new tests under
  `// ─── EPIC 023 Story S5 — initiative.suspension.put,
initiative.suspension.delete ───`.
- asserts: `decode` for both rows produces exactly `{ initiativeId: "i1" }`,
  and a blank `:id` on either method is `400 invalid_input`; `PUT
/api/initiative/i1/suspension` with `Content-Type: application/json`
  calls `pauseInitiative` exactly once, `resumeInitiative` zero times, and
  answers `204` with an empty body and no `etag` header; two consecutive
  `PUT`s both answer `204` and call `pauseInitiative` twice; `DELETE` with no
  `Content-Type` answers `204` and calls `resumeInitiative` once; two
  consecutive `DELETE`s both answer `204`; `PUT` with
  `Content-Type: text/plain` is `415 unsupported_media_type`; `PUT` with
  `Origin: http://127.0.0.1:1` is `403 origin_not_allowed`; a fake
  `pauseInitiative` raising `UnknownReferenceError` is `404
unknown_reference` and one raising `WrongTypeReferenceError` is `400
wrong_type_reference`; `POST /api/initiative/i1/suspension` is `405` with
  `Allow: "DELETE, PUT"` (the router's sorted, comma-joined allow list).
- file: `src/apps/http/app.test.ts` (edited) — added one `OPTIONS` preflight
  test: `Origin: http://127.0.0.1:4100` +
  `Access-Control-Request-Method: PUT` against
  `/api/initiative/i1/suspension` asserts
  `access-control-allow-methods` contains `PUT`. **This test already
  passes** — Story S1's earlier turn already widened `app.ts`'s `@koa/cors`
  `allowMethods` to include `"PUT"`, and the CORS preflight middleware
  answers from that static config regardless of whether a matching route
  exists. It is a characterization test pinning that already-shipped
  behavior, exactly as the Story's Verify section directs
  ("without it the allowMethods edit is untested" — the gap being that no
  test exercised `app.ts:153` for `PUT` until now, not that the behavior was
  new). Sensitivity is provable by inspection rather than by a second RED
  run: `app.ts:154`'s `allowMethods` array is the sole source the
  `@koa/cors` middleware reads to answer the preflight, and removing
  `"PUT"` from that array (not attempted — production edit, out of lane)
  is the only way this assertion could fail.
- file: `src/apps/http/routes.test.ts` (edited) — row count bumped `61 → 63`;
  `initiative.suspension.put` and `initiative.suspension.delete` added to
  the known-route-ids list.

**RED proof.**

- command: `node --test src/apps/http/routes.initiative.test.ts`
- exit: non-zero — 7/17 fail (the two gate-only tests, `Content-Type:
text/plain` → `415` and `Origin` → `403`, already pass because those
  middleware run before route matching), representative line:
  ```
  ✖ PUT /api/initiative/i1/suspension calls pauseInitiative exactly once, resumeInitiative zero times, answers 204 with no body and no etag header
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    404 !== 204
  ```
  and
  ```
  ✖ a fake pauseInitiative raising UnknownReferenceError is 404 unknown_reference; WrongTypeReferenceError is 400 wrong_type_reference
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    + actual - expected
    + 'unknown_route'
    - 'unknown_reference'
  ```
  and
  ```
  ✖ POST /api/initiative/i1/suspension is 405 with an Allow header containing both DELETE and PUT
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    404 !== 405
  ```
  (`/api/initiative/:id/suspension` is not yet a route, so `matchRoute`
  answers `unknown_route` → `404` for both `PUT` and `DELETE` — the same
  missing-capability signature the EPIC records for earlier phases, now
  over the suspension singleton.)
- command: `node --test src/apps/http/routes.test.ts`
- exit: non-zero — 2 failures:
  ```
  ✖ ROUTES holds exactly 63 rows: … — AssertionError: 61 !== 63
  ✖ every route id from the EPIC 020 and 021 route tables is present in ROUTES
    AssertionError: missing route id initiative.suspension.put
  ```
- command: `node --test src/apps/http/app.test.ts`
- exit: 0 — 51/51 pass, including the new PUT-preflight characterization
  test (already green per the note above; no other test regressed).
- command: `npx tsc --noEmit`
- exit: non-zero — 2 errors, both the missing seam:
  ```
  src/apps/http/routes.initiative.test.ts(267,19): error TS2339: Property 'pauseInitiative' does not exist on type 'HttpDeps'.
  src/apps/http/routes.initiative.test.ts(273,19): error TS2339: Property 'resumeInitiative' does not exist on type 'HttpDeps'.
  ```

**Open to Software Engineer.**

- `src/apps/http/routes.ts` — append the two rows `initiative.suspension.put`
  (`PUT /api/initiative/:id/suspension` → `204`, `PauseInitiative`) and
  `initiative.suspension.delete` (`DELETE /api/initiative/:id/suspension` →
  `204`, `ResumeInitiative`) per Story S5 item 1's exact `decode`/`run`
  shapes — neither declares `present`; `decode` maps `id → initiativeId` via
  `requirePathParam`.
- `src/apps/http/deps.ts` — add `readonly pauseInitiative: PauseInitiative;`
  and `readonly resumeInitiative: ResumeInitiative;` to `HttpDeps`, importing
  the types from `src/app/initiative/pause-initiative.ts` and
  `resume-initiative.ts`.
- `src/apps/cli/commands/serve.ts` — wire `pauseInitiative:
deps.pauseInitiative,` and `resumeInitiative: deps.resumeInitiative,` into
  the `httpDeps` literal (both already on `CliDeps`).
- `src/composition.ts` — no change (Story S5's explicit note; both use cases
  are already constructed and returned in `CliDeps`).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S5 initiative suspension singleton · GREEN

**Cycle.** GREEN for Story `05-initiative-suspension.md`, closing the RED left
by the test-engineer's last turn (`routes.initiative.test.ts`'s 9 new tests,
`routes.test.ts`'s row-count bump to 63; `app.test.ts`'s PUT-preflight test was
already green, no change needed there).

**Files changed.**

- `src/apps/http/routes.ts` (edited) — appended two rows at the end of
  `ROUTES`:
  - `initiative.suspension.put` — `PUT /api/initiative/:id/suspension`,
    `successStatus: 204`, no `present`, `decode` building
    `{initiativeId}` via `requirePathParam`, `run: async (deps, input) =>
deps.pauseInitiative.execute(input)`.
  - `initiative.suspension.delete` — `DELETE
/api/initiative/:id/suspension`, `successStatus: 204`, no `present`,
    same `decode` shape, `run: async (deps, input) =>
deps.resumeInitiative.execute(input)`.
    Neither row declares `location` or `readRow`, per Story S5 item 1 exactly.
- `src/apps/http/deps.ts` (edited) — added
  `import type { PauseInitiative } from "../../app/initiative/pause-initiative.ts";`
  and `import type { ResumeInitiative } from "../../app/initiative/resume-initiative.ts";`;
  added `readonly pauseInitiative: PauseInitiative;` and `readonly
resumeInitiative: ResumeInitiative;` to `HttpDeps`.
- `src/apps/cli/commands/serve.ts` (edited) — added `pauseInitiative:
deps.pauseInitiative,` and `resumeInitiative: deps.resumeInitiative,` to the
  `httpDeps` literal (both already present on `CliDeps` at
  `src/apps/cli/deps.ts:188-189`, so no upstream wiring change was needed).
- `src/composition.ts` — no change, per the Story's explicit note (both use
  cases already constructed and returned in `CliDeps`).

**Seam (GREEN).** The two new rows dispatch through the existing
`RouteDefinition`/`defineRoute` machinery to the injected `pauseInitiative` /
`resumeInitiative` instances; both are body-less `204` rows with no `present`,
satisfying the no-body/no-`ETag` policy and the `routes.initiative.test.ts` /
`routes.test.ts` assertions for the two new route ids, including the
`UnknownReferenceError`/`WrongTypeReferenceError` mapping (already registered)
and the `405` + `Allow` header behaviour the router derives automatically from
the two rows now sharing one path with two methods.

**Refactor.** None named beyond the GREEN edits — Story S5's `## Change`
section IS the target end state.

**Build check.**

- typecheck: exit 0 (`npm run typecheck`, `tsc --noEmit`, clean).

**Assumptions.**

- VERIFIED: `CliDeps` already carries `pauseInitiative` (line 188) and
  `resumeInitiative` (line 189) in `src/apps/cli/deps.ts`, so `serve.ts`'s new
  lines type-check against existing fields with no upstream change.
- VERIFIED: `PauseInitiative.execute` / `ResumeInitiative.execute` both accept
  `{initiativeId: string}` and return `Promise<void>`
  (`src/app/initiative/pause-initiative.ts:20-29`,
  `resume-initiative.ts:20-29`), matching the `decode` shape and the row's
  absent `present`.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S5 confirm GREEN, S6 Proof run · production defect found

**Cycle.** Confirm GREEN for Story `05-initiative-suspension.md`, then RED for
Story `06-proof-and-inventory.md` (no `### Task` headings — the whole Story is
the Task unit; its `## Change`/`## Verify` sections name the test target and
the Proof).

**Handoff verification gate.** SE's last turn (S5 GREEN) claims a clean
`npm run typecheck`. Independently re-ran `npm run verify:handoff` →
`VERIFY: PASS` (embeds a clean `tsc --noEmit`). Gate passes.

**Confirm GREEN proof (S5).**

- `node --test src/apps/http/routes.initiative.test.ts` → 17/17 pass.
- `node --test src/apps/http/app.test.ts` → 51/51 pass (PUT-preflight
  characterization test still green).
- `node --test src/apps/http/routes.test.ts` → 14/14 pass (row count 63).

Story S5 is closed.

**Test written (S6 item 1).**

- file: `src/apps/http/cli-coverage.test.ts` (edited) — added the exact test
  the Story names verbatim: `"the 9 CLI leaves claimed by EPIC 023 all appear
across ROUTES' cliCommands"`, asserting `approve task`, `approve objective`,
  `reject task`, `reject objective`, `retry task`, `retry objective`, `abandon
task`, `pause initiative`, `resume initiative` are all covered by `ROUTES`'
  `cliCommands`.
- Since Stories S1-S5 already landed all nine rows, this inventory test passes
  immediately — it is a characterization test proving the epic's CLI-leaf
  claim is now true (same class as the S5 PUT-preflight test): sensitivity is
  provable by inspection — remove any one of the nine `cliCommands` strings
  from `routes.ts` (not attempted — production edit, out of lane) and this
  test fails, which is exactly why every prior Story's confirm-GREEN turn
  bumped this file's companion counters.
- Repaired one stale test-owned invariant in the same file, same class as the
  S2/S3/S4 fixes: `"the uncovered set shrank by …"` still hardcoded `17`, but
  Story S5 landed 2 more covered leaves (`pause initiative`, `resume
initiative`), dropping the uncovered count to `15`. Renamed the test and its
  comment to mention S5's 2 leaves, bumped the assertion to `15`.
- `node --test src/apps/http/cli-coverage.test.ts` → 7/7 pass.
- `node --test src/apps/http/routes.test.ts` → 14/14 pass (unaffected, no row
  change — `ROUTES.length` stays 63 per the Story's own note).

**RED proof (S6 item 2 — the Proof script).**

- command: `scripts/e2e/http-transitions-proof.sh`
- Phases A, B, C pass in full:
  ```
  --- A: fixture through the CLI only — …
  --- B: serve on an ephemeral port
      bound port: 61502
  --- C: approve a real escalated task over HTTP, then prove the repeat is idempotent
  C ok: a real escalated task is approved over HTTP and the repeat is a 200 no-op
  ```
- Phase D fails at its last assertion:
  ```
  --- D: reject a real failed task — the dry run writes nothing and a stale digest LOSES
  FAILED: reject with a conflicting resolution code — expected 'rejection_conflict', got 'task_not_awaiting_confirmation'
  ```

**Root cause (verified by reading the code, not guessed).**
`src/app/task/reject-task.ts:141-260` (`RejectTask.execute`) runs its status
guard (`task.status !== "awaiting_confirmation" && !(status === "failed" &&
resolution === "discard")` → `TaskNotAwaitingConfirmationError`, line 168)
**before** it ever reads `storedResolution` (line 171) and compares it (lines
188-194, the `(h-same)`/`(h-conflict)` branches the epic's decision 7 table
cites). A successful `discard` transitions the task to the terminal
`discarded` status (`transitionTask(task, "discarded")`, confirmed against
`src/domain/task.ts:107` — `"failed->discarded"` is a real transition). So by
the time the Proof's phase D sends the fourth request
(`{"resolution":"retry"}`) against the task it just discarded two calls
earlier, `task.status === "discarded"` fails the status guard first and
throws `TaskNotAwaitingConfirmationError` — the `storedResolution !== null`
branch that would answer `rejection_conflict` is unreachable from this
sequence, only reachable today via a hand-built fake store
(`src/app/task/reject-task.test.ts:483-521`, `(h-conflict)`) that manufactures
a task still `awaiting_confirmation` with a pre-existing stored resolution —
a state the real state machine never produces. The `completed` case one
status "up" from this IS special-cased ahead of the guard (line 158:
`task.status === "completed"` → `RejectionConflictError` before the guard
runs at all); the `discarded` case is not, which is the gap: decision 7's
table treats "the task already completed" and "a different resolution
stored" as the same `rejection_conflict` family, but only the former actually
reaches it once a real discard has run.

**Open to Software Engineer.**

- `src/app/task/reject-task.ts` — `RejectTask.execute` needs to answer
  `rejection_conflict` (via `RejectionConflictError`), not
  `task_not_awaiting_confirmation`, when a caller sends a rejection for a task
  whose `status` is already `discarded` and whose stored `rejectionResolution`
  differs from the requested one — mirroring the existing `completed` special
  case at line 158, so decision 7's table row ("a different resolution
  stored, or the task already completed → `409 rejection_conflict`") holds for
  a task actually driven through two real HTTP calls, not only through the
  hand-built fake at `reject-task.test.ts:483-521`. The idempotent-same branch
  (`storedResolution === resolution`) already has its own existing unit-test
  coverage and Proof phase D never exercises a repeat with the SAME
  resolution against a discarded task, so no new idempotent-repeat behavior
  is required — only the conflict path.
- No other phase was reached this run; D through J remain unexercised until
  this fix lands. Re-run `scripts/e2e/http-transitions-proof.sh` after the
  fix to surface the next phase, if any.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S6 Proof · production defect fix (rejection_conflict on a discarded task)

**Cycle.** GREEN for the defect the test-engineer's last turn opened while
running Story `06-proof-and-inventory.md`'s Proof: `RejectTask.execute` must
answer `rejection_conflict` (`RejectionConflictError`), not
`task_not_awaiting_confirmation`, when a caller sends a rejection for a task
already `discarded` whose stored `rejectionResolution` differs from the
requested one.

**Files changed.**

- `src/app/task/reject-task.ts` (edited) — in `RejectTask.execute`:
  - moved `const storedResolution = result?.rejectionResolution ?? null;`
    up, right after `getTaskResult`, so it is available before the status
    guard.
  - added a `task.status === "discarded"` branch, sibling to the existing
    `task.status === "completed"` special case: if `storedResolution !==
resolution`, throw `RejectionConflictError(taskId, storedResolution ??
"discard", resolution)`; if it matches, fall through (unchanged) to the
    existing `(h-same)` idempotent branch at line ~188, which returns
    `{skipped: [], preview}` without touching the transaction.
  - the prior general guard (`task.status !== "awaiting_confirmation" &&
!(status === "failed" && resolution === "discard")` →
    `TaskNotAwaitingConfirmationError`) now runs only in an `else if`, so a
    `discarded` task never reaches it — the guard's job for `discarded` is
    now the new branch above.
  - no other line touched; the removed original `storedResolution`
    declaration (further down) was the one relocated, not duplicated.

**Seam (GREEN).** A second rejection call against an already-`discarded` task
now distinguishes "same resolution repeated" (idempotent, unchanged
downstream behaviour) from "a different resolution than what was actually
recorded" (`409 rejection_conflict`), mirroring the existing `completed`
special case one status "up". This makes decision 7's table row hold for a
task driven through two real HTTP calls (the Proof's phase D sequence:
dry-run discard → stale-digest discard refusal → real discard → `retry`
against the now-`discarded` task), not only through the hand-built fake at
`reject-task.test.ts:483-521`.

**Refactor.** None — this is the named defect fix itself, no separate
cleanup step was identified.

**Build check.**

- typecheck: exit 0 (`npm run typecheck`, `tsc --noEmit`, clean).

**Proof re-run (informational, not this turn's gate).** Ran
`scripts/e2e/http-transitions-proof.sh` to confirm the fix unblocks the
sequence the test-engineer's last turn stopped at. Phases A-H now pass,
including phase D (`D ok: a dry run writes nothing, a stale impact digest
loses, and a conflicting resolution is refused`), E, F, G, H. Phase I fails
at its first assertion:

```
--- I: no bulk approval, and the 019 gates still fire on a transition row
FAILED: collection-level approval status — expected '404', got '405'
```

This is a NEW finding beyond this turn's assigned defect (a routing-surface
question for `POST /api/task/approval`, not a `RejectTask` behaviour), so I
did not attempt a fix — it is outside the one blocker this turn was opened
to close. Leaving it for the test-engineer's next turn to characterize.

**Assumptions.**

- VERIFIED: `src/domain/task.ts:107` confirms `"failed->discarded"` is a real
  transition, so a task legitimately reaches `discarded` via exactly the
  `RejectTask` discard path this fix guards.
- VERIFIED: the existing `(h-same)`/`(h-conflict)` unit tests at
  `reject-task.test.ts:483-521` (hand-built fake, `awaiting_confirmation`
  status) are unaffected — they never enter the new `discarded` branch since
  their fake task status stays `awaiting_confirmation`.
- VERIFIED: `npx tsc --noEmit` reports zero errors after the edit.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — S6 Proof · phase I finding characterized (Proof script defect, not a production gap)

**Cycle.** Continuing Story `06-proof-and-inventory.md`'s Proof pass. Investigating
the new phase-I finding the last SOFTWARE-ENGINEER turn surfaced
(`RejectTask` conflict fix landed; re-running the Proof past phase H hits a
NEW failure at phase I's first assertion).

**Handoff verification gate.** SE's last turn claims `npm run typecheck` exit 0. Independently re-ran `npm run verify:handoff` → `VERIFY: PASS` (embeds a
clean `tsc --noEmit`). Gate passes.

**Proof re-run (confirms the SE's report).**

- command: `scripts/e2e/http-transitions-proof.sh`
- Phases A-H now all pass, including phase D
  (`D ok: a dry run writes nothing, a stale impact digest loses, and a
conflicting resolution is refused`) — the `RejectTask` fix holds.
- Phase I fails at its first assertion:
  ```
  --- I: no bulk approval, and the 019 gates still fire on a transition row
  FAILED: collection-level approval status — expected '404', got '405'
  ```

**Root cause (verified by reading the router, not guessed).**
`scripts/e2e/http-transitions-proof.sh:340` sends `POST /api/task/approval`
expecting `404 unknown_route`. That path has exactly TWO segments after
`/api` (`task`, `approval`), which is the same shape as the pre-existing
`GET /api/task/:id` row (`src/apps/http/routes.ts:393-397`, the only method
registered at that path). `matchRoute` (`src/apps/http/router.ts:53-83`)
matches purely on segment count and literal-vs-`:param` shape — it has no
notion of "this segment looks like a verb" — so `/api/task/approval` matches
`/api/task/:id` with `id="approval"`, finds a path match, then finds no `POST`
method among path matches and answers `method_not_allowed` → `405` with
`Allow: GET`. This is NOT new behaviour introduced by 023: `/api/task/:id`
(GET-only) has existed since 019/020, and this exact "a path shape collides
with an existing item route, so the wrong method is `405` not `404`" pattern
is already established convention elsewhere in the proof suite —
`scripts/e2e/http-writes-proof.sh:29,427` assert precisely this for
`PUT /api/project/:id`. The Proof's own second assertion on the SAME line
group (`the verb form`, `POST /api/task/$TASK_APPROVE/approve`) correctly
expects `404`, because `approve` (3 segments: `task`, `:id`, `approve`)
matches no route at all — no row is named `approve` (023 named the noun
`approval`), confirming the router's real behaviour was reasoned correctly
everywhere else in the file.

**This is a genuine Proof-script defect, not an incomplete production
capability and not a wrong epic decision.** Decision 10 ("no bulk approval …
enforced, not merely intended") is still fully true: no `POST` at a
collection-scoped path succeeds, and no route reads an array of ids. The
router's `405` for a path that coincidentally has the same shape as
`GET /api/task/:id` is exactly the right, already-precedented answer — the
Proof asserted the wrong status code for that one line, not a status the
production code should be made to produce. Per Story S6's own instruction
("If a phase fails because the epic's decision was wrong … raise `OPEN:` …
[only permitted edit is] a fix to a genuine script defect, never a relaxed
expectation"), this is the latter: an incorrect expected value on one line,
not a weakened check — decision 10's actual guarantee (no bulk-approval
success path exists) still holds and is still tested; only the specific
status literal (`404` → `405`) needs correcting to match the router's real,
correct, already-established semantics.

**Open to Software Engineer.**

- `scripts/e2e/http-transitions-proof.sh:340` — the `W_ERR "collection-level
approval" POST "/api/task/approval" '{}' 404 unknown_route` line asserts the
  wrong status/code pair for a path that in fact collides with the existing
  `GET /api/task/:id` row. Correct it to the router's actual, correct answer:
  `405` with the `method_not_allowed` family (check `W_ERR`'s/the file's own
  helper signature — e.g. `http-writes-proof.sh:427`'s `contains … "405"`
  pattern — for the exact assertion shape this file uses elsewhere for a
  `405`), recording the fix as a genuine script-defect correction per Story
  S6's completion note (not a relaxed expectation — decision 10's guarantee
  is unchanged). No other line in phase I is affected: `the verb form` (line 341) is already correctly `404` and needs no change. No production file
  needs editing for this finding.
- Do not touch `src/apps/http/routes.ts`, `router.ts`, or any registry file
  for this finding — the router's `405`-before-`404` precedence is correct,
  intentional, and precedented; changing it would be the wrong fix and would
  regress the `http-writes-proof.sh:427` assertion that already relies on it.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S6 Proof · script-defect fix (phase I status/code)

**Cycle.** GREEN for the Proof-script finding the test-engineer's last turn
characterized: `scripts/e2e/http-transitions-proof.sh:340` asserted the wrong
expected status/code pair for the "collection-level approval" request.

**Files changed.**

- `scripts/e2e/http-transitions-proof.sh` (edited) — line 340 (the
  `W_ERR "collection-level approval" POST "/api/task/approval" '{}' …` call):
  changed the expected outcome from `404 unknown_route` to `405
method_not_allowed`, with a comment explaining why (`/api/task/approval` has
  the same 2-segment shape as the existing `GET /api/task/:id` row, so
  `matchRoute` path-matches with `id="approval"` and only loses on method,
  giving `405` — the same precedent `http-writes-proof.sh:427` already
  asserts for `PUT /api/project/:id`). No other line touched; "the verb form"
  assertion on line 341 (`POST /api/task/$TASK_APPROVE/approve` → `404`) was
  already correct and stays unchanged, per the test-engineer's explicit
  instruction.

**Seam (GREEN).** `W_ERR` compares the response's real status (`405`) and
`error.code` (`method_not_allowed`, confirmed at
`src/apps/http/error-registry.ts:170-171` / `app.ts:210-212`) against the
corrected expected pair, so phase I now passes without weakening decision
10's actual guarantee (no bulk-approval success path exists — still true and
still exercised by this same line, just with the router's real, correct
`405`-before-`404` precedence reflected in the expectation).

**Refactor.** None — this is the named script-defect correction itself; no
production file was touched (no `routes.ts`, `router.ts`, or registry edit,
per the test-engineer's explicit "do not touch" instruction).

**Build check.**

- typecheck: exit 0 (`npm run typecheck`, `tsc --noEmit`, clean — no
  production source changed this turn).

**Proof re-run (this turn's own verification, not delegated).**
Ran `scripts/e2e/http-transitions-proof.sh` end to end after the fix:

```
--- A: fixture through the CLI only — one escalated task, one integrated-ready objective, two failed tasks
project created: 01KYTRFQB00G0T2PSGZ7N93T84
repository created: 01KYTRFR6FSCB69KW6FC9B58NG
ai-provider registered: 01KYTRFS08F8CVW7ACK8R7G522
    escalated task 01KYTRFTHJPKZNS6844DS9EWXH (proposal 07273efd), objective 01KYTRFVASXBBD6CRBS6T81RN3, failed tasks 01KYTRFW4VQ7XK5D121XNZK8X9 / 01KYTRFW4VQ7XK5D121XNZK8X8
--- B: serve on an ephemeral port
    bound port: 63206
--- C: approve a real escalated task over HTTP, then prove the repeat is idempotent
C ok: a real escalated task is approved over HTTP and the repeat is a 200 no-op
--- D: reject a real failed task — the dry run writes nothing and a stale digest LOSES
D ok: a dry run writes nothing, a stale impact digest loses, and a conflicting resolution is refused
--- E: the objective verdict guard — missing is 400, stale is 409, fresh integrates
E ok: an objective verdict without its candidate is 400, with a stale one 409 before any git work
--- F: reattempt is a noun, and abandonment refuses a task that is not running
F ok: reattempt re-queues once and keeps its note; abandonment refuses a task that is not running
--- G: pausing is STATE — the suspension singleton, idempotent both ways
G ok: PUT/DELETE on the suspension singleton flips paused and both are idempotent
--- H: 021's If-Match convention is not weakened by this epic (regression)
H ok: a stale If-Match still loses on the item PATCH, and the fresh one wins
--- I: no bulk approval, and the 019 gates still fire on a transition row
I ok: no bulk verdict route exists, and the media-type, Origin and auth gates all fire
--- J: hygiene — no secret in the log, and SIGTERM stops the port
023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk
```

All phases A-J pass end to end; the Proof prints the required `023 ok: …`
line.

**Assumptions.**

- VERIFIED: `src/apps/http/error-registry.ts:170-171` and `app.ts:206-212`
  confirm `method_not_allowed` is the exact `error.code` string the router's
  `405` path emits.
- VERIFIED: no other phase or line in the script referenced the old `404
unknown_route` expectation for this request; the fix is isolated to the one
  line the test-engineer named.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.** All six Stories (S1-S6) are closed per the
discussion file's prior turns; the last SOFTWARE-ENGINEER turn fixed the final
Proof-script defect (phase I's expected status) and pasted a full A-J Proof
pass. This turn independently re-ran the handoff gate, the full test suite
(twice, to rule out shared-tree flakiness), the full `npm run verify` gate,
and the Proof script itself.

- **Handoff verification gate.** `npm run verify:handoff` → `VERIFY: PASS`
  (embeds a clean `tsc --noEmit`). Independently confirmed, not trusted from
  the SE's claim alone.
- `typecheck` (`npm run typecheck`) → exit 0.
- `unit` (`npm test`) → first run: 3320 tests, 1 fail
  (`src/apps/http/routes.dependency.test.ts` — a file untouched by this
  epic); that single test passed in isolation
  (`node --test src/apps/http/routes.dependency.test.ts` → 19/19) and the
  full suite re-run came back 3320/3320 clean. A second full `npm run verify`
  pass then hit a different one-off failure in
  `src/apps/http/routes.write-resource.test.ts` (also untouched by this
  epic), which likewise passed in isolation and on the next full re-run.
  Both are shared-tree test pollution from concurrent agents' work, not a
  023 regression — neither file is named anywhere in this epic's Stories or
  `Open to Software Engineer` notes. Final clean run: `npm run verify` →
  `ℹ tests 3320`, `ℹ pass 3320`, `ℹ fail 0`.
- `npm run verify` (typecheck + test + verify:handoff + lint + db status) →
  exit 0 end to end: 3320/3320 tests, `VERIFY: PASS`, `eslint .` clean, `db
status` printed (`schema: 29`).

**Proof.** Ran `scripts/e2e/http-transitions-proof.sh` from the repo root
(fresh run, this turn):

```
--- A: fixture through the CLI only — one escalated task, one integrated-ready objective, two failed tasks
project created: 01KYTSA8GB4VD5GK7G34TC3FMQ
repository created: 01KYTSA9ASGCPAPGZX9VYB9HQ3
ai-provider registered: 01KYTSAA4A4JZYG9M2GDYM29E5
    escalated task 01KYTSABRPQ6R4PJD7KQC720FQ (proposal 842be721), objective 01KYTSACFMWYE0531AGCEWXS7J, failed tasks 01KYTSADACKQ8MF17PQBJGNSJW / 01KYTSADACKQ8MF17PQBJGNSJV
--- B: serve on an ephemeral port
    bound port: 51826
--- C: approve a real escalated task over HTTP, then prove the repeat is idempotent
C ok: a real escalated task is approved over HTTP and the repeat is a 200 no-op
--- D: reject a real failed task — the dry run writes nothing and a stale digest LOSES
D ok: a dry run writes nothing, a stale impact digest loses, and a conflicting resolution is refused
--- E: the objective verdict guard — missing is 400, stale is 409, fresh integrates
E ok: an objective verdict without its candidate is 400, with a stale one 409 before any git work
--- F: reattempt is a noun, and abandonment refuses a task that is not running
F ok: reattempt re-queues once and keeps its note; abandonment refuses a task that is not running
--- G: pausing is STATE — the suspension singleton, idempotent both ways
G ok: PUT/DELETE on the suspension singleton flips paused and both are idempotent
--- H: 021's If-Match convention is not weakened by this epic (regression)
H ok: a stale If-Match still loses on the item PATCH, and the fresh one wins
--- I: no bulk approval, and the 019 gates still fire on a transition row
I ok: no bulk verdict route exists, and the media-type, Origin and auth gates all fire
--- J: hygiene — no secret in the log, and SIGTERM stops the port
023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk
```

Exit code 0. The required success string `023 ok: …` printed verbatim:
`023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk`.

**Tasks closed.** 6/6 Stories complete (S1 — registry and PUT admission; S2 —
task verdicts; S3 — task reattempt and abandonment; S4 — objective verdicts;
S5 — the suspension singleton; S6 — the Proof and CLI-retirement inventory).
No Story left unexpanded or unimplemented. `ROUTES` holds the required 63
rows (base 54 + 9 new); the nine CLI leaves (`approve task`, `reject task`,
`retry task`, `abandon task`, `approve objective`, `reject objective`, `retry
objective`, `pause initiative`, `resume initiative`) are all covered per
`cli-coverage.test.ts`.

```
IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- proof: PASS (scripts/e2e/http-transitions-proof.sh) — "023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk"
- stories: 6/6 complete
- date: 2026-07-31
- state: local-uncommitted
```

END: TEST-ENGINEER

AUTO_REVIEW: FAIL — routing 5 action:YES finding(s) to the TDD loop; 2 action:NO finding(s) recorded for the human.
BLOCKER: B1 reject-task discarded-branch over-fires — `src/app/task/reject-task.ts:168-175` raises `RejectionConflictError` even when no resolution is stored (cascade-discarded task), fabricating `storedResolution ?? "discard"`; gate the branch on `storedResolution !== null` so the cascade case keeps `TaskNotAwaitingConfirmationError`, and drop the `?? "discard"` fallback.
BLOCKER: B2 no hermetic coverage for the new discarded branch — add two `node:test` cases to `src/app/task/reject-task.test.ts` with the existing `MemStore` fakes: (1) `discarded` + stored `"discard"` + requested `"retry"` → `RejectionConflictError` with `stored === "discard"`; (2) `discarded` + NO stored resolution + requested `"discard"` → `TaskNotAwaitingConfirmationError`.
BLOCKER: S1 domain import in http test — `src/apps/http/routes.verdict.test.ts:8` imports `StaleCandidateError` from `../../domain/initiative.ts`; import it from `../../app/errors.ts` instead and merge with the existing app/errors import.
BLOCKER: S2 envelope-level cause leak assertion missing — add one row test in `src/apps/http/routes.task.test.ts`: fake `approveTask` returns `{kind:"landing_failed",taskId:"t1",message:"boom",cause:{secret:"leak-me"}}`; assert 200, `res.body.data.outcome === "landing_failed"`, and `JSON.stringify(res.body).includes("leak-me") === false`.
BLOCKER: S3 exactly-once call assertions missing — add a call counter to `makeVerdictDeps()` in `src/apps/http/routes.verdict.test.ts` and assert the fake ran exactly once on the approval / rejection / reattempt rows in both `routes.verdict.test.ts` and `routes.task.test.ts`.
INFO: S4 (action:NO) Proof phase I now expects `405 method_not_allowed` where the EPIC text still says `404 unknown_route`; the reviewer confirmed 405 is the router's real behaviour (path collides with `GET /api/task/:id`). The EPIC text at :514 and :534-542 needs a human correction — `.agent/plan/**` is lane-forbidden.
INFO: S5 (action:NO) `src/apps/http/routes.ts:1063` keeps `resolution as "retry" | "discard"`; the reviewer verified the cast is genuinely required (the conditional-spread literal widens the narrowed value). Recorded so nobody "cleans it up".

## TEST-ENGINEER — S1-S6 · review-blocker regression tests (repair path)

**Cycle.** RED for B1/B2 (`src/app/task/reject-task.ts`'s discarded-branch
over-fire), plus S1/S2/S3 pure test-file fixes — all five `action:YES`
findings from the failed review.

**Tests written.**

- `src/app/task/reject-task.test.ts` (edited) — suite: `reject-task` —
  methods added:
  - `(B2-1) RejectTask on an already-discarded task with a stored 'discard'
resolution and a conflicting 'retry' request → RejectionConflictError
with stored === 'discard'` — a genuinely conflicting resolution on a
    discarded task with a real stored resolution must still throw
    `RejectionConflictError` naming the real stored value.
  - `(B2-2) RejectTask on an already-discarded task with NO stored
resolution (cascade-discarded) → TaskNotAwaitingConfirmationError, not a
fabricated RejectionConflictError` — a task that is `discarded` purely by
    cascade, with no `TaskResultRow` at all, must throw
    `TaskNotAwaitingConfirmationError`, not a `RejectionConflictError` built
    from a fabricated `"discard"` fallback.
- `src/apps/http/routes.verdict.test.ts` (edited):
  - S1: merged the `StaleCandidateError` import into the existing
    `../../app/errors.ts` import (was importing from
    `../../domain/initiative.ts`).
  - S3: added `approveObjectiveCalls` / `rejectObjectiveCalls` /
    `retryObjectiveCalls` counters to `makeVerdictDeps()`; asserted
    `=== 1` on the approval row (`"...calls the fake once..."`), the full-body
    rejection row (`"decode objective.rejection.create with full body..."`),
    and the reattempt row (`"decode objective.reattempt.create..."`).
- `src/apps/http/routes.task.test.ts` (edited):
  - S2: new test `"POST /api/task/t1/approval where the fake returns
landing_failed with a cause never leaks the cause into the envelope"` —
    fakes `approveTask.execute` returning
    `{kind:"landing_failed",taskId:"t1",message:"boom",cause:{secret:"leak-me"}}`;
    asserts `200`, `res.body.data.outcome === "landing_failed"`, and
    `JSON.stringify(res.body).includes("leak-me") === false`.
  - S3: added `verdictDeps.approveTaskCalls === 1` /
    `rejectTaskCalls === 1` assertions to the approval row and both
    rejection rows (`discard` full-body and bare `retry`); `retryTask` /
    `abandonTask` exactly-once assertions already existed and are unchanged.

**RED proof.**

- command: `node --test src/app/task/reject-task.test.ts`
- exit: non-zero — failure:
  `AssertionError [ERR_ASSERTION]: a cascade-discarded task with no stored
resolution must throw TaskNotAwaitingConfirmationError, not a fabricated
RejectionConflictError; got: RejectionConflictError` at
  `src/app/task/reject-task.test.ts:894:14` (test `(B2-2)`).
- `(B2-1)` and all pre-existing `reject-task.test.ts` cases pass unchanged
  (16/17 pass, 1 fail — the named `(B2-2)`), demonstrating the test is
  sensitive to exactly the over-fire defect B1 names, not a pre-existing gap.

**Confirm GREEN — S1/S2/S3 (pure test-file fixes, no production defect).**

- command: `node --test src/apps/http/routes.verdict.test.ts
src/apps/http/routes.task.test.ts`
- result: `ℹ tests 45`, `ℹ pass 45`, `ℹ fail 0` — S1's import fix, S2's new
  cause-leak test, and S3's exactly-once assertions all pass against the
  already-shipped `views/verdict.ts` (`taskApprovalView` already omits
  `cause`; only `outcome`/`taskId`/`canonicalSHA`/`conflictFiles`/`message`
  are copied) and the already-shipped call-counting shape — these three
  findings were test-file gaps, not production defects, per the review's own
  routing.
- `npx tsc --noEmit` → exit 0 (clean).
- `npx eslint src/apps/http/routes.verdict.test.ts
src/apps/http/routes.task.test.ts src/app/task/reject-task.test.ts` →
  clean, no output.

**Open to Software Engineer.**

- `src/app/task/reject-task.ts`'s `RejectTask#execute` — the
  `task.status === "discarded"` branch (around the existing
  `storedResolution !== resolution` check) must not raise
  `RejectionConflictError` when `storedResolution` is `null` (no
  `TaskResultRow.rejectionResolution` was ever stored — the task reached
  `discarded` only via cascade from another task's discard). In that case the
  discarded task never entered a "confirmed" state via this use case, so it
  is not a conflicting-verdict situation; the general status guard's
  `TaskNotAwaitingConfirmationError(taskId, task.status)` is the correct
  outcome, exactly as it already is for every other status the discarded
  branch does not special-case. When `storedResolution` is a real, non-null
  value that differs from the request, the existing
  `RejectionConflictError(taskId, storedResolution, resolution)` behavior is
  correct and must be preserved (see `(B2-1)`, unchanged and still passing).
- No other file needs a production change for this turn's findings — S1, S2,
  S3 were resolved entirely inside their test files against already-correct
  production behavior.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — S3 (RejectTask) · B1 review-blocker fix

**Cycle.** GREEN for B1/B2 in `src/app/task/reject-task.test.ts` — the
`(B2-2)` case (a cascade-discarded task with no stored resolution must throw
`TaskNotAwaitingConfirmationError`, not a fabricated `RejectionConflictError`).

**Files changed.**

- `src/app/task/reject-task.ts` (edited) — `RejectTask#execute`'s
  `task.status === "discarded"` branch: gated the branch on
  `storedResolution !== null` and dropped the `storedResolution ?? "discard"`
  fallback, so `RejectionConflictError` only fires when a real stored
  resolution exists and differs from the request.

**Seam (GREEN).** Before: `if (task.status === "discarded") { if
(storedResolution !== resolution) throw RejectionConflictError(taskId,
storedResolution ?? "discard", resolution); }` fired unconditionally for any
discarded task whose stored resolution wasn't an exact match — including a
cascade-discarded task with `storedResolution === null`, fabricating a fake
`"discard"` stored value. After: the condition is
`task.status === "discarded" && storedResolution !== null`; when
`storedResolution` is `null` the branch is skipped and control falls to the
existing `else if` general status guard, which throws
`TaskNotAwaitingConfirmationError(taskId, "discarded")` — exactly `(B2-2)`'s
expectation. When `storedResolution` is a real, non-null value that differs
from the request, `RejectionConflictError(taskId, storedResolution,
resolution)` is thrown unchanged (no more `?? "discard"` fallback needed,
since the branch guard already guarantees non-null) — preserving `(B2-1)`.
Same-resolution idempotence (falls through, no throw) is unchanged for both
branches that reach it.

**Refactor.** None beyond the named fix — smallest change: tightened the
branch guard and removed the now-unreachable `?? "discard"` fallback; no
other line touched.

**Build check.**

- typecheck: exit 0 (`npm run typecheck`, `tsc --noEmit`, clean).

**Assumptions.**

- VERIFIED: the `else if` guard immediately following (`task.status !==
"awaiting_confirmation" && !(task.status === "failed" && resolution ===
"discard")`) already throws `TaskNotAwaitingConfirmationError(taskId,
task.status)` for any status not explicitly special-cased above it — a
  `discarded` task falling through the (now-narrower) first branch hits this
  guard and gets the correct error with no further code needed.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — B1/B2 regression confirm GREEN, review blockers closed, implementation ready for review

**Cycle.** Confirm GREEN for the software-engineer's B1 fix
(`src/app/task/reject-task.ts`'s `discarded`-branch now gated on
`storedResolution !== null`), then re-run the full EPIC Verification Gate.

**Handoff verification gate.** SE's last turn claims a clean `npm run
typecheck`. Independently re-ran `npm run verify:handoff` → `VERIFY: PASS`
(embeds a clean `tsc --noEmit`). Gate passes.

**Confirm GREEN proof (B1/B2).**

- `node --test src/app/task/reject-task.test.ts` → 17/17 pass, including:
  - `(B2-1) RejectTask on an already-discarded task with a stored 'discard'
resolution and a conflicting 'retry' request → RejectionConflictError
with stored === 'discard'` — PASS.
  - `(B2-2) RejectTask on an already-discarded task with NO stored
resolution (cascade-discarded) → TaskNotAwaitingConfirmationError, not a
fabricated RejectionConflictError` — PASS (previously RED; now green
    after the SE's fix gated the branch on `storedResolution !== null`).
  - All pre-existing cases (`(h-same)`, `(h-conflict)`,
    `(h-after-approve)`, Story 05/017 cases) unchanged and still passing.

All 5 routed `action:YES` review blockers are now resolved: B1 (production
fix confirmed above), B2 (regression tests confirmed above), S1 (import-site
fix in `routes.verdict.test.ts`, confirmed in the prior TE turn), S2
(cause-leak assertion added and passing), S3 (exactly-once call-counter
assertions added and passing). Both `action:NO` findings (S4 EPIC-text
correction, S5 cast-necessity note) are recorded for the human and require
no code change.

**EPIC verification gate.**

- `typecheck` (`npm run typecheck`) → exit 0.
- `unit` (`npm test`, embedded in `npm run verify`) → `ℹ tests 3323`,
  `ℹ pass 3323`, `ℹ fail 0`.
- `npm run verify:handoff` → `VERIFY: PASS`.
- `npm run verify` (typecheck + test + verify:handoff + lint + db status) →
  exit 0 end to end: 3323/3323 tests, `VERIFY: PASS`, `eslint .` clean, `db
status` printed (`schema: 29`).

**Proof.** Ran `scripts/e2e/http-transitions-proof.sh` from the repo root
(fresh run, this turn):

```
--- A: fixture through the CLI only — one escalated task, one integrated-ready objective, two failed tasks
project created: 01KYTTDH2RC3PZK9GWZBDVDX0Z
warning: You appear to have cloned an empty repository.
repository created: 01KYTTDJ0ZZKJVHBT8QPMB4DH6
ai-provider registered: 01KYTTDJTZ0E6JM6KH3C8HB704
    escalated task 01KYTTDMAR288XR7JB1J2JTTQH (proposal 25435dff), objective 01KYTTDN57YK8BHKY2FF7J08CK, failed tasks 01KYTTDNZK9MMWB6ZZCWM70R2C / 01KYTTDNZK9MMWB6ZZCWM70R2B
--- B: serve on an ephemeral port
    bound port: 55893
--- C: approve a real escalated task over HTTP, then prove the repeat is idempotent
C ok: a real escalated task is approved over HTTP and the repeat is a 200 no-op
--- D: reject a real failed task — the dry run writes nothing and a stale digest LOSES
D ok: a dry run writes nothing, a stale impact digest loses, and a conflicting resolution is refused
--- E: the objective verdict guard — missing is 400, stale is 409, fresh integrates
E ok: an objective verdict without its candidate is 400, with a stale one 409 before any git work
--- F: reattempt is a noun, and abandonment refuses a task that is not running
F ok: reattempt re-queues once and keeps its note; abandonment refuses a task that is not running
--- G: pausing is STATE — the suspension singleton, idempotent both ways
G ok: PUT/DELETE on the suspension singleton flips paused and both are idempotent
--- H: 021's If-Match convention is not weakened by this epic (regression)
H ok: a stale If-Match still loses on the item PATCH, and the fresh one wins
--- I: no bulk approval, and the 019 gates still fire on a transition row
I ok: no bulk verdict route exists, and the media-type, Origin and auth gates all fire
--- J: hygiene — no secret in the log, and SIGTERM stops the port
023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk
```

Exit code 0. The required success string `023 ok: …` printed verbatim:
`023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk`.
Phase D's `D ok: …` line confirms the B1 fix holds end to end (the real
discard → retry-conflict sequence answers `409 rejection_conflict`, not the
over-fired branch the review caught).

**Tasks closed.** 6/6 Stories complete (S1 — registry and PUT admission; S2 —
task verdicts; S3 — task reattempt and abandonment; S4 — objective verdicts;
S5 — the suspension singleton; S6 — the Proof and CLI-retirement inventory).
No Story left unexpanded or unimplemented. All 5 routed `action:YES` review
blockers (B1, B2, S1, S2, S3) are resolved and independently re-verified this
turn; both `action:NO` findings are recorded for the human, no further code
change required.

```
IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- proof: PASS (scripts/e2e/http-transitions-proof.sh) — "023 ok: nine verdict rows drive the run state over HTTP; every stale guard loses and no route approves in bulk"
- stories: 6/6 complete
- date: 2026-07-31
- state: 25300b874c6bd02c847e03bee32d243a09d4887a
```

END: TEST-ENGINEER

HUMAN_REVIEW: PASS
