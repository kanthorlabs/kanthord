# EPIC 026.3 — entity workspaces (read-only) — stories

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md`
Prereq: EPIC 026.2 (sequence order), which itself needs EPIC 026.1. The stories
below import `AsyncBoundary`, `asyncStateOf`, `StatusChip`, `CommandHandoff`,
`publicationLabel`, `ProjectShell`, `ROUTE_TABLE`, `ui/src/lib/dto.ts`,
`ui/src/lib/query-keys.ts` and the `api-client` list helpers. All of them are
026.1/026.2 deliverables and are never re-specified here.

After these stories every entity the API can describe has a canonical nested
URL that cold-loads: initiative, objective, task and resource render as W2
workspaces with fixed tabs and an honest empty state per tab; a real entity
under the wrong parent is a scope mismatch, not a missing entity; and a due
action with no HTTP route shows a disabled control plus the server's own CLI
command.

## Dispatch order

1. `00-detail-view-ancestry-and-conflict-cause.md` — backend only, independent of
   `ui/`; Story 01's DTOs and Story 04's Conflict row need the fields it adds.
2. `01-nested-routes-and-scope-validation.md` — data layer, gate, routes. Every
   other story imports it.
3. `02-breadcrumb-from-real-names.md` — coupled pair with 01 (it edits
   `ui/src/app/entity-chain.ts` and `ui/src/components/entity-workspace.tsx`);
   run it directly after 01.
4. `03-initiative-workspace.md`
5. `04-objective-workspace.md`
6. `05-task-workspace.md`
7. `06-disabled-action-inventory.md` — coupled pair with 05 (it edits
   `ui/src/pages/entity-task.tsx`); run it directly after 05.
8. `07-resource-workspace.md`
9. `08-proof.md` — last; it runs the whole Proof and the sibling regressions.

## Stories

- 00 — detail-view ancestry (`projectId`, `initiativeId`) + `conflictCause` on the wire → `00-detail-view-ancestry-and-conflict-cause.md`
- 01 — nested routes, DTOs, query keys, scope verdicts, the gate, `ScopeMismatch`, `EntityWorkspace` → `01-nested-routes-and-scope-validation.md`
- 02 — breadcrumb segments from the chain's real names → `02-breadcrumb-from-real-names.md`
- 03 — initiative W2: Summary · Objectives · Dependencies → `03-initiative-workspace.md`
- 04 — objective W2: Summary · Tasks · Integration → `04-objective-workspace.md`
- 05 — task W2: five tabs, evidence kept beside interpretation → `05-task-workspace.md`
- 06 — the disabled-action inventory + CommandHandoff's first consumer → `06-disabled-action-inventory.md`
- 07 — resource W2, Summary only → `07-resource-workspace.md`
- 08 — the Proof prints `026.3 ok: …` → `08-proof.md`

## Facts (needed for implementation)

**F1 — the lane.** Story 00 is the **one exception** (Ulrich, 2026-07-31): it
writes six `src/` files and their tests — the three detail views plus their three
use cases — to put the detail DTOs' ancestry and `conflictCause` on the wire. It
adds no route, no port, no constructor dependency, and writes no data. Every
other story writes `ui/**` (non-test files: software-engineer; `*.test.ts(x)`:
test-engineer) and nothing else.
`scripts/e2e/ui-entities-proof.sh` already exists and is **executable** —
Story 08 may not edit its assertions. `package.json` is lane-forbidden and
needs no change (`build:ui`, `verify`, `ui:test` all exist,
`package.json:24-28`). No new dependency (EPIC 026 decision 9).

**F2 — the wire envelope.** Every JSON 200 is `{"data": …}`
(`src/apps/http/envelope.ts:5-9`); `apiGet` already unwraps `.data`
(`ui/src/lib/api-client.ts:79`), so helpers return the inner value. A missing
entity is `404 unknown_reference` (`src/apps/http/error-registry.ts`, thrown at
`src/app/task/get-task.ts:123`), which `asyncStateOf` maps to `"missing"`
(026.1 S5 branch 2). **A non-ULID id is also `404 unknown_reference`** — there
is no id validation in `src/apps/http/` (`src/apps/http/decode.ts:3-14`), which
is why the Proof's made-up task id reaches the `missing` state.

**F3 — read routes this epic uses** (all measured on this tree):

| route                                         | source              | body                                                                     |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `GET /api/project/:id/initiative`             | `routes.ts:340-354` | `InitiativeView[]` — **carries `projectId`** (`views/initiative.ts:21`)  |
| `GET /api/initiative/:id`                     | `routes.ts:355-365` | `InitiativeDetailView` (`views/initiative.ts:40-50`)                     |
| `GET /api/initiative/:id/objective`           | `routes.ts:377-391` | `ObjectiveView[]` — **carries `initiativeId`** (`views/objective.ts:18`) |
| `GET /api/objective/:id`                      | `routes.ts:392-402` | `ObjectiveDetailView` (`views/objective.ts:47-62`)                       |
| `GET /api/initiative/:id/task?objective=<id>` | `routes.ts:403-430` | `TaskRowView[]` (`views/task.ts:19-27`)                                  |
| `GET /api/task/:id`                           | `routes.ts:431-441` | `TaskDetailView` (`views/task.ts:40-72`)                                 |
| `GET /api/resource/:id`                       | `routes.ts:449-459` | one `ResourceDtoView` (`views/resource.ts:54-58`)                        |

There is **no** `GET /api/objective/:id/task`: the only objective-scoped task
list is the `?objective=` query on the initiative-scoped route
(`routes.ts:421-425`, filtered at `src/app/task/list-tasks.ts:46-49`). An
unknown `?objective=` value answers `200 []`, **not 404**.

**F4 — ancestry: the gap, and what Story 00 fixes.** Measured **before** Story 00:
`InitiativeDetailView` has no `projectId` (`views/initiative.ts:40-50`),
`ObjectiveDetailView` has no `initiativeId` (`views/objective.ts:47-62`),
`TaskDetailView` has `objectiveId` and nothing above it (`views/task.ts:45`).
**Story 00 adds all three** — `projectId` to the initiative detail,
`initiativeId` to the objective detail, `initiativeId: string | null` to the task
detail — each from a value its use case already holds.

Still missing after Story 00, and deliberately out of scope: `projectId` on the
objective and task detail views (neither use case has an initiative source, so it
needs a new constructor dependency and composition wiring), and any ancestor id
on `TaskRowView` (`views/task.ts:19-27`; `TaskRow` does not project
`objectiveId`, `src/app/task/list-tasks.ts:6-13`).

**Story 01 still implements decision 3's collection-based verdicts verbatim**,
even though the new fields would allow a simpler direct-field check on every
level. Decision 3 is binding and only Ulrich may amend it; the redundancy is
recorded, not silently optimised away.

**F5 — absent-vs-null on the wire is inconsistent within one DTO.** Pin every
read against this table; never test `=== null` where the key is omitted.

- **Keys omitted entirely when absent**: `TaskDetailView.agent`, `.note`,
  `.instructions`, `.ac`, `.verification`, `.dependencyStatus`, `.context`
  (`views/task.ts:79-99`; `context` vanishes when `{}`,
  `src/app/task/get-task.ts:198`; `dependencyStatus` vanishes when there are no
  dependencies, `get-task.ts:138-144`); `InitiativeDetailView.workspace`
  (`views/initiative.ts:61`); `ObjectiveDetailView.commitOid`, `.parentOid`
  (`views/objective.ts:71-72`); `ResourceDtoView.projectId`
  (`views/resource.ts:64,74,91,102`); `ActionView.command`,
  `.targetDependencyId` (`views/shared.ts:22-27` — the documented idiom is
  `"command" in action`, `src/domain/actionability.ts:78-81`).
- **Always present, `null` when absent**: `TaskDetailView.result`,
  `.landingCandidate`, `.action` (`views/task.ts:90,100-113`);
  `ObjectiveDetailView.conflictReason`, `.note` (`views/objective.ts:79-80`);
  every field of `TaskResultView` including `evidence`
  (`views/shared.ts:106-122`).
- **Always present**: `TaskDetailView.objectiveId`, `.dependencies`,
  `.abandoning`, `.waiting`, `.blockedForever`, `.downstream` (`0` even when the
  initiative scope is unknown, `get-task.ts:164`);
  `InitiativeDetailView.branch` (derived `kanthord/init/<id>`,
  `src/app/initiative/get-initiative.ts:55`), `.status` (defaulted to
  `"building"`, `:53`), `.paused`, `.after`, `.waiting`.
- **`ObjectiveDetailView` drops `conflictCause` on this tree, and Story 00 fixes
  it.** The use case computes it (`src/app/objective/get-objective.ts`, always
  present, `string | null`) but `objectiveDetailView` omits it
  (`views/objective.ts:47-82`), so `GET /api/objective/:id` does not send it —
  while `src/apps/cli/objective.ts:91-92` already prints it. That CLI/HTTP parity
  gap is what made decision 5's "conflict fields", plural, unbuildable. The
  omission is **test-locked** in two existing cases
  (`src/apps/http/views/objective.test.ts:59-110`, each asserting
  `"conflictCause" in view === false`), so Story 00 updates those two tests as
  part of the change. From Story 00 onward both `conflictCause` and
  `conflictReason` are always-present nullable keys on the detail view. Do not
  fetch `GET /api/objective/:id/conflict` for the richer payload — conflict work
  is fenced to 026.7.

**F6 — `waiting` has two incompatible shapes.** Detail views (initiative,
objective, task) carry `{id, neverSatisfies}[]` (`views/shared.ts:36-47`);
the task **list row** carries a bare `string[]` (`views/task.ts:25`). One shared
"blocked by" renderer over both is a bug — keep them separate.

**F7 — `dependencyStatus` can carry a status outside the union.** A dangling
dependency renders `status: "unknown"` (`get-task.ts:142`), which is **not** in
`TASK_STATUS_VALUES` (`views/task.ts:10-17`). Every status render in this epic
therefore goes through the guard of Story 01 §5, never straight into
`StatusChip`.

**F8 — `integrations[]` is synthetic and thin.** At most **one** element,
`{repository, state}` where `repository` is the initiative's resolved repository
**id** (not a name) and `state` is a copy of the objective status
(`src/app/objective/get-objective.ts:79-82`). Empty array when no repository
resolves. Story 04 resolves the name with one ungated `GET /api/resource/:id` and
keeps the id beside it — the readable form never replaces the exact fact.

**F9 — actions: 5 of 6 kinds have no HTTP route.** `ActionKind` is
`retry | approve | reject | publish | resume-initiative | remove-dependency`
(`src/domain/actionability.ts:9-15`). Only `remove-dependency` has a route —
`DELETE /api/task/:id/dependency/:dependencyId` (`routes.ts:838-850`).
`command` is the CLI invocation **without** the `kanthord ` prefix and without
`--json` (`actionability.ts:76-77`); it is **omitted** for
`actionRejectTaskAwaiting` (`:111-119`) and for every objective action reached
through `nodeAction`, because that projection passes `expectedCommit: null`
(`:351`). `TaskDetailView.action` is the only `action` field this epic reads —
neither `InitiativeDetailView` nor `ObjectiveDetailView` has one.
Story 06 does **not** encode this route inventory in the UI: what it lists is
which action kinds a _later UI epic_ owns, because "a route exists" and "the
browser can drive it" are different properties and only the second decides what
renders.

**F10 — the route table is data; the router beside it is nested.** Corrected
2026-07-31 against 026.1's delivery. `ui/src/app/routes.tsx` exports **both**
`ROUTE_TABLE: readonly AppRoute[]` — where `AppRoute = {path, kind, epic?}`,
with **no `element` field** — and `createAppRouter()`. `ui/src/app/router.tsx`
no longer exists. Registering a screen is therefore two edits in one file: the
`ROUTE_TABLE` entry and the matching route object in `createAppRouter()`.
`createAppRouter()` is nested: a `GlobalShellLayout` parent over `/inbox`,
`/project` and `*`; a standalone `/operations`; a `ProjectRoute` parent at
`/project/:id` over the five leaves. `ROUTE_TABLE` order stays "`*` last".

**F11 — the four entity routes are top-level siblings, and render their own
shell.** They are **not** children of `ProjectRoute`, for one reason:
`ProjectRoute` hardcodes `segments={[project.name]}` (`routes.tsx:59-60`) and
cannot carry the deeper breadcrumb these pages need. So each of the four renders
`<ProjectShell projectId segments>` itself. A page that _is_ a `ProjectRoute`
child (026.2's Overview, Resources) must **not** render a shell of its own.
That the entity routes spell the param `:projectId` while `ProjectRoute` spells
it `:id` is an inconsistency, not the reason for the split; both spellings
resolve safely because the branches are separate. **Debt, recorded for EPIC
026.9: normalize the project-id param to one spelling.**

**F12 — `ProjectShell` and the breadcrumb.** `ui/src/components/shell.tsx:124`
`ProjectShell({projectId, segments, pendingCount?, children})`; the breadcrumb
is `shell.tsx:137-146` and renders the `segments` strings verbatim.
`shell.test.tsx:168` asserts the breadcrumb **never contains an id** — so a
segment is always a real name or the level is dropped, never an id fallback.

**F13 — shadcn `Tabs`.** `ui/src/components/ui/tabs.tsx:91` exports
`Tabs, TabsList, TabsTrigger, TabsContent`. `role="tab"` / `role="tablist"` /
`role="tabpanel"` come from the Radix primitive, not from this file. Radix
**unmounts inactive `TabsContent`** unless `forceMount` is passed — that is what
keeps exactly one `[data-testid="tab-panel"]` in the DOM and keeps a hidden
tab's query unmounted and unfetched.

**F14 — UI test conventions** (`ui/vite.config.ts:149-154`): Vitest 4 + jsdom,
`globals: false` (import `describe/test/expect/vi` from `vitest`), include
`src/**/*.test.{ts,tsx}`, setup `ui/vitest.setup.ts` (jest-dom). Component tests
follow `ui/src/pages/health.test.tsx:3-33`: a local `renderWithQuery(ui)` over a
fresh `QueryClient({defaultOptions:{queries:{retry:false}}})`,
`vi.mock("@/lib/api-client", …)` with a `vi.importActual` spread,
`afterEach(() => { cleanup(); vi.clearAllMocks(); })`, `screen.getByTestId(...)`.
Router-bound tests use `createMemoryRouter` + `initialEntries` over the real
`ROUTE_TABLE` (026.2 S6 convention). Run one file with
`npm run test --workspace ui -- <relative path>`.

**F15 — R3 and R4.** `ui/src/lib/api-client.ts` is the only module that may call
`fetch` and it never sets `Authorization` (EPIC 026 rule R3). `ui/**` may import
neither Node nor Electron (`eslint.config.js:103-153`).
**This epic issues no POST, PATCH or DELETE at all** — `apiGet` is still the only
verb `api-client.ts` exports and no story adds another.

**F16 — the Proof harness** (`scripts/e2e/ui-browser.mjs`). `--script` must be
an absolute path. The steps module receives
`{page, context, goto, text, count, visible, consoleErrors, requests, responses, base}`.
`goto(hash)` is a **full page load** (`page.goto`, `waitUntil: "networkidle"`),
never a client-side navigation — so every assertion in the Proof is a cold load.
`text(selector)` **throws** when nothing matches (it does not return `""`).
`count(selector)` does **not** wait. `requests[].authorization` is what the
**page** set, because Playwright applies the context's `httpCredentials` after
the `request` event fires. `consoleErrors.length === 0` is asserted at the end,
so a React key warning fails the phase.

**F17 — Proof selectors (binding, do not rename).**

| selector                                                                                           | owner story                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `[data-testid="entity-header"]`                                                                    | 01                                    |
| `[data-testid="entity-tabs"] [role="tab"]`, `[data-testid="tab-panel"]`                            | 01 (frame) — populated by 03/04/05/07 |
| `[data-testid="scope-mismatch"]`                                                                   | 01                                    |
| `[data-testid="empty-result"]`, `[data-testid="empty-landing"]`, `[data-testid="task-downstream"]` | 05                                    |
| `[data-testid="disabled-action"]`                                                                  | 06                                    |
| `[data-testid="command-handoff"]`                                                                  | EPIC 026.1 S7 — reuse, never redefine |
| `[data-testid="breadcrumb"]`, `[data-testid="async-missing"]`, `[data-testid="project-shell"]`     | EPIC 026.1 — reuse, never redefine    |

**F18 — sibling proofs that must stay green.** `scripts/e2e/ui-shell-proof.sh`
(EPIC 026), `scripts/e2e/ui-system-proof.sh` (026.1) and
`scripts/e2e/ui-collections-proof.sh` (026.2). The exact-count and
vertical-ordering assertions at `ui-collections-proof.sh:116,127,130,140-142,146`
are the tripwires: this epic touches no Overview and no collection page, and
Story 08 re-runs all three to prove it.
