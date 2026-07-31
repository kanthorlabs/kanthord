# EPIC 026.7 — the decision Inbox (W1) and the conflict screens (W3) — stories

Epic: `.agent/plan/epics/026.7-ui-inbox-and-conflict.md`
Prereq: EPIC 026.6 (sequence order).

The operator gets one cross-project decision list in the server's own order, with
the daemon's exact CLI commands where it has them, plus two entity-keyed conflict
screens that render real evidence and stay honest when the conflict is gone.

## Dispatch order

`01 → 02 → 03 → 04 → 05 → 06 → 07 → 08`.

- **01 is the adapter.** DTOs, keys, fetch helpers and the four pure functions
  every later story reads.
- **02 → 03 → 04 edit `ui/src/pages/inbox.tsx` sequentially.** 02 builds the
  table, 03 adds selection and the verdict pane, 04 adds refresh. They must not be
  run in parallel.
- **05 → 06 are the W3 pair.** 05 builds the shell plus the task variant; 06
  reuses that shell for the objective variant. 06 creates no new shared component.
- **07 edits `ui/src/app/routes.tsx` once**, after every page it registers exists.
- **08 runs only after 01–07 and edits no file.**

## Stories

- 01 — the queue and conflict adapter → `01-queue-adapter.md`
- 02 — the Inbox W1: rows, order, truncation, warnings → `02-inbox-table.md`
- 03 — the selection pane and the verdict inventory → `03-selection-pane-verdicts.md`
- 04 — manual refresh, all five behaviours → `04-manual-refresh.md`
- 05 — the W3 conflict shell and the task variant → `05-conflict-shell-task-variant.md`
- 06 — the objective conflict variant → `06-objective-conflict-variant.md`
- 07 — the Inbox and conflict routes → `07-routes.md`
- 08 — the locked browser Proof → `08-proof.md`

## Facts (needed for implementation)

### The wire

- `GET /api/queue` (`src/apps/http/routes.ts:510-523`) takes only `limit`
  (1–500, `invalid_input` outside), returns `{data: {...}}` with a response
  `ETag` that nothing validates. Server default limit is 50
  (`src/app/project/get-decision-queue.ts:94`); this epic always sends 500.
- `counts` and `warnings` are computed **before** slicing
  (`get-decision-queue.ts:348`, `:364-373`), so `counts.total` is the true total
  and `truncated` is `items.length < counts.total`.
- Order is `downstream` desc → `actionableSince` asc (null last) → id asc
  (`src/domain/decision-queue.ts:252-267`). `kindLabel` is never a sort key.
  `downstream` is a dependent count, hard-coded `0` for publication items
  (`:242`).
- `kindLabel` is one of exactly five strings (`src/domain/actionability.ts:382-387`):
  `task-review`, `operational-failure`, `objective-conflict`,
  `objective-candidate`, `publication`.
- A queue item exists only for: task `awaiting_confirmation` or `failed`,
  objective `conflict` or `awaiting_confirmation`, initiative `landed` with
  publication `unpublished`/`diverged` (`actionability.ts:389-420`). A **paused**
  initiative produces nothing.
- `DecisionItemView.verdicts` is typed `readonly unknown[]`
  (`src/apps/http/views/queue.ts:12`) but every runtime element is `actionView`
  (`views/shared.ts:18-28`) = `{kind, target{type,id}, targetDependencyId?,
requiresInput, command?}`. Story 01 declares the real shape as the UI DTO; no
  runtime validator.
- Verdicts that carry a `command` and their exact strings live at
  `src/domain/actionability.ts:89-217`. `approve task --id <id>` has
  `requiresInput: []`; `reject task (awaiting)` (`:111-119`) has **no** `command`
  and `requiresInput: ["resolution","reason"]`. Presence is tested with
  `"command" in v`, never `=== null`.
- `evidence` is `{basis: "verification-and-summary", diffAvailable: false,
inspect: {executable:"git", args:[...]} | null}`
  (`src/domain/decision-queue.ts:73-77`). `diffAvailable` is never `true` for a
  queue item. `inspect` is nulled when the home, base oid or head oid is missing
  or malformed, and for every oid of a home whose probe threw — which is also what
  emits a `warnings[]` entry (`get-decision-queue.ts:192-206`).
