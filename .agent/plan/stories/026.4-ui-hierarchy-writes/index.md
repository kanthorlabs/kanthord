# EPIC 026.4 — hierarchy writes + the conditional-edit layer — stories

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md`
Prereq: EPIC 026.3 (sequence order). 026.1–026.3 capability is assumed to exist
and is never re-specified here.

The operator creates projects, initiatives, objectives and tasks in the browser,
renames what has a rename route, edits dependency edges on all three aggregates,
and every guarded write goes through one edit-session layer that freezes the
`ETag` the edit started from.

## Dispatch order

`01 → 02 → 03 → 04 → 05 → 06 → 07 → 08`.

- **01 + 02 are a coupled pair.** 02's panel renders the states 01's hook
  produces; 02 has no test without 01.
- **03 has no dependency on 01/02** (it only touches the query cache) but is
  imported by 04–07, so it lands before them.
- 04–07 all import 01, 02 and 03; 04 and 05 both edit
  `ui/src/pages/project-overview.tsx`-adjacent surfaces and the shared write
  helpers in `ui/src/lib/api-client.ts`, so they are sequential by file overlap,
  not by caution.
- 05 and 07 are the two heavy stories: each carries three write surfaces. Their
  `Change` sections are ordered task lists; implement them in the order written.

## Stories

- 01 — the write transport + the frozen edit session → `01-edit-session-transport.md`
- 02 — the three-version conflict panel → `02-conflict-panel.md`
- 03 — the invalidation matrix and its guard → `03-invalidation-matrix.md`
- 04 — project create + rename on the Projects collection → `04-project-create-rename.md`
- 05 — initiative + objective create and rename → `05-initiative-objective-writes.md`
- 06 — task create, the full-page form → `06-task-create.md`
- 07 — dependency add/remove on three aggregates → `07-dependency-edges.md`
- 08 — the Proof → `08-proof.md`

## Facts (needed for implementation)

**F1 — the precondition pipeline.** `src/apps/http/app.ts:236-261`: a PATCH row
pre-reads its `readRow`, then `404` (missing entity) → `428` (no `If-Match`) →
`412` (`ifMatch !== etagOf(before)`, exact string compare) → write → re-read →
`200` + fresh `ETag`. `src/apps/http/etag.ts:9-12`:
`etagOf = '"' + sha256(JSON.stringify(dto)) + '"'` over the presented detail DTO.

**F2 — status contracts.** `201` sets `Location`, never `ETag`
(`app.ts:288-299`). `204` sets neither and has no body (`app.ts:266-270`). Every
`200` JSON response carries an `ETag`. Error envelope is exactly
`{"error":{"code","message","requestId"}}` (`src/apps/http/envelope.ts:7-21`);
success is `{"data":…}`.

**F3 — the write routes** (`src/apps/http/routes.ts`):

| route                                | method + path                                                          | body                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `project.create` `:548`              | POST `/api/project`                                                    | `name`                                                                                          |
| `project.patch` `:560`               | PATCH `/api/project/:id`                                               | `name`                                                                                          |
| `project.initiative.create` `:574`   | POST `/api/project/:id/initiative`                                     | `name`, `paused?`, `after?[]`                                                                   |
| `initiative.patch` `:594`            | PATCH `/api/initiative/:id`                                            | `name`                                                                                          |
| `initiative.objective.create` `:608` | POST `/api/initiative/:id/objective`                                   | `name`, `after?[]`                                                                              |
| `objective.patch` `:627`             | PATCH `/api/objective/:id`                                             | `name`                                                                                          |
| `objective.task.create` `:641`       | POST `/api/objective/:id/task`                                         | `title`, `instructions?`, `ac?[]`, `verification?[]`, `agent?`, `dependencies?[]`, `context?{}` |
| `*.dependency.create` `:825,851,877` | POST `/api/{task,initiative,objective}/:id/dependency`                 | `dependencyId`                                                                                  |
| `*.dependency.delete` `:838,864,890` | DELETE `/api/{task,initiative,objective}/:id/dependency/:dependencyId` | –                                                                                               |

**A task is created under its OBJECTIVE**, not its initiative:
`POST /api/objective/:id/task`.

**F4 — dependency error codes** (`src/apps/http/error-registry.ts:42-91`):
`cycle_detected` 409, `unknown_reference` 404, `wrong_type_reference` 400,
`unknown_dependency` 400, `sequencing_scope` 400, `sequencing_locked` 409,
`dependencies_locked` 409. A **task** edge across initiatives answers
`unknown_dependency`, not `sequencing_scope` — tasks have no scope check
(`src/app/task/add-dependency.ts:73-80`).

**F5 — dependency writes change the parent ETag.** `initiativeDetailView`
(`src/apps/http/views/initiative.ts:52-65`) and `objectiveDetailView`
(`views/objective.ts:64-82`) both include `after` and `waiting`. The project
detail DTO is `{id, name}` only (`views/project.ts:21-23`).

**F6 — the transport seam.** `ui/src/lib/api-client.ts` exports only `ApiError`,
`apiUrl`, `apiGet` today, plus the read helpers 026.2/026.3 add. `apiGet:56-79`
discards `response.headers`. R3 (EPIC 026 `:193-196`): this module is the only
`fetch` caller and no `Authorization` header may appear in `ui/` source in any
mode. `fetch` does not reject on 4xx — every helper reads `response.status`.

**F7 — installs nothing.** EPIC 026 decision 9: the whole dependency set is
already installed and the lockfile is maintainer-only. No `react-hook-form`, no
`zod`, no `msw`. Forms are `useState` over shadcn `Input`/`Textarea`/`Label`/
`Button`/`Sheet`. A missing package is an `OPEN:` blocker, never an install.

**F8 — CSP `form-action 'none'`** (`ui/index.html:14-17`): every form submits
through JS (`onSubmit` + `preventDefault`), never a native action.

**F9 — query keys** (026.2 S2 + 026.3 S01, `ui/src/lib/query-keys.ts`):
`projectKeys.{all,list,detail,overview,resources}`, `initiativeKeys.{list,detail}`,
`objectiveKeys.{list,detail}`, `taskKeys.{list,detail}`, `resourceKeys.detail`,
`invalidateOverview(client, projectId)` (`exact: true`).

**F10 — the create control lives on the surface that lists the collection it
creates into.** This is the placement rule for every create in this epic, and it
is what the Proof already assumes: Overview lists initiative cards → initiative
create is there; the initiative page's `objectives` tab lists objectives →
objective create is there; the objective page's `tasks` tab lists tasks → the
link to task create is there. Renames follow epic decision 6 (entity-owned where
the entity has a W2 page; project rename on the collection). No new tab is added
to any W2 page — 026.3 decision 5 fixes the tab sets and
`ui-entities-proof.sh:152` counts exactly five task tabs.

**F11 — test conventions.** Vitest 4 + jsdom, `globals: false` (import
`describe/test/expect/vi` in every file), no auto-cleanup (each file owns
`afterEach(() => { cleanup(); vi.clearAllMocks(); })`), no `msw`. Module tests
stub `vi.spyOn(globalThis, "fetch")` returning a real `Response`
(`ui/src/lib/api-client.test.ts:12-49` is the exemplar); component tests
`vi.mock("@/lib/api-client", …)` over a `vi.importActual` spread. Single file:
`npm run test --workspace ui -- <relative path>`.

**F12 — role tokens.** Reuse `ROLE_CLASS` from `ui/src/lib/status-role.ts`. Never
interpolate a role into a class name — Tailwind v4 scans source text, so
`` `text-role-${role}` `` produces no CSS. A conflict or error surface uses
`ROLE_CLASS.attention` or `ROLE_CLASS.danger`; it introduces no colour.

**F13 — the Proof drives selectors no epic table names.** These are pinned by
the stories that build them: `create-initiative`, `create-initiative-name`,
`create-initiative-submit` (story 05), `rename-open` (stories 04 and 05),
`dependency-option[data-task-id]` (story 07).

**F14 — the browser driver.** `scripts/e2e/ui-browser.mjs` is the only proof
helper; it already collects `responses` for this epic's 412 (`:83-85`) and
`requests[].authorization` for R3 (`:76-79`). `goto(hash)` is always a cold load
with `waitUntil: "networkidle"`.

**F15 — the Proof's PATCH audit is binding on the UI design.**
`ui-writes-proof.sh:202-203` asserts **exactly two** PATCHes to
`/api/project/<id>` across the whole run. A rename must never retry, and no other
code path may PATCH a project. Set no `retry` on any write.

**F16 — earlier-epic artifacts this epic amends.** Each amendment is
**conditional on the prerequisite landing as specified**; if the artifact differs,
adapt to what is in the tree and do not invent a new one.

- 026.2 story 03's assertion that the Projects page exposes no
  `/new|create|rename|delete/i` button → story 04 relaxes it.
- 026.3 story 06's `ACTION_KINDS_DEFERRED_TO_LATER_EPICS = {"remove-dependency":
"026.4"}` → story 07 removes that entry, as 026.3 story 06 instructs.

The `/project/:id/plan` route was mistagged `epic: "026.4"`; it was retagged
`026.8` in a maintainer session on 2026-07-31 and is **not** this epic's work.

**F18 — the router is nested; the table carries no `element`.**
`ui/src/app/routes.tsx` owns `ROUTE_TABLE` (`AppRoute = {path, kind, epic?}`)
**and** `createAppRouter()`; `ui/src/app/router.tsx` does not exist. The factory
has a `GlobalShellLayout` parent over `/inbox`, `/project`, `*`; a standalone
`/operations`; and a `ProjectRoute` parent at `/project/:id` over the five
leaves. 026.3's four entity routes and this epic's `.../task/new` are
**top-level siblings** that render their own `<ProjectShell>`, because
`ProjectRoute` hardcodes `segments={[project.name]}` and cannot carry a deeper
breadcrumb. Registering a screen is two edits in one file.

**F17 — sibling proofs that must stay green** after any shared-file edit:
`scripts/e2e/ui-shell-proof.sh`, `ui-system-proof.sh`, `ui-collections-proof.sh`,
`ui-entities-proof.sh`.
