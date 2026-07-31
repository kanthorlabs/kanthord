# EPIC 026.2 — collections + project Overview + the polling engine — stories

Epic: `.agent/plan/epics/026.2-ui-collections-and-overview.md`
Prereq: EPIC 026.1 (sequence order) — its shells, hash route table, token layer
and five shared parts must exist before Story 03 starts.

After these stories the operator sees real project state in the browser: the
Projects collection, the project Overview composition, the four typed Resources
tabs, and one visibility-gated polling engine that refreshes the Overview with
no click.

## Dispatch order

1. `01-name-filter-substring.md` — backend only, independent of `ui/`.
2. `02-query-keys-and-api-helpers.md` — every UI story imports it.
3. `03-projects-collection.md`
4. `04-overview-composition.md`
5. `05-polling-engine.md` — coupled pair with 04 (it edits
   `ui/src/pages/project-overview.tsx`); run it directly after 04.
6. `06-resources-typed-tabs.md`
7. `07-proof.md` — last; it runs the whole Proof.

## Stories

- 01 — `?name=` becomes a case-insensitive substring filter → `01-name-filter-substring.md`
- 02 — query keys, DTO types, `api-client` list helpers → `02-query-keys-and-api-helpers.md`
- 03 — Projects W1: table, server-side search, read-only pane → `03-projects-collection.md`
- 04 — Overview composition: cards, decisions, digest, truncated → `04-overview-composition.md`
- 05 — `useVisibilityPoll` and its wiring to Overview only → `05-polling-engine.md`
- 06 — Resources W1: typed tab route, four row grammars, unknown type → `06-resources-typed-tabs.md`
- 07 — the Proof prints `026.2 ok: …` → `07-proof.md`

## Facts (needed for implementation)

**F1 — the lane.** EPIC 026.2 decision 12 (Ulrich, 2026-07-31) lets Story 01
write `src/app/project/list-projects.ts` and `src/app/resource/list-resources.ts`
with their tests. That is the only exception; every other story writes `ui/**`
and `scripts/**` only.

**F2 — the wire envelope.** Every JSON 200 is `{"data": …}`
(`src/apps/http/envelope.ts:11`). `apiGet` already unwraps `.data`
(`ui/src/lib/api-client.ts:60-80`), so helpers return the inner value.

**F3 — read routes and their exact bodies** (all measured on this tree):

| route                                                                             | source                                                       | body                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `GET /api/project` (`?name=`)                                                     | `src/apps/http/routes.ts:304-317`                            | `{id, name}[]` (`views/project.ts:21`)        |
| `GET /api/project/:id`                                                            | `routes.ts:318-328`                                          | `{id, name}`                                  |
| `GET /api/project/:id/overview`                                                   | `routes.ts:329-339`                                          | see F4 (`views/project.ts:68-112`)            |
| `GET /api/project/:id/{repository,credential,notification,filesystem}` (`?name=`) | built at `routes.ts:148-170`, registered `routes.ts:442-448` | `ResourceDto[]` (`views/resource.ts:108-119`) |
| `GET /api/resource/:id`                                                           | `routes.ts:449-459`                                          | one `ResourceDto`                             |

`?name=` is validated by `optionalQueryString` (`src/apps/http/decode.ts:40-56`):
repeated param → `400 invalid_input`, blank after trim → `400 invalid_input`.
The UI therefore never sends `name=` with an empty value.

**F4 — `projectOverviewView` shape** (`src/apps/http/views/project.ts:68-112`):

```
{ projectId,
  initiatives: [{ id, name, status: "building"|"landed"|"discarded", paused,
                  taskCounts: { pending, running, completed, failed,
                                awaiting_confirmation, discarded },
                  needsHuman, action: ActionView | null }],
  lanes:      [{ repositoryId: string|null, objectiveIds[], initiativeIds[] }],
  decisions:  [{ action: ActionView, initiativeId, objectiveId: string|null,
                 taskId: string|null, downstream: number,
                 actionableSince: number|null }],
  digest:     { since: string|null, latest: string|null, totalCount,
                byType: Record<string, number>, events: EventView[],
                hasMore, pageCursor: string|null } }
```

`ActionView` = `{kind, target:{type,id}, targetDependencyId?, requiresInput:
string[], command?}` (`views/shared.ts:18-28`) — optional keys are **omitted**,
never `null`. `EventView` = `{id, type, taskId?, objectiveId?, initiativeId?,
repositoryId?, payload?}` (`views/shared.ts:70-86`).
`digest.latest` is the newest project event id, a ULID
(`src/app/project/get-project-overview.ts:332`); `hasMore = totalCount >
events.length` with a 50-event cap (`get-project-overview.ts:341-342`).

**F5 — the four resource DTOs** (`src/apps/http/views/resource.ts:60-106`):

- `repository`: `{type, id, projectId?, name, remoteUrl, branch, path, auth, publication}`
- `credential`: `{type, id, projectId?, name, provider}` — **never `value`**
- `notification`: `{type, id, projectId?, name, provider, destination}`
- `filesystem`: `{type, id, projectId?, name, path}`

