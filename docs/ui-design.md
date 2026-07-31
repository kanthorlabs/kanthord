# UI design: layout, templates and semantic tokens

Settled 2026-07-30 by Ulrich, after a `/debate` pass (engine `pi`, read-only)
that rejected an earlier, more optimistic version of this document. Binding on
every UI epic. The harness itself is `.agent/plan/epics/026-ui-dev-harness.md`.

shadcn/ui supplies the primitives. This document is the layer above it: the
shell, the page templates, and the one semantic scale that makes the app read as
a single system.

## The operator's four jobs

From `README.md` and the daily-routine requirements:

- **J1 Observe → act.** Glance at cross-project state, find what needs a human,
  act, continue. The dominant daily load. Governing principle: _fewer decisions
  per item_ — scannable rows, clear defaults, low-friction confirmation. Often
  done from a phone, in time-boxed passes.
- **J2 Plan + import.** Author a kanthord-compatible package outside the app,
  import it into a project, get an initiative → objective → task graph.
- **J3 Read the graph.** Watch status transitions across repositories to decide
  where to intervene.
- **J4 Set up.** Resources, agents, providers, daemon health. Recurring.

## What the API can actually serve (measured 2026-07-30, 50 routes)

This section exists because the first draft of this design assumed data that
does not exist. Re-measure before trusting it.

**Buildable now:** projects and resources (create / rename / patch); the full
import path (`POST /api/project/:id/graph`, `GET /api/initiative/:id/package`,
`POST /api/graph/readiness`, `POST /api/initiative/:id/graph`); the initiative
graph (`GET /api/initiative/:id/graph`); project overview with task counts,
lanes, decisions and an event digest; entity details for initiative, objective,
task, resource; the cross-project decision queue (`GET /api/queue`, read-only);
conflict resolution **with a real diff** — `views/conflict.ts:9` gives
`files[] {path, hunks}`.

**Not buildable, with the reason:**

| Gap                                        | Evidence                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Candidate diff review                      | `views/queue.ts:26` types `evidence.diffAvailable` as the literal `false`; `evidence.inspect` is a git command for a terminal |
| Inbox row titles                           | `DecisionItemView` has no title — only `kindLabel`, `projectName` and ids                                                     |
| Inbox deep links, resolved/expired         | queue items have no id, and there is no `GET /api/queue/:id` and no history                                                   |
| Approve / reject / retry / abandon / pause | roadmap Target 023; `initiative.patch` (`routes.ts:553`) accepts `name` only                                                  |
| Dead-man card                              | `/healthz` returns `{status, version}` only — no last ping, no processed-today                                                |
| Live readiness                             | `routes.ts:970` hardcodes `probeRepositories: false`, `probeProvider: false`                                                  |
| Agents                                     | no routes at all, though `README.md` makes Agent first-class                                                                  |
| Queue filter / sort / cursor               | `routes.ts:469` accepts only `limit` (1–500); the view returns `truncated`                                                    |
| Digest paging                              | `routes.ts:287` decodes only the path param — the client cannot page the digest. **Ulrich: add cursor paging** (see below)    |

**Queue order is NOT an impact ranking.** `src/domain/decision-queue.ts:252`
sorts by `downstream` desc, then `actionableSince` asc (null last), then id. The
UI must display the server's real order and name it in the toolbar. Do not
invent a stronger prioritisation in the client.

## Consequence: what the first UI product is