- `GET /api/task/:id/conflict` (`routes.ts:524-534`) answers **409
  `no_conflict_candidate`** for both "no candidate" and "unknown task"
  (`src/app/task/get-conflict.ts:81-83`) — there is no 404 on this route.
  `GET /api/objective/:id/conflict` (`routes.ts:535-547`) answers **409
  `objective_not_in_conflict`** or **404 `unknown_reference`**
  (`src/app/objective/get-objective-conflict.ts:100-108`). Both codes are pinned
  by `scripts/e2e/http-reads-proof.sh:254-255` and mapped in
  `src/apps/http/error-registry.ts:47-62`.
- `TaskConflictView.files[].hunks` is a **string** — the whole conflict-marked file
  body from `git cat-file`, markers included — and is `""` when the blob could not
  be read (`src/landing/git.ts:161-177`). `files` itself can be empty even for a
  real conflict (`git.ts:152-159`). `ObjectiveConflictView` has **no** `files`
  (`views/conflict.ts:26-47`).
- **No route mutates a conflict, and no route approves, rejects, retries,
  abandons or resumes.** The whole route table is `routes.ts:267-1024`; the
  approve/reject/retry use cases are wired to the CLI only. Every response control
  in this epic is disabled or a CLI handoff.

### The `ui/` workspace

- Only EPIC 026.1's files exist today. Everything this epic imports from
  026.2–026.6 arrives with those epics: `apiPath`, `RequestInitLike`, the `fetchX`
  helpers and `projectKeys` (026.2 Story 02); `DetailPane`/`DetailRow`
  (026.2 Story 03); `Gate`, `ScopeMismatch`,
  `useTaskChain`, `useObjectiveChain` (026.3 Story 01); `ACTION_KIND_LABEL`
  (026.3 Story 06, `ui/src/components/action-inventory.tsx`).
- `apiGet` (`ui/src/lib/api-client.ts:56`) unwraps `{data}`, never sets
  `Authorization`, and throws `ApiError(status, code, message, requestId)`. It is
  the only `fetch` caller in `ui/`.
- `asyncStateOf` (`ui/src/lib/async-state.ts:25`) branch order is binding:
  pending → 404-missing → error → undefined-data → `isEmpty` → resolved. It never
  returns `expired` or `truncated`; **this epic does not change that** — decision 4
  renders truncation as a banner beside a live table, so `AsyncBoundary`'s
  `truncated` and `expired` branches stay unused. EPIC 026.1's note that "the
  decision queue supplies them in 026.7" is superseded by decision 4.
- `AsyncBoundary` testids: `async-loading`, `async-empty`, `async-error`,
  `async-missing`, `async-expired`, `async-truncated`, `async-resolved`
  (`ui/src/components/async-boundary.tsx:36-97`).
- `CommandHandoff` props are `{command, reason}`; it renders `command-handoff`,
  `command-handoff-note`, `command-handoff-command`, `command-handoff-copy`
  (`ui/src/components/command-handoff.tsx:6-36`).
- `FreshnessBar` props are `{updatedAt, onRefresh, refreshing}` and it disables
  its own button on `refreshing` (`ui/src/components/freshness-bar.tsx:9-35`).
- `ROUTE_TABLE` is documentation-and-test data with **no** `element` field; the
  real router config is written out again inside `createAppRouter()`
  (`ui/src/app/routes.tsx:30-136`). Every route change edits both places plus
  `routes.test.tsx`.
- `OperationsPage` is the precedent for a page that owns its own `GlobalShell`
  because it needs the header slot (`ui/src/pages/operations.tsx:22`). The Inbox
  follows it.
- Vitest: jsdom, `globals: false` (import `describe`/`test`/`expect`/`vi` from
  `"vitest"`), `@/` alias, `afterEach(cleanup)`, a fresh `QueryClient` with
  `retry: false` per test, `fireEvent` rather than `user-event`. Single file:
  `npm test --workspace ui -- src/<path>.test.tsx`.
