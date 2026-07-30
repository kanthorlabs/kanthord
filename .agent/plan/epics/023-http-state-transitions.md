# EPIC 023 — HTTP state transitions: the RUN state

> Authored 2026-07-30, on top of EPIC 020 (commit `88b9df9`) and the authored
> EPIC 021 (`.agent/plan/epics/021-http-planning-writes.md`). 021 writes the
> PLAN; 023 writes the RUN state. This is step "Target 023 — state transitions"
> of `.agent/plan/stories/019-http-server/retirement.md`.
>
> **Hard dependency: 023 is BUILT only after 021 is implemented.** It uses 021's
> body reader (`src/apps/http/body.ts`), 021's `ETag`-on-every-200 line in
> dispatch, 021's `If-Match` / `readRow` machinery (only for the phase-H
> regression check) and 021's `WrongTypeReferenceError` registry entry. 023 adds
> no new dispatch shape. It was authored while 021 was still unbuilt, on the
> assumption that 021 lands as written; a mismatch is an `OPEN:` blocker for the
> human, not a build-time improvisation.
>
> **Base row count: 54** — 021's 52 plus the event feed's 2. 023 adds 9 rows →
> **63 rows**, and claims 9 CLI leaves → 63 of 78 retirable. If the event-feed
> epic has not landed when the last 023 row lands, the base is 52 and the
> assertion is 61; the story asserts the tree's real base plus the rows landed.
>
> **⚠ CROSS-EPIC CONVENTION CHANGE — read this before authoring 024-027.**
> This epic admits `PUT` into the route surface for exactly one row (decision 2).
> 019 listed `PUT` as a non-goal ("updates are `PATCH`",
> `019-http-server.md:231,408`) and `src/apps/http/routes.test.ts:95-99` asserts
> `"PUT must never appear"`. Ulrich approved the reversal on 2026-07-30 after an
> adversarial review. `PUT` stays gated by an explicit one-entry allowlist, so no
> other epic may add a `PUT` row without its own reviewed entry.

## Goal

The Control Center (016) and the Decision Workbench (017) stop being read-only.
After this epic the running `kanthord serve` program answers every human verdict
on work that has already run: approve or reject a task, approve or reject an
objective, re-queue either, abandon a running task, and pause or resume an
initiative — all on item-scoped noun paths, with the domain's own freshness
guards (`expectedCommit`, `expectImpact`) carried in the request body and refused
with a stable code when stale. Nine CLI verdict leaves become retirable; none is
removed.

## Decisions (binding; do not re-open at build time)

### 0. What 023 inherits and may NOT re-open

- **Singular path segments** and the `PATH_SEGMENTS` / `NOT_PLURAL` /
  `BANNED_VERBS` allowlists (`src/apps/http/routes.test.ts:8-68`).
- **`defineRoute` / `RouteDefinition<Input, Output>`** — no per-row `as` cast, no
  `route.present!` (`src/apps/http/routes.ts:52-98`).
- **021's status contract**: `POST` on a collection → `201` + `location`; an item
  `PATCH` → `readRow` + REQUIRED `If-Match` (`428` absent, `412` stale) → `200`
  with the re-read DTO; a body-less action → `204` with no body and no `ETag`.
- **`ETag` on every `200` `kind:"json"` response** = `"` + sha256 of the
  presented DTO + `"`.
- **One view module per resource** under `src/apps/http/views/`, LITERAL field
  lists, no `domain/` import, no object spread of an entity.
- **The error registry holds only what a row can raise** (019 decision 11) — read
  the throw sites.
- **The 019 envelope, Basic auth, and the eight middleware in their order** — add
  none, reorder none.
- A body-less unsafe request still sends `Content-Type: application/json`: the
  gate at `src/apps/http/app.ts:170` keys off the method, not the bytes.
  `DELETE` is exempt.

### 1. One noun per transition, and `reattempt` for retry

`BANNED_VERBS` bans `approve`, `reject`, `retry`, `abandon`, `pause` and `resume`
as path segments, so every transition needs a noun. Five new reviewed
`PATH_SEGMENTS` entries: `approval`, `rejection`, `reattempt`, `abandonment`,
`suspension`. None ends in `s`, so `NOT_PLURAL` gains nothing.