`auth` is `{kind:"ambient"} | {kind:"https-token", credentialId} |
{kind:"ssh-agent"}` (`views/shared.ts:88-104`). `publication` is `null` or
`{state: "unpublished"|"published"|"diverged", remoteOID: string|null}`.
**A list row always carries `publication: null`** — `toResourceView` hardcodes it
(`src/app/resource/resource-view.ts:85`); only `GET /api/resource/:id` fills it
(`src/app/resource/get-resource.ts:29-37`).

**F6 — resolving EPIC 026.1's exports.** 026.1 fixes the names but not every
file path. Before importing any of `AsyncBoundary`, `StatusChip`,
`FreshnessBar`, `CommandHandoff`, `NotBuiltYet`, `publicationLabel` or the
Query→AsyncBoundary adapter, locate it mechanically:

```bash
rg -n "export (function|const|type) <Name>" ui/src
```

Import from the single file that matches. If nothing matches, 026.1 did not
ship it — raise an `OPEN:` blocker instead of writing a second copy. The same
rule resolves the route param name: read `ui/src/app/router.tsx` and use the
param spelling its own route table declares for the project id.

**F7 — decision-row link targets.** EPIC 026.3 fixes the canonical entity hash
paths (`.agent/plan/epics/026.3-ui-entity-workspaces.md:55-58`). A decision row
builds its href from the fields it carries (`get-project-overview.ts:263-318`
guarantees them):

- `taskId !== null` → `#/project/<projectId>/initiative/<initiativeId>/objective/<objectiveId>/task/<taskId>`
  (a task decision always carries `objectiveId`, `get-project-overview.ts:296-297`)
- else `objectiveId !== null` → `#/project/<projectId>/initiative/<initiativeId>/objective/<objectiveId>`
- else → `#/project/<projectId>/initiative/<initiativeId>`

Until 026.3 registers those routes the link resolves to AsyncBoundary `missing`.
That is accepted and must not be worked around.

**F8 — UI test conventions** (`ui/vite.config.ts:149-154`): Vitest 4 + jsdom,
`globals: false` (import `describe/test/expect/vi` from `vitest` explicitly),
include `src/**/*.test.{ts,tsx}`, setup `ui/vitest.setup.ts` (jest-dom).
Component tests follow `ui/src/pages/health.test.tsx`: a local
`renderWithQuery(ui)` wrapping a fresh `QueryClient({defaultOptions:{queries:
{retry:false}}})`, `vi.mock("@/lib/api-client", …)` with `vi.importActual`
spread, `afterEach(() => { cleanup(); vi.clearAllMocks(); })`, assertions via
`screen.getByTestId(...)`. `@testing-library/user-event@14.6.1` is installed but
unused so far. Alias `@/` → `ui/src` works in tests.
Run one file with: `npm run test --workspace ui -- <relative path>`.

**F9 — the UI lane.** `ui/**` is browser code: ESLint rule R4
(`eslint.config.js:116-151`) errors on any Node or Electron import.
`ui/src/lib/api-client.ts` is the only module that may call `fetch`
(EPIC 026 rule R3), and it never sets an `Authorization` header.
No new dependency may be installed (EPIC 026 decision 9); every package the
stories need is already in `ui/package.json` — React 19.2.8, react-router-dom
7.18.1, @tanstack/react-query 5.101.4, the shadcn set incl. `table.tsx`,
`input.tsx`, `card.tsx`, `badge.tsx`, `tabs.tsx`.

**F10 — Proof selectors (binding, do not rename).**

| selector                                                                                                            | owner story                        |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `[data-testid="project-table"] tbody tr`, `tr[data-project-id="<id>"]`                                              | 03                                 |
| `[data-testid="collection-search"]`                                                                                 | 03 (shared with 06)                |
| `[data-testid="detail-pane"]`                                                                                       | 03 (shared with 06)                |
| `[data-testid="overview-initiative-card"]`, `[data-initiative-id="<id>"]`                                           | 04                                 |
| `[data-testid="count-pending"]` … `count-discarded`                                                                 | 04                                 |
| `[data-testid="overview-decisions"]`, `[data-testid="overview-digest"]`, `[data-testid="digest-truncated"]`         | 04                                 |
| `[data-testid="resource-tabs"] a`, `[data-testid="resource-table"] tbody tr`, `[data-testid="resource-col-branch"]` | 06                                 |
| `[data-testid="async-missing"]`, `[data-testid="freshness-updated"]`, `[data-testid="freshness-refresh"]`           | EPIC 026.1 — reuse, never redefine |

**F12 — 026.1's Proof breaks by design.** `scripts/e2e/ui-system-proof.sh:138-147`
asserts the `#/project/<id>/overview` leaf still renders `not-built-yet` naming
`026.2`. Story 04 builds that leaf. Story 07 moves that assertion to the graph
leaf; no other story may touch that file.

**F11 — what the Proof does to the page** (`scripts/e2e/ui-collections-proof.sh`):
it fills `[data-testid="collection-search"]` with `alpha` and then waits for
`networkidle`, so the search debounce must be well under 500 ms; it clicks the
tab link matching text `Repositor`, so the four tabs must be real `<a>`
elements with those labels; it reads a count cell with
`.replace(/\D/g, "")`, so a count element contains the number and nothing else
that could add digits; it waits up to 35 s for the pending count to rise, which
is two `POLL_INTERVAL_MS = 15_000` intervals.