- **Every page test in this epic stubs `globalThis.fetch`, not
  `@/lib/api-client`.** The `vi.mock("@/lib/api-client", { …actual, apiGet: vi.fn() })`
  idiom (`ui/src/pages/operations.test.tsx:12-20`) works only because
  `healthQueryOptions` lives in a **different** module (`queries.ts`) and imports
  `apiGet` across the module boundary. This epic's `fetchQueue`,
  `fetchTaskConflict` and `fetchObjectiveConflict` live **inside**
  `api-client.ts` and call `apiGet` through their own lexical binding, which a
  mocked export cannot replace. Use the `vi.spyOn(globalThis, "fetch")` convention
  from `ui/src/lib/api-client.test.ts:19` and `ui/src/lib/queries.test.ts:10-42`,
  routing by URL and recording the requested URLs. That also makes the
  no-fan-out assertion a real request assertion, and it keeps the epic's Gate rule
  that no test may stub a per-row entity fetch.
- `npm run verify` runs root typecheck + tests + handoff + lint, then
  `ui:typecheck`, `ui:lint`, `ui:test`, `build:ui`, `db status`.

### Reserved names — do not take them

- EPIC 026.8's proof already uses `inbox-row-title`, `inbox-filter-kind`,
  `inbox-counts-global` and `#/inbox/<id>`
  (`scripts/e2e/ui-decision-identity-proof.sh:180-192`).
- EPIC 026.4's `ConflictPanel` owns `conflict`, `conflict-base`, `conflict-draft`,
  `conflict-current`, `conflict-reload` — those are HTTP 412 write conflicts, a
  different concept from this epic's domain conflicts.
- EPIC 026.3's objective Summary owns `objective-conflict-cause` and
  `objective-conflict-reason`; its task Summary owns `disabled-action*`.
- EPIC 026.3's routes test asserts no `ROUTE_TABLE` path matches `/^\/inbox\//`.
  That assertion stays green and is decision 1's guard.

### The chain gate is not re-derivable — do not try

`useTaskChain` / `useObjectiveChain` return an **already-resolved** `gate` plus the
entities and `projectName`. They expose neither their `GateQuery` entries nor their
`mismatch`, and `resolveGate` accepts exactly one `role: "entity"` query, which the
chain has already spent. **No story in this epic calls `resolveGate`.** The conflict
query is a separate state, composed by `ConflictWorkspace`'s four-step precedence
(Story 05): chain gate → gone → conflict async state → body. The chain deliberately
outranks the 409, because `GET /api/task/:id/conflict` is keyed by the task id alone
and would otherwise answer a well-formed 409 for a wrong-chain URL, telling the
operator "this conflict is no longer present" about an entity the URL does not
actually contain.

### Proof fixture invariants (the Proof is locked; these are why it passes)

- `scripts/e2e/ui-inbox-proof.sh:107-110` drives **exactly one** task to `failed`
  with a no-op fake agent, so the queue holds exactly one item. Two consequences
  the script relies on without asserting:
  - Phase C compares the UI's `?limit=500` window against a `curl` that passes **no
    limit**, i.e. the server default of 50. The two agree only below 50 items.
  - Phase E computes expectations from `items.find(i => i.taskId === task) ?? items[0]`
    but clicks `tbody tr` **first**. A second, higher-ranked item would compare one
    item's pane against another item's verdicts.
- Neither is a defect in this epic's stories; both are recorded so a future fixture
  change is understood as breaking the Proof's arithmetic, not the UI.

### Decision 10 is about provenance, not concatenation (settled)

The story expansion's debate read "the UI never assembles a git line of its own" as
also forbidding the rendering of `evidence.inspect`. Ulrich amended decision 10 on
2026-07-31 to settle it: the rule is about **where the tokens came from**.

- **Forbidden** — a command whose tokens the UI chose: a `git merge`/`git checkout`
  line, a `kanthord …` line built from a template, an id or a status. No module in
  `ui/` owns CLI vocabulary. There is no status-to-command table anywhere.
- **Permitted** — rendering a command whose every token the server sent: a
  verdict's exact `command`, and `evidence.inspect`'s `[executable, ...args]` via
  `inspectCommand` (Story 01), which adds separators and POSIX quoting only.
  `docs/ui-design.md:262-265` requires exactly this and names `evidence.inspect`.

So `CommandHandoff` has precisely two sources in this epic — `verdict.command` and
`inspectCommand(evidence.inspect)` — and a third would be a review blocker.
Quoting is an **allowlist** (`/^[A-Za-z0-9_@%+=:,./-]+$/` passes verbatim,
everything else is single-quoted), never a metacharacter blocklist.