**`reattempt`, not `attempt`.** `attempt` is already the vocabulary of a real
future resource: an execution attempt has an id, a lease and a representation
(`src/app/task/run-next-task.ts:485` — "a fresh candidate id that identifies THIS
execution attempt"), and EPIC 026 owns the job API. `POST /api/task/:id/attempt`
would therefore be a create on a collection 026 will want to `GET`, which forces
a `201` + `Location` at a path that has no representation today — exactly the lie
021 decision 4 refused. `reattempt` names the _request to re-queue_, has no
representation of its own, and cannot collide with 026.

### 2. Pausing is STATE — `PUT`/`DELETE` on the suspension singleton

```
PUT    /api/initiative/:id/suspension   → 204   PauseInitiative
DELETE /api/initiative/:id/suspension   → 204   ResumeInitiative
```

The suspension's existence IS the `paused` flag. The state stays readable as
`paused` on `GET /api/initiative/:id` (`src/apps/http/views/initiative.ts:14,34`
already present it), so the sub-resource needs no representation of its own and
answers `204`.

**Why not `PATCH /api/initiative/:id {"paused":true}`** (the shape
`retirement.md` sketched):

1. That row is 021's `initiative.patch`, and its `run` calls `RenameInitiative`.
   `paused` needs `PauseInitiative` / `ResumeInitiative`
   (`src/app/initiative/pause-initiative.ts:21-29`,
   `resume-initiative.ts:21-29`). One row serving both means `run` switches on
   which body field arrived — "exactly the logic `RouteDefinition.run` forbids",
   the reason 021 decision 5 rejected the same shape for resources. A use case
   may never call a use case (AGENTS.md), so no app-layer facade fixes it.
2. Carrying `paused` on that row therefore needs a NEW `UpdateInitiative
{name?, paused?}` use case, which leaves `RenameInitiative`,
   `PauseInitiative` and `ResumeInitiative` orphaned or duplicated — two
   implementations of one rule drift.
3. `If-Match` there is a hash of the WHOLE presented initiative DTO. That DTO
   moves under a running daemon (status, workspace, objective rollups), so a
   pause would be refused `412` for a change that has nothing to do with
   pausing — a false conflict on the screen whose whole job is to stop the
   daemon.

**Why `PUT` and not `POST`** (adversarial review, 2026-07-30; Ulrich decided):
`PUT` is "ensure the resource at this client-known URI exists", which is exactly
this request. `POST` would work — `setPaused(id, true)` is idempotent in code
(`pause-initiative.ts:28`) — but that idempotence would be an implementation
accident, invisible to clients, retries and intermediaries, while `PUT` states
it in the protocol. The reviewed cost is listed at the top of this file: `PUT`
was a 019 non-goal. It is admitted here, scoped:

- `HttpMethod` (`src/apps/http/routes.ts:30`) gains `"PUT"`.
- `routes.test.ts` drops the blanket `"PUT must never appear"` assertion and
  gains a `PUT_ROWS` allowlist holding exactly `initiative.suspension.put`. Any
  other `PUT` row fails the policy test until a human adds a reviewed entry —
  the same discipline as `PATH_SEGMENTS` and `NOT_PLURAL`.
- **No middleware is added or reordered, but ONE middleware config changes.**
  `requiresJsonContentType` and `requiresOriginCheck` already list `PUT`
  (`src/apps/http/app.ts:26-39`), and `matchRoute` compares `route.method` as
  data (`src/apps/http/router.ts:70`), so the media-type and CSRF gates need no
  edit and a body-less `PUT` must still carry
  `Content-Type: application/json`. But `@koa/cors` is configured with
  `allowMethods: ["GET", "POST", "PATCH", "DELETE"]` (`app.ts:153`), which
  advertises the preflight answer — `"PUT"` MUST be added there or a browser
  preflight for the suspension row fails. No test asserts `allowMethods` today,
  so S5 adds one (an `OPTIONS` preflight advertising `PUT`).
- **021 is NOT retro-changed.** Its six dependency rows stay `POST`, and its
  Proof phase I still asserts `PUT /api/project` → `405`, which remains true:
  no `PUT` row exists on that path. Whether dependency edges should also become
  `PUT` is a separate maintainer decision, not 023's.

**Accepted risk, recorded (adversarial review):** there is no `If-Match` here, so
two concurrent operators are last-write-wins, and the harm is asymmetric — a
stale _resume_ can restart a daemon somebody deliberately stopped, which is worse
than a stale pause. A real guard needs a suspension generation (the ABA case
`paused → resumed → paused` is invisible to a boolean validator), and `Initiative`
carries only `paused: boolean`, so that means a schema migration. kanthord serves
ONE engineer on loopback (AGENTS.md), so 023 accepts the risk and records it here
for the epic that ever makes kanthord multi-operator. For the same reason the
suspension has no body and no representation today; if it ever needs `pausedBy` /
`reason` / `pausedAt`, that epic adds a `GET` and its own validator on the URI
this epic establishes.

### 3. No `If-Match` on the verdict rows — the guards already travel in the body

021 made `If-Match` a PATCH-only concept via `readRow`. A `POST` precondition
would be a NEW dispatch shape, and 023 does not build one, because the domain
already ships a guard for exactly this race:

- `ApproveObjective`, `RejectObjective` and `RetryObjective` REQUIRE
  `expectedCommit` and call `assertCandidateFresh` → `StaleCandidateError`
  (`src/app/objective/approve-objective.ts:47,65`;
  `reject-objective.ts:120,139` plus an in-transaction re-check at `:161`;
  `retry-objective.ts:84,104,117`). EPIC 012 decision 4 made it required, and
  omitting it a usage error.
- `RejectTask` and `RejectObjective` accept `expectImpact`, a digest over the
  damage preview, re-checked INSIDE the write transaction
  (`src/app/task/reject-task.ts:205,216`).

Both run inside the write transaction, which an `ETag` computed outside it cannot
do. Layering `If-Match` on top would give two competing preconditions per request
and make `412` mean two different things.

**The exceptions, named as the instruction requires.** `ApproveTask`, `RetryTask`
and `AbandonTask` have NO freshness token in their input
(`approve-task.ts:127`, `retry-task.ts:69-74`, `abandon-task.ts:104`), and 023
invents none. Their protection is the status guard, which runs in the same
transaction as the write. The consequence, stated: two operators approving one
task can both receive `200 approved` — the second through the idempotent branch.
Only one transition happens, and both operators wanted the same outcome, so the
residual harm is a misleading success line, not divergent state. A whole-DTO
validator on a task would false-conflict constantly, because the daemon writes
task result rows between the client's read and its verdict.

Where the client gets each token, with no new read row needed:

- `expectedCommit` ← `GET /api/objective/:id`, which already presents `commitOid`
  (`src/apps/http/views/objective.ts:35`; `src/app/objective/get-objective.ts:20`
  says it in words: "the candidate commit a client must echo back on a verdict").
- `expectImpact` ← the same rejection row with `{"dryRun":true}` (decision 5).

`expectedCommit` is REQUIRED in the three objective bodies: absent or blank →
`400 invalid_input` from `requireBodyString`. Never weakened to optional.

### 4. Statuses, and the wire discriminant is always `outcome`

| row                                  | status | why                                                                                            |
| ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| task approval                        | 200    | `ApproveOutcome` is a 4-way union (`approve-task.ts:29-40`); the UI must read the discriminant |
| task rejection                       | 200    | returns `{skipped, preview}`; 017 shows the damage even under `--yes`                          |
| task reattempt                       | 204    | `RetryTask.execute` → `Promise<void>`                                                          |
| task abandonment                     | 200    | `AbandonOutcome` = `abandoning` \| `already_abandoning` (`abandon-task.ts:52-55`)              |
| objective approval                   | 200    | returns `{outcome:"integrated"\|"conflict"}`                                                   |
| objective rejection                  | 200    | returns `{preview}`                                                                            |
| objective reattempt                  | 204    | `Promise<void>`                                                                                |
| initiative suspension `PUT`/`DELETE` | 204    | `Promise<void>`, no representation                                                             |

- **The field name is pinned, not implied.** `ApproveTask` returns `kind`
  (`approve-task.ts:30`) while `AbandonTask` and `ApproveObjective` return
  `outcome`. The wire field is `outcome` on all three; `taskApprovalView` maps
  `kind → outcome`, and a unit test asserts `kind` never reaches the wire.
- **No row answers `201`** — nothing addressable is created — so no row declares
  `location`, which 021's policy test requires iff `successStatus === 201`.
  `POST` + `200` is already 021 precedent (`initiative.graph.apply`,
  `project.resource.create`).
- **Every `200` transition response carries a fresh `ETag`**, inherited from
  021's one dispatch line; every `204` row carries none.
- **A `conflict` outcome is `200`, not `409`.** `ApproveTask`'s conflict path
  WRITES: it updates the candidate state and appends `task.conflict` inside a
  transaction (`approve-task.ts:246-259`), and `ApproveObjective` does the same
  through `#recordConflict`. The request succeeded and needs no client change;
  the UI routes the operator to `GET /api/task/:id/conflict`, which 020 already
  serves. A `4xx` on a request that committed state would be a lie.
- **`landing_failed` never presents `cause`** — that field is an arbitrary caught
  error (`approve-task.ts:37`). The literal list is
  `{outcome, taskId, canonicalSHA?, conflictFiles?, message?}`, and a test proves
  a fake returning a `cause` cannot leak it.

### 5. `dryRun` is a body field on the rejection rows, not a separate GET

`RejectTask` / `RejectObjective` with `dryRun:true` return the preview before the
transaction and write nothing (`reject-task.ts:203-206`,
`reject-objective.ts:143-145`). That is the only way a client learns the `digest`
it must echo as `expectImpact`, and 017 built the flow that way.

Rejected: a `GET /api/task/:id/rejection` twin binding `dryRun:true` — a
duplicated row for one boolean, on a path naming a rejection that never happened.

**Ordering fact every test and the Proof must respect:** `dryRun` returns BEFORE
the `expectImpact` comparison (`reject-task.ts:203` then `:205`), so a
stale-digest assertion must be sent WITHOUT `dryRun` or it never reaches the
comparison.

`--yes` and `--json` are NOT exposed: they are CLI IO (the prompt lives in
`runRejectTask`, not in the use case). Over HTTP the request IS the confirmation.

### 6. The objective's `--resolution retry` is a CLI-side branch, so HTTP splits it

`reject objective --resolution retry` never reaches `RejectObjective`: the CLI
handler picks between `deps.rejectObjective` and `deps.retryObjective`
(`src/apps/cli/commands/reject/objective.ts:60-63`). An app may not choose
between use cases, so:

- `POST /api/objective/:id/rejection` carries NO `resolution` field — discard
  only;
- `resolution=retry` for an objective IS `POST /api/objective/:id/reattempt`.

`RejectTask` is different: one use case owns both resolutions
(`reject-task.ts:141-147`), so the task row takes a REQUIRED
`resolution: "retry" | "discard"` and its `run` stays one line. The asymmetry is
a property of the two use cases, not of the HTTP layer.

### 7. Idempotency and repeats — each read from the code

| row                         | repeat behaviour                                                                                                      | code                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| task approval               | `200`, same DTO — **only if** the escalation carried a proposal commit (`completed` + `commitSha === proposalCommit`) | `approve-task.ts:132-138`    |
| task approval               | otherwise `409 task_not_awaiting_confirmation`                                                                        | `:141-143`                   |
| task rejection              | the same `resolution` already stored → `200`, `skipped: []`                                                           | `reject-task.ts:188-190`     |
| task rejection              | a different `resolution` stored, or the task already `completed` → `409 rejection_conflict`                           | `:158-160,192-194`           |
| task reattempt              | the second call sees `pending` → `409 task_not_retryable`                                                             | `retry-task.ts:130-131`      |
| task abandonment            | already revoked → `200 {"outcome":"already_abandoning"}`                                                              | `abandon-task.ts:135-137`    |
| objective approval          | the second call sees `integrated` → `409 objective_not_awaiting_confirmation`                                         | `approve-objective.ts:57-62` |
| objective reattempt         | tip-integrated → silent no-op `204`, and a stale `expectedCommit` is STILL refused                                    | `retry-objective.ts:92-105`  |
| suspension `PUT` / `DELETE` | idempotent `204`                                                                                                      | `pause-initiative.ts:28`     |

The task-approval split is the subtle one: an escalation that changed nothing has
`proposalCommit === null`, so the idempotent branch cannot fire and a repeat is
`409`. Stated here so nobody "fixes" it at build time. The Proof's fixture writes
a file before escalating precisely so the `200` branch is the reachable one.

### 8. Two app-layer changes, both found by reading the code

1. **`RejectTask.execute` loses `| undefined` from its return type.** It is
   declared `Promise<{skipped: string[]; preview: DiscardPreview} | undefined>`
   (`reject-task.ts:141-147`), but all six return sites return an object
   (`:189,196,204,208`, the retry branch at `:301`, and the discard tail at
   `:385`). The vestigial `undefined` would force `present` to invent a body for
   a case that cannot happen. Narrow the type; change no behaviour.
2. **`DiscardPreview`, `Damage` and `DamageEffect` get re-exported from
   `src/app/errors.ts`.** They live in `src/domain/impact.ts:41-77`, and
   `src/apps/http/` may not import `domain/`. `app/errors.ts:25-28` already
   re-exports `RepositoryLanding` / `LandingCandidate` for exactly this reason,
   so this follows the established home rather than inventing one.

Checked and deliberately NOT changed:

- `AbandonTask.execute` is **synchronous** (`abandon-task.ts:104`).
  `run: async (deps, i) => deps.abandonTask.execute(i)` is legal as is — the
  same call shape 021 decision 7 accepted for `CheckGraph`. No signature change.
- `AbandonTask` REQUIRES `reason: string`, as the CLI does
  (`src/apps/cli/commands/abandon/task.ts:14` makes it a `requiredOption`). The
  body field stays REQUIRED.
- `RetryTask`'s `rebuild` is exposed as an optional body field because it is
  load-bearing: it is what allows a retry from `awaiting_confirmation` with a
  `pending` candidate (`retry-task.ts:91-96`). `carryNote` likewise.
- `ApproveTask`'s constructor takes nine positional dependencies
  (`approve-task.ts:74-104`); `composition.ts` already builds it for the CLI, so
  `HttpDeps` receives the SAME instance. 023 constructs nothing new.

### 9. Route table — 9 rows, 9 CLI leaves

`kind` is `"json"` for every row. No row declares `location` or `readRow`.

| id                             | path                             | method | status | use case           | `cliCommands`       |
| ------------------------------ | -------------------------------- | ------ | ------ | ------------------ | ------------------- |
| `task.approval.create`         | `/api/task/:id/approval`         | POST   | 200    | `ApproveTask`      | `approve task`      |
| `task.rejection.create`        | `/api/task/:id/rejection`        | POST   | 200    | `RejectTask`       | `reject task`       |
| `task.reattempt.create`        | `/api/task/:id/reattempt`        | POST   | 204    | `RetryTask`        | `retry task`        |
| `task.abandonment.create`      | `/api/task/:id/abandonment`      | POST   | 200    | `AbandonTask`      | `abandon task`      |
| `objective.approval.create`    | `/api/objective/:id/approval`    | POST   | 200    | `ApproveObjective` | `approve objective` |
| `objective.rejection.create`   | `/api/objective/:id/rejection`   | POST   | 200    | `RejectObjective`  | `reject objective`  |
| `objective.reattempt.create`   | `/api/objective/:id/reattempt`   | POST   | 204    | `RetryObjective`   | `retry objective`   |
| `initiative.suspension.put`    | `/api/initiative/:id/suspension` | PUT    | 204    | `PauseInitiative`  | `pause initiative`  |
| `initiative.suspension.delete` | `/api/initiative/:id/suspension` | DELETE | 204    | `ResumeInitiative` | `resume initiative` |

Request bodies, named literally from the use-case inputs:

- `task.approval.create` — no fields (`{}`; the header is still required)
- `task.rejection.create` — `{resolution, reason?, dryRun?, expectImpact?}`;
  `resolution` REQUIRED, exactly `retry` or `discard`
- `task.reattempt.create` — `{note?, rebuild?, carryNote?}`
- `task.abandonment.create` — `{reason}` REQUIRED
- `objective.approval.create` — `{expectedCommit}` REQUIRED
- `objective.rejection.create` —
  `{expectedCommit, reason?, dryRun?, expectImpact?}`
- `objective.reattempt.create` — `{expectedCommit, note?}`
- the suspension pair — no body

Field-name mismatches `decode` must get right: the path param is `id`, but the
use cases take `taskId` (`approve-task.ts:127`), `objectiveId`
(`approve-objective.ts:46`) and `initiativeId` (`pause-initiative.ts:21`).

### 10. No bulk approval — enforced, not merely intended

The dashboard approves from the item screen, never from an inbox list row (a
settled decision). Every 023 path is `/api/<resource>/:id/<noun>`; there is no
collection-level transition row and no `decode` reads an array of ids. A new
assertion in `routes.test.ts` iterates the nine rows and fails if a path lacks
`:id`, or if a transition segment appears directly under `/api`.

### 11. Views

- `src/apps/http/views/verdict.ts` — `taskApprovalView` (decision 4's literal
  list, `kind → outcome`), `objectiveApprovalView` (`{outcome}`),
  `abandonmentView` (`{outcome, taskId}`).
- `src/apps/http/views/impact.ts` — `discardPreviewView`
  (`{damage: [{target: {type, id}, effect}], counts, digest}`),
  `taskRejectionView` (`{skipped, preview}`), `objectiveRejectionView`
  (`{preview}`).

LITERAL field lists, types reached only through `src/app/`, never an entity
spread.

### 12. Error registry additions (019 decision 11: only what a row can raise)

| class                                   | code                                  | status | throw site                                                                                |
| --------------------------------------- | ------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `StaleCandidateError`                   | `stale_candidate`                     | 409    | `src/domain/initiative.ts`, via `assertCandidateFresh`; re-exported at `app/errors.ts:12` |
| `ObjectiveNotAwaitingConfirmationError` | `objective_not_awaiting_confirmation` | 409    | `app/errors.ts:36`                                                                        |
| `TaskNotAwaitingConfirmationError`      | `task_not_awaiting_confirmation`      | 409    | `app/errors.ts:66`                                                                        |
| `ImpactChangedError`                    | `impact_changed`                      | 409    | `app/errors.ts:55`                                                                        |
| `RejectionConflictError`                | `rejection_conflict`                  | 409    | `app/task/reject-task.ts:29`                                                              |
| `TaskNotRetryableError`                 | `task_not_retryable`                  | 409    | `app/task/retry-task.ts:10`                                                               |
| `ObjectiveNotRetryableError`            | `objective_not_retryable`             | 409    | `app/objective/retry-objective.ts:16`                                                     |
| `TaskNotAbandonableError`               | `task_not_abandonable`                | 409    | `app/task/abandon-task.ts:12`                                                             |
| `NoRunningJobError`                     | `no_running_job`                      | 409    | `app/task/abandon-task.ts:31`                                                             |
| `AmbiguousRunningJobError`              | `ambiguous_running_job`               | 409    | `app/task/abandon-task.ts:39`                                                             |
| `ProposalMissingError`                  | `proposal_missing`                    | 409    | `app/task/approve-task.ts:42`                                                             |
| `ProposalWorkspaceMissingError`         | `proposal_workspace_missing`          | 409    | `app/errors.ts:80`                                                                        |

The six classes that live in a use-case module are imported directly from
`src/app/<aggregate>/<file>.ts`, exactly as the registry already does for
`NoConflictCandidateError` (`src/apps/http/error-registry.ts:6`). Only the
domain-owned `StaleCandidateError` needs the `app/errors.ts` re-export, which
already exists.

**`StaleCandidateError` is 409, deliberately not 412.** 412 belongs to the
`If-Match` header mechanism 021 built; the candidate token travels in the body,
and one code per class must stay true (021's registry hygiene test). All twelve
statuses are already in `ALLOWED_STATUSES`, so no status list changes.

`UnknownReferenceError` (404) and `WrongTypeReferenceError` (400) are already
registered by 019 and 021.

Deliberately NOT registered, with the reason: `LandingCASMismatchError` (caught
and converted into a `conflict` outcome, `approve-task.ts:296-307`); `CycleError`,
`DependenciesLockedError`, `UnknownAgentError` (no 023 row reaches them); the
bare `Error("revoke invariant violated…")` at `abandon-task.ts:139` — a
broken-isolation assertion whose correct answer is `500 internal`, which is
already the fallback.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **`routes.test.ts`**: the five new `PATH_SEGMENTS` entries with no
  `NOT_PLURAL` addition; `PUT` accepted in the method list but ONLY for a row in
  the one-entry `PUT_ROWS` allowlist, with a negative control proving a second
  `PUT` row fails the policy test; the verb-ban and no-plural rules passing over
  all nine rows; decision 10's item-scope assertion; `location` and `readRow`
  unset on all nine; `present` set on the five `200` rows and unset on the four
  `204` rows; the row count is the tree's base + 9.
- **Per row, three unit tests with fakes** (the 020/021 discipline): `decode`
  maps path + body to the exact use-case input — including `id → taskId` /
  `objectiveId` / `initiativeId`, a blank id rejected by `requirePathParam`, a
  missing `expectedCommit`, a missing `reason` and an out-of-range `resolution`
  each → `400 invalid_input`; `run` calls the injected fake exactly once with
  that input; `present` returns an object whose `Object.keys()` equal the
  declared literal list, asserted key-by-key.
- **Outcome coverage:** all four `ApproveOutcome` kinds present correctly with
  `kind` mapped to `outcome`; a fake returning
  `{kind:"landing_failed", cause:{secret:"x"}}` yields a DTO with no `cause` and
  no `secret` anywhere in the enveloped body.
- **Repeat semantics:** one test per line of decision 7's table, with the fake
  returning or raising exactly what the code returns or raises.
- **Suspension:** two `PUT`s call `PauseInitiative` twice and both answer `204`;
  `DELETE` calls `ResumeInitiative`; neither response carries an `ETag`; a
  `PUT` without `Content-Type: application/json` is rejected by the existing
  gate.
- **Not reachable from a sequential Proof, so hermetic-only:**
  `NoRunningJobError` and `AmbiguousRunningJobError` need a live running lease,
  so they are covered with fakes here and never asserted in the Proof.
- **Registry:** the 12 mappings, each from exactly one class, every status
  already in `ALLOWED_STATUSES`.
- **App-layer changes (decision 8):** `RejectTask`'s narrowed return type
  compiles with no `undefined` branch at any call site and its existing tests
  stay green; the three impact types import from `src/app/errors.ts`.
- **Boundary lint:** no file under `src/apps/http/` imports `src/domain/` or
  `src/apps/cli/`, including the two new views.
- **CLI-retirement inventory** (`cli-coverage.test.ts`): the nine claimed leaves
  all name real Commander leaves, and the "uncovered set is non-empty" assertion
  at `:53-63` still holds untouched.

Proof: `scripts/e2e/http-transitions-proof.sh` — deterministic, no model, no
outbound network (loopback and `file://` only), no server and no daemon left
running. Run from the repo root:

```bash
scripts/e2e/http-transitions-proof.sh
```

It must print `023 ok: …`. The fixture is authored by
`scripts/e2e/make-transitions-graph.sh` and needs THREE packages, because the
three verdict shapes need three different run outcomes:

- **verdict** — one task whose scripted turns write a file and then call the
  built-in `escalate` tool (`src/agent-runner/pi.ts:554-561`; a `FakeTurnMap`
  keyed by task title, `src/agent-runner/fake-session.ts:86-108`), so it stops at
  `awaiting_confirmation` WITH a proposal commit (`pi.ts:717-741`,
  `run-next-task.ts:452-470`). The proposal commit is what makes a repeated
  approve the idempotent `200` branch instead of a `409`.
- **integration** — one task that writes what its Verification checks, so it
  COMPLETES and its objective reaches `awaiting_confirmation` with a `commitOid`.
  An escalated task never completes, so the verdict package cannot also serve
  this case (`landing-proof.sh:59-66` records the same lifecycle fact).
- **failure** — two tasks whose turns write nothing, so each fails its own
  Verification and reaches `failed`: one is rejected, the other re-queued.

Phases:

- **A** — the fixture through the CLI only: `db migrate`, a project, a `file://`
  bare repository, a dummy provider assigned to the project (the chain must be
  non-empty or every task fails), the three packages imported with
  `--bind source=<repo>`, and one bounded `run daemon --until-idle` pass. The
  daemon exits non-zero because two tasks fail on purpose, so its exit code is
  ignored and the phase instead asserts every fixture invariant explicitly: the
  escalated task is `awaiting_confirmation`, its `result.proposalCommit` is
  non-empty, the objective is `awaiting_confirmation`, and both failure tasks are
  `failed`.
- **B** — `serve --port 0` in an isolated working directory carrying its own
  `.env`; the bound port read from the `listening` JSON log line; an
  authenticated `/healthz` answers `200`.
- **C** — `POST /api/task/<id>/approval` `{}` → `200`, `outcome === "approved"`,
  an `ETag` present, and no `kind` or `cause` key in the DTO; the task is
  `completed`; the SAME request replayed → `200` with the same outcome.
- **D** — `POST /api/task/<id>/rejection`
  `{"resolution":"discard","dryRun":true}` → `200` with a `digest`, and the task
  is still `failed` (the dry run wrote nothing). Then, **without `dryRun`**, a
  wrong `expectImpact` → `409 impact_changed` with the status unchanged. Then the
  fresh digest → `200` and the task is `discarded`. Then
  `{"resolution":"retry"}` → `409 rejection_conflict`, still `discarded`.
- **E** — `GET /api/objective/<id>` yields `commitOid`; `POST …/approval` `{}` →
  `400 invalid_input`; with a wrong 40-hex `expectedCommit` →
  `409 stale_candidate`, with BOTH the status unchanged AND the initiative branch
  ref unmoved (SQLite cannot roll back a moved ref, so the refusal must precede
  the git work); with the real one → `200 {"outcome":"integrated"}`; replayed →
  `409 objective_not_awaiting_confirmation`.
- **F** — `POST /api/task/<id>/reattempt` `{"note":"try harder"}` → `204`, the
  task is `pending`, and the note is readable on `GET /api/task/<id>`; a second
  reattempt → `409 task_not_retryable`. `POST …/abandonment` `{"reason":"stuck"}`
  on a NON-running task → `409 task_not_abandonable` (the status guard fires
  before the running-job query, `abandon-task.ts:117-120`); a missing `reason` →
  `400 invalid_input`.
- **G** — `PUT /api/initiative/<id>/suspension` `{}` → `204` with no body and no
  `ETag`, and `paused` is `true`; a second `PUT` → `204` (idempotent);
  `DELETE` → `204` and `paused` is `false`; a second `DELETE` → `204`.
- **H** — the 021 convention is not weakened: `PATCH /api/initiative/<id>` with
  no `If-Match` → `428 precondition_required`; with a stale validator →
  `412 precondition_failed` and the name unchanged; with the real validator →
  `200` carrying the new name and a DIFFERENT `ETag`. 023 owns no `PATCH` row, so
  this phase is a deliberate regression check on 021 — a lost update on a verdict
  screen is the risk that motivated the convention.
- **I** — no bulk approval, and the gates still fire on a transition row:
  `POST /api/task/approval` → `404 unknown_route`;
  `POST /api/task/<id>/approve` → `404 unknown_route`;
  `Content-Type: text/plain` → `415`; `Origin: http://127.0.0.1:1` → `403`; an
  unauthenticated `PUT` on the suspension → `401` and `paused` proves nothing was
  written.
- **J** — the `API_KEY` appears in no log line; `SIGTERM` shuts the server down
  and the port stops accepting.

**Ran against the CURRENT tree** (2026-07-30, commit `e4af497`, EPIC 021 not yet
implemented). The script exits `1` in phase C at the first verdict:

```
--- A: fixture through the CLI only — one escalated task, one integrated-ready objective, two failed tasks
project created: 01KYS7B268HKH4VY758T3QVFJ2
repository created: 01KYS7B35BQ982RHSNACW82PKP
ai-provider registered: 01KYS7B3Y0NEBQZD8YJNKY6REH
    escalated task 01KYS7B5GA4RKS3V4NG4K4VAYE (proposal 82517df7), objective 01KYS7B6BAVA1ZJZP9N72EY92D, failed tasks 01KYS7B72XW0B3V9YNR7VT3Q6A / 01KYS7B72XW0B3V9YNR7VT3Q69
--- B: serve on an ephemeral port
    bound port: 65322
--- C: approve a real escalated task over HTTP, then prove the repeat is idempotent
FAILED: approve task status — expected '200', got '404'
FAILED: scripts/e2e/http-transitions-proof.sh line 237
```

Phases A and B pass in full — the three fixtures reach exactly the states the
verdicts need, `serve` binds, and an authenticated `/healthz` answers `200` — so
the first failure is the missing capability, not a broken fixture. `404` (not
`405`) is the exactly right failure: `/api/task/:id/approval` is not a route at
all, so `matchRoute` reports `not_found`. The missing thing is the transition row.

## Stories

Each story keeps `npm run verify` green on its own, **declares its own `HttpDeps`
fields in `src/apps/http/deps.ts` and populates them in
`src/apps/cli/commands/serve.ts`**, and bumps the row-count assertion by the rows
it lands.

**`composition.ts` needs NO change in this epic.** All nine use cases are already
constructed there and already returned in `CliDeps`
(`src/composition.ts:1177-1206`; the interface at
`src/apps/cli/deps.ts:186-218`), under exactly the property names the HTTP rows
want: `approveTask`, `rejectTask`, `retryTask`, `abandonTask`,
`approveObjective`, `rejectObjective`, `retryObjective`, `pauseInitiative`,
`resumeInitiative`. `serve.ts:39-60` hand-picks fields off `CliDeps` into the
`HttpDeps` literal, so each story adds one line per dep there. 023 constructs no
use case and injects the SAME instances the CLI uses.

- **S1 — the registry and the app-layer prep.** Decision 8's two changes with
  their tests; the 12 registry mappings with the one-class-per-code test; the five
  new `PATH_SEGMENTS` entries; the `PUT` admission (`HttpMethod`, the `PUT_ROWS`
  allowlist and its negative control); decision 10's item-scope assertion. No row
  lands, so `verify` proves the plumbing change is behaviour-preserving.
- **S2 — task verdicts.** `task.approval.create` and `task.rejection.create`,
  `views/verdict.ts`, `views/impact.ts`, `approveTask` + `rejectTask` wired end to
  end, including the no-`cause` and `kind → outcome` assertions. Base + 2.
- **S3 — task reattempt and abandonment.** `task.reattempt.create` and
  `task.abandonment.create`, `retryTask` + `abandonTask` wired, plus the two
  running-job errors covered with fakes. Base + 4.
- **S4 — objective verdicts.** The three objective rows with the REQUIRED
  `expectedCommit`, `approveObjective` + `rejectObjective` + `retryObjective`
  wired. Base + 7.
- **S5 — the suspension singleton.** `initiative.suspension.put` and
  `initiative.suspension.delete`, `pauseInitiative` + `resumeInitiative` wired,
  with the idempotency and no-`ETag` assertions. Base + 9.
- **S6 — the Proof.** `cli-coverage.test.ts` records the nine claimed leaves, and
  `scripts/e2e/http-transitions-proof.sh` (with
  `scripts/e2e/make-transitions-graph.sh`) passes end to end. No wiring is left
  for this story.

## Non-goals

- The frontend host (024), ai-provider writes (025), the job API (026), and
  land / publish (027). 023 makes the 016/017 screens actionable at the API
  level; building those screens is 024's job.
- Any change to how the daemon picks work.
- A `POST` precondition dispatch shape, `If-None-Match` / `304`, and any new or
  reordered middleware.
- A suspension representation, body, or generation/version column — the
  concurrency risk decision 2 records is accepted for now, not solved.
- `PUT` on any row other than the suspension singleton.
- Bulk or list-row approval, in any form.
- The CLI's `--yes` prompt, `--json` formatting, and `--out` file writing.
