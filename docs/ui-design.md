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

Ulrich's call — **the API prerequisites are built first**, and the UI screens
follow. Until they exist, no screen may pretend to act. The prerequisite set,
in the order it unblocks the daily loop:

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
6. **Agent API**, if agents are to be managed outside the CLI.
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

Items 1, 2, 5 and 7 have **no epic number yet** and must be inserted into
`.agent/plan/stories/019-http-server/retirement.md`, which currently reserves
022–025 for events, transitions, high-impact operations and async jobs.

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

| id  | Template                                                                   | Shape                                                 | Used by                                 |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| L1  | GlobalShell                                                                | sidebar + header + slot                               | all global surfaces                     |
| L2  | ProjectShell                                                               | sidebar + breadcrumb + slot                           | all project surfaces                    |
| W1  | CollectionWorkspace                                                        | toolbar + dense `Table`, optional detail pane         | Inbox, Projects, Resources, Initiatives |
| W2  | EntityWorkspace                                                            | header + summary + `Tabs` + actions                   | initiative, objective, task, resource   |
| W3  | DecisionWorkspace                                                          | evidence first, response last                         | Review, conflict resolution             |
| W4  | GraphWorkspace                                                             | canvas + inspector                                    | initiative graph                        |
| W5  | StagedWorkflow                                                             | validate → preview → apply, **full page, stable URL** | import / apply                          |
| —   | StatusChip · AsyncBoundary · FreshnessBar · CommandHandoff · DangerConfirm | shared                                                | everywhere                              |

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
