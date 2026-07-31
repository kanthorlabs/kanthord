# EPIC 026.9 — candidate review end to end — stories

Epic: `.agent/plan/epics/026.9-candidate-review.md`
Prereq: EPIC 026.8 (sequence order) — its decision occurrences, `queue.item.get`
route and `#/inbox/:decisionId` page are what Stories 3 and 8 build on.

The operator reads the real per-file diff of a candidate in the browser and
answers it. Approvals name the commit they reviewed and the decision occurrence
they answer; the server refuses a verdict when either has moved; a discard
cannot be sent without the dry run's impact digest.

## Dispatch order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 9 → 8 → 10.

The file numbers follow the epic's own story list. **9 runs before 8**: the
discard precondition completes the rejection routes that Story 8's screen calls,
and a screen built against a half-finished route is a screen built twice.

- **1 + 2 are a coupled run**: the read model and the queue's structural
  `diffAvailable` both depend on `src/domain/candidate-source.ts`. Nothing
  observable changes until 6 lands.
- **3, 4, 5 are independent of each other** and may run in any order after 2.
- **7 needs 3, 4, 5, 6** — it is the row that wires them all.
- **8 needs 026.8 implemented in the same tree.** `ui/src/pages/decision.tsx`
  must exist; if it does not, stop and report rather than re-creating it.
- **10 is the gate**: it changes no production code of its own.

## Stories

- 1 — the candidate diff capability, the domain source rule, two use cases → `01-candidate-diff-read-model.md`
- 2 — `diffAvailable` becomes a structural boolean, no I/O in the domain → `02-diff-available-structural.md`
- 3 — `AssertDecisionOpen`, the guard every verdict route shares → `03-occurrence-guard.md`
- 4 — required, nullable `expectedCommit` through `ApproveTask` and the CLI → `04-task-approval-freshness.md`
- 5 — the verdict error registry and the no-`500`-for-a-state rule → `05-error-registry.md`
- 6 — `GET /api/(task|objective)/:id/candidate` → `06-candidate-routes.md`
- 7 — the four verdict routes and their status mapping → `07-verdict-routes.md`
- 8 — the W3 review screen at `#/inbox/:decisionId/review` → `08-review-screen.md`
- 9 — the discard dry-run precondition → `09-discard-dry-run.md`
- 10 — `scripts/e2e/ui-candidate-review-proof.sh` prints `026.9 ok:` → `10-proof.md`

## Facts (needed for implementation)

- **The candidate commit is not in the bare home.** `GitRepositoryLanding.preview`
  fetches it from `candidate.workspace` into `homeDir`
  (`src/landing/git.ts:106-112`); `GetConflict` passes `workspace: ""` because
  approve already did. The diff read model therefore runs in the **workspace
  clone** and never opens the home (epic decision 1).
- `ChangeCandidate` (`src/domain/landing.ts:6-16`) has **no** `workspace` field —
  only `LandingCandidate` (`src/landing/port.ts:4-13`) does. The task workspace
  path lives on `TaskResultRow.workspace` (`src/storage/port.ts:165`), read by
  `getTaskResult` (`src/storage/sqlite/sqlite-task-repository.ts:531`).
- `Initiative.workspace` is optional (`src/domain/initiative.ts:28`), read by
  `InitiativeRepository.get` (`src/storage/sqlite/sqlite-initiative-repository.ts:92,112`);
  `Objective.commitOid` `:37` and `Objective.parentOid` `:39` are both optional.
- **An escalation persists no `ChangeCandidate`** — `run-next-task.ts:452-481`
  never calls `saveCandidate`; only the candidate arm `:530-539` does. Its
  `proposalCommit` is also optional (`:465`, `:473`), so an approvable task may
  have no commit at all. That is why `expectedCommit` is nullable.
- **`--numstat` appears nowhere in `src/` today.** Three sites build a `git diff`
  _descriptor_ and none executes one: `get-objective-conflict.ts:143`,
  `decision-queue.ts:110`, `agent-runner/pi.ts:155`.
- The capability template is `src/commit-presence/` (`port.ts` + `git.ts` +
  `git.test.ts`); the exec helper to copy is `src/objective-broker/git.ts:12-17`
  (identical to `src/landing/git.ts:20-25`). Git adapter tests use real temp
  repos, hermetic `mkdtemp` + `rm` in `finally`
  (`src/landing/git.test.ts:3-4,25-66`).
- The query-use-case template is `src/app/task/get-conflict.ts` — five banner
  sections, non-exported narrow ports, `#`-private fields, positional
  constructor args. Composition wires it at `composition.ts:660-665`;
  `resolveHomeDir` is the arrow-wrapper precedent at `:640-646`, and
  `getObjectiveConflict` at `:1009-1018` is the closest analogue with
  object-literal adapters.