**Order reversed by Ulrich, 2026-07-30 (supersedes the earlier "API
prerequisites first, harness after" call).** The whole UI is built first,
against the API that exists today. The missing API integration is split out
into **EPIC 026.8**, the last UI epic, which adds the routes **and** wires them
into the screens that were shipped disabled.

Binding consequences of the reversal:

- **No screen may pretend to act.** A control that needs a gap route ships
  **visibly disabled or as an explicit empty state**, with the reason named and
  a `CommandHandoff` where a CLI command exists. It never calls a route that
  does not exist.
- **A gap-dependent control is not optional decoration.** Each one is listed in
  its epic and re-listed in 026.8, so 026.8 enables a known set, not a
  discovered one.

### UI epic order (roadmap; each epic is authored one at a time)

Epic number order **is** execution order.

| Epic   | Scope                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 026    | Dev harness: `ui/` workspace, served build, dual-mode rules, one health card, the whole UI dependency set. Maintainer epic.                      |
| 026.1  | Shell + system: L1/L2 shells, hash router, token layer, the five shared parts, Operations health card.                                           |
| 026.2  | Collections: Projects (W1), project Overview, Resources (W1), read-only detail panes, the polling engine.                                        |
| 026.3  | Entity workspaces, read-only: nested canonical routes, breadcrumbs, the four W2 pages, task evidence, disabled inventory.                        |
| 026.4  | Hierarchy writes + concurrency: project/initiative/objective/task creates and renames, dependency edges, `If-Match`, 412.                        |
| 026.5  | Resource writes: the four resource schemas, write-only credential secrets, repository auth, guarded `reclone`.                                   |
| 026.6  | Graph + readiness: W4 `@xyflow/react` canvas with objective lanes, task inspector, export, project readiness.                                    |
| 026.7  | Decisions: Inbox (W1, read-only queue) and conflict resolution (W3, real diff exists today).                                                     |
| 026.8+ | The API gaps below **plus** their UI wiring, as a family of loop-sized epics (026.8–026.15); enables every control 026.1–026.7 shipped disabled. |

The screen epics were split twice as the debates measured their real surface
(Ulrich, 2026-07-30): collections separated from entity work, then entity
workspaces, hierarchy writes and resource writes separated again. The test each
time was whether one honest Proof could cover the slice.

### The 026.8 family — organised by operator loop, not by API inventory

EPIC 026.8's debate (2026-07-31) rejected one giant epic **and** rejected a
split by API prerequisite: several of those slices still failed the "one honest
Proof" test, and one was a miscellaneous bucket. The family is ordered by the
loop it closes. Each is authored one at a time, and each pairs its API addition
with the UI that addition unlocks.

| Epic   | Operator loop it closes                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 026.8  | **Inbox addressability** — persisted decision occurrences, machine kind, names in the DTO, an open/resolved/expired detail representation, server-side filters.             |
| 026.9  | **Candidate review end to end** — the candidate diff read model **with** approve/reject and stale-proposal protection, so evidence lands before the response can act on it. |
| 026.10 | **Recovery decisions** — reattempt and abandonment for failed and escalated work.                                                                                           |
| 026.11 | **Initiative control** — pause and resume, and the workspace controls they unlock.                                                                                          |
| 026.12 | **Freshness** — Target 022's event feed, project acknowledgement and digest paging, with the UI behaviour they allow.                                                       |
| 026.13 | **Resource integrity** — typed-route enforcement, project-owned credential validation, the credential revision and rotation concurrency.                                    |
| 026.14 | **Operations telemetry** — daemon heartbeat, outcome and counters, and the dead-man card.                                                                                   |
| 026.15 | **Plan / import** — package parse and validate, dry run on create, binding validation, task context on apply, then W5's first instance.                                     |
| 026.16 | **Deferred refactors** — the code changes the family found but did not own. Authored last, from the ledger at `.agent/plan/deferred-refactors.md`.                          |

**Agents are deferred**, not reserved an epic: if a task-create picker is the
only need, a list endpoint joins 026.10's slice. Agent _management_ outside the
CLI is speculative until asked for.

**Approval must never ship before its evidence.** Putting all of Target 023
ahead of the candidate diff would make approve live while the browser still
cannot show what approval judges — a capability-level breach of W3's
"evidence first, response last".

**026.9 covers objective verdicts as well as task verdicts** — Ulrich,
2026-07-31, after the 026.9 debate. The row above said "task approve/reject".
Measurement says the per-task approve gate is no longer the ordinary delivery
path (`scripts/e2e/landing-proof.sh:63-64`): the human gate moved to
`approve objective`, so a task-only 026.9 would leave the commonest decision on
the queue unanswerable in the browser. The same rule as above then binds the
widening: objective verdicts ship **with** objective evidence
(`parentOid..commitOid`), never before it.

The prerequisite inventory below is what the family consumes, in the order it
unblocks the daily loop:

1. **Stable decision identity** — an id per decision, `GET /api/queue/:id`, a
   resolved/expired representation, and enough naming in the DTO to render a row
   without an N+1 fan-out.
2. **Candidate diff read model** — what `evidence.diffAvailable: false` stands in
   for today.
3. **Target 023 state transitions** — approval, rejection, reattempt,
   abandonment, pause/resume.
4. **Target 022 event feed + acknowledgement** — `GET /api/event?after=<ulid>`
   and `POST /api/project/:id/acknowledgement`.
5. **Daemon telemetry** — last ping, outcome, tasks-processed-today.
6. **Agent API**, if agents are to be managed outside the CLI. EPIC 026.4
   decision 8 also needs it to offer a task's `agent` field as anything better
   than free text.
7. **Cursor paging over the event digest** — Ulrich, 2026-07-30. The client must
   be able to page events instead of receiving one fixed head window. Both design
   questions are **settled** (Ulrich, 2026-07-30); do not re-open them at build
   time:
   - **A client cursor and the ack are separate concepts, and both survive.**
     `since` comes from the ack store and means "what the **operator** has
     acknowledged" — durable, shared by every client, advanced only by
     `ack project` / `POST /api/project/:id/acknowledgement`. A page cursor means
     "what **this tab** has already fetched" — ephemeral, per-client, and never
     written to the server. Therefore: `?after=<ulid>` pages `events`,
     `hasMore` and `pageCursor` **only**, while `totalCount` and `byType` stay
     **ack-relative aggregates**. A client paging through history must never
     change the operator's unread count, and `ack project` keeps its meaning.
     `after` must be rejected as `400 invalid_input` when it is not a ULID, and
     an `after` older than `since` is clamped to `since` — never allowed to page
     behind the acknowledgement.
   - **Paging lives in two places, split by purpose.** `overview.digest` keeps
     its fixed head window and accepts `?after=` for the common "show a bit
     more" case, because that is one extra page in a view the operator already
     has open. **Bulk history does NOT go through `overview`**: each call
     recomputes every initiative, task count, lane and decision, so walking
     history there would recompute the whole project per page. Bulk history is
     Target 022's dedicated `GET /api/event?after=<ulid>`, and the UI's
     "load more" past the first extra page must switch to that route.
8. **A non-secret credential revision** — `secretRevision` or `valueUpdatedAt`
   on the credential view, added by EPIC 026.5's debate (2026-07-31). The
   credential DTO omits `value`, so today a value-only rotation can leave the
   `ETag` unchanged: the UI cannot confirm a rotation landed and two rotations
   cannot conflict.
9. **Server-side enforcement for typed resource routes and `auth.credentialId`**
   — same debate. The `type` body probe is only a client-side defence, and
   nothing verifies that a repository's `credentialId` exists, is a credential,
   or belongs to the project.
10. **An importable package surface for the browser** — EPIC 026.6's debate
    (2026-07-31) proved the Plan screen cannot be built today. Four parts:
    a route that accepts and authoritatively validates the **real markdown
    package** (the HTTP `pkg` is already-parsed JSON, and markdown parsing,
    manifest rewriting and `--bind alias=name` resolution are CLI-only); a
    **dry run for `POST /api/project/:id/graph`**, which today creates
    immediately; **validation of request `bindings`** as project-owned resources
    of the declared type; and **task context for tasks created during apply**,
    which today receive none. Until these exist, the Plan tab renders an
    explicit unavailable state with the CLI handoff, and **EPIC 026.15 builds
    the import screen** (the family row above).

Items 1, 2, 5, 7, 8, 9 and 10 belong to the **026.8 family** above. Items 3 and 4 are Targets 023
and 022 in `.agent/plan/stories/019-http-server/retirement.md`; 026.8 either
consumes those epics or absorbs the part the UI needs — that call is made when
026.8 is authored, not before. Item 6 (agents) is deferred unless a screen
epic proves it blocking.

## Layout: two shells, no global project switcher

Scope comes from the URL. There is no mutable global "current project" — it
made project scope look global while the dominant surface (the queue) is
cross-project, and left "which project does Plan target?" unanswerable.

- **GlobalShell** — nav: `Inbox`, `Projects`, `Operations`. Header: freshness
  slot, `⌘K` `Command` palette.
- **ProjectShell** — nav: `Overview`, `Graph`, `Plan`, `Resources`,
  `Readiness`. Header: `Breadcrumb` (project › initiative › objective › task).

Mobile: the sidebar becomes a `Sheet`; the toggle carries the pending indicator.
Routing is hash-based (EPIC 026 decision 3), so deep links work in every
deployment mode.

## Templates

Six workspaces plus five shared parts. A screen that fits none of them is a
design question to raise — not a reason to add a seventh silently, and not a
reason to force the screen into the closest fit.

| id  | Template                                                                   | Shape                                                 | Used by                               |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| L1  | GlobalShell                                                                | sidebar + header + slot                               | all global surfaces                   |
| L2  | ProjectShell                                                               | sidebar + breadcrumb + slot                           | all project surfaces                  |
| W1  | CollectionWorkspace                                                        | toolbar + dense `Table`, optional detail pane         | Inbox, Projects, Resources            |
| W2  | EntityWorkspace                                                            | header + summary + `Tabs` + actions                   | initiative, objective, task, resource |
| W3  | DecisionWorkspace                                                          | evidence first, response last                         | Review, conflict resolution           |
| W4  | GraphWorkspace                                                             | canvas + inspector                                    | initiative graph                      |
| W5  | StagedWorkflow                                                             | validate → preview → apply, **full page, stable URL** | import / apply                        |
| —   | StatusChip · AsyncBoundary · FreshnessBar · CommandHandoff · DangerConfirm | shared                                                | everywhere                            |

**Initiatives are not a W1 screen** (EPIC 026.2 decision 7, 2026-07-30). The
settled ProjectShell nav has no Initiatives item, so the initiative collection
surface is the Overview's initiative cards plus the graph. The W1 "Used by"
column above is corrected accordingly.

**Project Overview is an approved composition, not a seventh template** —
Ulrich, 2026-07-30, raised as the design question this section demands, after
the 026.2 debate showed Overview fits none of W1–W5. It is a fixed composition
of existing parts inside ProjectShell: initiative summary cards (StatusChip +
the six task counts + `needsHuman`), then the decisions list, then the digest
head window. It is **not reusable**: no other screen may cite "the Overview
composition" as its template. A second screen wanting this shape re-opens the
seventh-template question.

Binding notes on the templates:

- **W1 row grammar is per-collection, not global.** A queue row (impact, age,
  kind) and a repository row (branch, publication state) are different shapes.
  Only the _toolbar, density, sort disclosure and async states_ are shared.
  **No per-type section grouping** in the Inbox — it wastes vertical space and
  hides mixed urgency.
- **W3 renders evidence before controls**, with the response inline on the
  control — no confirm modal per item, because ceremony trains mechanical
  tapping. Destructive actions (halt subtree) take `AlertDialog` weight and are
  never a visual sibling of "keep working". On success: show the resolved state
  with "Next open item" primary and "Back to inbox" secondary, and **never
  auto-navigate**. "Next" is only honest when the API can express order and
  filtering over the whole queue — until then the UI must say it is paging a
  capped window.
- **W5 has no instance until EPIC 026.8** (2026-07-31): import is the only
  staged workflow, and the API cannot support it yet — see prerequisite 10.
- **W5 is a full page, never a `Sheet`.** Import is staged and destructive
  (`deleteMissing`, `confirmDelete`, dry run). A drawer is how an operator loses
  context. Simple create/edit forms may use a `Sheet`/`Drawer`.
- **AsyncBoundary keeps states distinct**: loading, empty, transport error,
  missing (404), resolved, expired, and truncated. An empty queue is a
  successful operational state, not an error. A missing deep-linked item renders
  an explicit state and never dumps the operator back to the list.
- **CommandHandoff is a first-class component**, not an apology. This is a
  local-first, single-operator tool: `readiness.next.command` and
  `evidence.inspect` hand the UI a real CLI invocation. Render it copyable, and
  say plainly when an action must leave the browser.

## Graph rendering

**`@xyflow/react` (React Flow)** — Ulrich's call over hand-rolled SVG, for the
pan/zoom, minimap, custom nodes and edge routing. Its styling must be driven by
the token layer below, not by its own palette.

**Lane = objective, repositories as chips** in the lane header. The graph DTO
gives groups `repositories: string[]` (`views/initiative.ts:80`), so an objective
can span several repositories, and a project lane may have `repositoryId: null`.
One lane per repository would either duplicate a node across lanes or invent a
"primary" repository the API never declares.

## Semantic tokens

**Six operator roles, not one colour per enum:**
`neutral` · `active` · `attention` · `blocked` · `danger` · `success`.

Defined once as CSS custom properties in the Tailwind v4 theme block, and
consumed by `StatusChip`, graph node fills and stat cards. The domain enums map
_into_ these roles; the **label and icon** carry the domain specificity.

Mapping the axes the API actually exposes — task status
(`pending`/`running`/`completed`/`failed`/`awaiting_confirmation`/`discarded`),
initiative status, `dependencyState`, `executionState`, `blockedForever`,
readiness check status, probe status, publication state — onto a colour each
would produce a rainbow, not a system.

**Publication is a label, not a token value.** The API returns
`publication: {state, remoteOID}` (`views/resource.ts:31`). `published@<oid>` is
a presentation string built from those two fields.

A new state must be added to the token mapping file before any component may
render it, so a one-off colour cannot enter a component.

## Freshness

**Scoped, visibility-gated polling.** Today this is not a cursor feed — the
client cannot pass a cursor: `routes.ts:287` decodes only the path param, and
`get-project-overview.ts:331` takes `since` from the **server-side ack store**,
which only `ack project` advances and which has no HTTP route yet. Prerequisite 7
adds `?after=<ulid>` paging; when it lands, the change-detection rule below stays
the same and paging only replaces "re-read the same head window".

The mechanism that does work: `get-project-overview.ts:332` returns
`digest.latest`, the newest project event id, independent of the ack. ULIDs sort
by time, so a changed `latest` is a reliable change signal.

Rules:

- The open project overview and graph poll while the tab is **visible**, using
  `digest.latest` as the signal. Polling stops when the tab is hidden.
- Inbox and Control Center stay **manual refresh** until Target 022 provides an
  event route and a cross-project signal. `/api/queue` returns no `latest`, so
  detecting a queue change means re-fetching the whole queue.
- Every page shows `Updated HH:MM` (client fetch time) plus a refresh control,
  from `FreshnessBar` in the shell header.
- A successful mutation refetches the affected view.
- No websockets, no SSE, no global background polling of every project.