- **`ApproveTask` has no freshness guard** (`approve-task.ts:123`).
  `ApproveObjective` guards twice — `:66` before git work, `:136` inside the
  transaction. The insertion points on the task path are **after `:144`** (the
  status guard) and **as the first statements inside the transaction at `:334`**.
- `ApproveTask` returns four outcomes (`:29-38`); the `landing_failed` arm
  carries `cause: unknown` which must never reach the wire.
- `RejectTask` accepts `failed` + `discard` (`:162-169`), returns `undefined` on
  the idempotent path (`:147`, `:187-190`), and already re-checks
  `expectImpact` inside its transaction (`:211-219`).
  `RejectObjective` requires `expectedCommit` (`:117-124`).
- `StaleCandidateError` (`src/domain/initiative.ts:105-119`) and
  `assertCandidateFresh` (`:143-151`) exist; the error's field is `objectiveId`
  and its message shape is pinned by `activation-verdict-proof.sh:97`. The task
  path reuses the **class** through a new `assertProposalFresh`
  (Story 4) rather than renaming anything.
- HTTP: `defineRoute` `routes.ts:137-141`; `RouteMeta` `:58-73`; `location`
  required iff `201`, `readRow` required iff `PATCH` (`:105-120`, enforced by
  `routes.test.ts:153-189`). Body helpers live in `src/apps/http/body.ts`, not
  `decode.ts` (EPIC 021 decision 2); `requireBodyString` `:20`,
  `optionalBodyString` `:32`, `optionalBodyBool` `:66`. Enum validation is
  written inline in a row's `decode` (`routes.ts:213-216` is the precedent).
- The dispatcher runs non-PATCH rows at `app.ts:263-300`; `200` sets an `ETag`
  from the presented DTO (`:298`). `mapError` is first-match-wins over
  `DOMAIN_ERROR_MAPPINGS` (`error-registry.ts:175`), whose last entry is `:90`.
  `TRANSPORT_ERRORS.precondition_required` is `:139` — reused by Story 9, no new
  code.
- `routes.test.ts` pins `ROUTES.length` at `:316-318` (**57** today, **58**
  after 026.8, **60** after Story 6, **64** after Story 7), the id inventory
  `:337-388`, and the `PATH_SEGMENTS` allowlist `:42-71` (new singular segments:
  `candidate`, `approval`, `rejection`). `cli-coverage.test.ts:149` pins the
  uncovered count at `26`; Story 7 claims four leaves and moves it to **22**.
- HTTP route tests: `node:test` + supertest against `buildHttpApp` with fake
  deps; fixture header at `routes.task.test.ts:1-17`.
- **ui/ is at 026 + 026.1 only in this tree.** `api-client.ts` exports
  `ApiError`, `apiUrl`, `apiGet` and nothing else — **no POST**. There is no
  `useMutation`, no `useState`, no `<form>` and no mounted `<Toaster />`
  anywhere in `ui/src`. Story 8 introduces the first of each, and its pinned
  shapes become the workspace convention.
- `asyncStateOf` maps **only** `404` → `missing` (`async-state.ts:32-37`); every
  other status is `error`. A `409` therefore needs the explicit `review-stale`
  branch, not `AsyncBoundary`.
- `AsyncBoundary` testids: `async-loading`, `async-empty`, `async-error`
  (with `role="alert"`), `async-missing`, `async-expired`, `async-truncated`,
  `async-resolved` (`async-boundary.tsx:36-104`). `DangerConfirm` testids:
  `danger-confirm-trigger|dialog|cancel|accept` (`danger-confirm.tsx:34-48`);
  its `onConfirm` is sync `() => void` with no pending state.
  `CommandHandoff` testids: `command-handoff`, `-note`, `-command`, `-copy`
  (`command-handoff.tsx:19-38`).
- `ROUTE_TABLE` (`routes.tsx:31-42`) is declarative metadata **and** the router
  array at `:77-137` is hand-written; both must be edited in lockstep, and
  `routes.test.tsx:43-58` pins the table's exact path list and order. A `screen`
  row must carry **no** `epic` field (`:73-82`).
- Vitest is `globals: false` (`ui/vite.config.ts:148`), so every test imports
  `{ afterEach, expect, test, vi }` from `"vitest"`. Tests mock
  `@/lib/api-client` at module level, never `fetch`
  (`operations.test.tsx:18-26`), and each file does its own `cleanup()` in
  `afterEach`. `ui/vitest.setup.ts` is two lines and adds no polyfill.
- `ui/index.html:16` sets `form-action 'none'`, so a native form submission is
  blocked by policy — writes must go through `fetch`.
- `npm run verify` = root typecheck, `node --test`, verify:handoff, root eslint,
  ui typecheck, ui eslint, vitest, `build:ui`, `node src/main.ts db status`.
