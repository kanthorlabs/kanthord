# CLI → HTTP retirement roadmap

Epic: `.agent/plan/epics/019-http-server.md`

Planning document, not an assertion. `src/apps/http/cli-coverage.test.ts`
(Story 08) checks only that each `cliCommands` entry names a real CLI leaf and
prints the uncovered set on demand. The target epics below are intent and may be
re-planned without touching a test.

**Retirement rule:** a CLI leaf is removed only when its HTTP route(s) exist, are
proved by their epic's Proof, and the UI uses them. 019 removes nothing.

**Path spelling:** every resource segment below is a SINGULAR noun
(`GET /api/project`, `GET /api/project/:id`) — EPIC 020 decision 1, Ulrich,
2026-07-30, which supersedes EPIC 019 decision 2. This file was written with
plural paths and is corrected throughout; `src/apps/http/routes.test.ts` carries
the machine check (a curated `PATH_SEGMENTS` allowlist plus a no-trailing-`s`
rule over that list).

## Inventory — 79 leaves today (80 with `serve`)

`serve` and `commands` are HTTP-irrelevant and never counted as uncovered.

### Target 020 — reads (the UI's first screens)

`get project`, `get initiative`, `get objective`, `get task`, `get resource`,
`get repository`, `get ai-provider`, `get graph`, `get overview`, `get conflict`,
`list project`, `list initiative`, `list objective`, `list task`,
`list resource`-family (`list credential`, `list filesystem`,
`list notification`, `list repository`), `list ai-provider`, `list model`,
`queue`.

Shape: `GET /api/<singular>` and `GET /api/<singular>/:id`. `find <kind> --name`
does not become a route — it becomes a query parameter on the collection
(`GET /api/project?name=…`), so `find project`, `find initiative`,
`find objective`, `find resource` retire with their collection.

Authored as `.agent/plan/epics/020-http-reads.md` (2026-07-30), whose route table
is the exact 22-row list; a required parent scope is a path segment
(`GET /api/project/:id/initiative`) and an optional filter is a query parameter.

Implemented: `.agent/plan/epics/020-http-reads.md`, proved by
`scripts/e2e/http-reads-proof.sh`.

### Target 021 — planning writes

`create project`, `create initiative`, `create objective`, `create task`,
`create credential`, `create filesystem`, `create notification`,
`create repository`, `rename project`, `rename initiative`, `rename objective`,
`add dependency`, `add initiative-dependency`, `add objective-dependency`,
`remove dependency`, `remove initiative-dependency`,
`remove objective-dependency`, `update credential`, `update filesystem`,
`update notification`, `update repository`, `import resource`, `import graph`,
`export initiative`, `export diagnostic`, `check graph`, `check project`.
Shape: `POST` on the collection (`201` + `Location`), `PATCH` on the item.
Dependencies are sub-resources: `POST /api/task/:id/dependency` with
`{"dependencyId":"…"}`, `DELETE /api/task/:id/dependency/:dependencyId`.
`import graph` is a `POST` with a JSON body; the interactive form stays CLI-only
until the async job API. This is the epic that adds the request-body reader's
first real consumer and the `If-Match`/`ETag` convention.

Covered. Implemented as `.agent/plan/epics/021-http-planning-writes.md`, proved
by `scripts/e2e/http-writes-proof.sh`. All 27 leaves above are claimed by the
28-row route table. Two things stay CLI-only and are NOT retired by 021:

- `check project --probe-repositories` / `--probe-provider` — the route binds
  both flags to `false` literally. Probing makes a billable model call and runs
  `git ls-remote`, so it belongs with EPIC 024's
  `POST /api/ai-provider/:id/probe`. Until then it is an operator CLI action.
- The interactive `import graph` form — the HTTP row takes an already-parsed
  JSON package; markdown-package parsing, manifest rewriting and
  `--bind alias=name` resolution stay in the CLI.

Also recorded: 021's `If-Match` is advisory against a stale editor, not a
serializable compare-and-swap (EPIC 021 decision 3). Targets 022 and 023 inherit
that convention as-is, with the same limit.

### Target 022 — the event feed

`list event`, `ack project`.
Shape: `GET /api/event?after=<ulid>` and
`POST /api/project/:id/acknowledgement`. Pull-based per AGENTS.md; no SSE.
(AGENTS.md sketches the feed as `GET /events?after=…`; that wording predates the
singular decision. 022 confirms the final path.)

Both rows answer `200`, so 021's `201`/`Location` and `If-Match` rules do not
apply to either — corrected 2026-07-30 by
`.agent/plan/epics/022-event-feed.md` decision 5, which supersedes this file's
earlier "it inherits 021's POST/`201`/`Location` and `If-Match` conventions".
Nothing addressable is created by an acknowledgement (the cursor is readable as
`since` on the project overview), and `AckProject` is monotonic, so a stale
submission no-ops instead of overwriting newer state — a precondition would
prevent nothing. 022 does inherit the rest of 021: singular segments, the
`PATH_SEGMENTS` allowlist, `defineRoute`, one view module per resource, the
`ETag` on every `200` json response, and the registry rule.

### Target 023 — state transitions

`approve task`, `approve objective`, `reject task`, `reject objective`,
`retry task`, `retry objective`, `abandon task`, `pause initiative`,
`resume initiative`.
Shape: `POST /api/task/:id/approval`, `…/rejection`, `…/reattempt`,
`…/abandonment`, and the same `approval` / `rejection` / `reattempt` trio on
`/api/objective/:id`. The retry noun is **`reattempt`**, not `attempt`:
`attempt` is the vocabulary of an execution attempt, which the 026 job API will
own as a real resource with a representation. Pausing is state on a **singleton
sub-resource**: `PUT | DELETE /api/initiative/:id/suspension`, both `204`, with
`paused` staying readable on `GET /api/initiative/:id`. The REST-shape test in
`src/apps/http/routes.test.ts` enforces the noun rule.

Corrected 2026-07-30 by `.agent/plan/epics/023-http-state-transitions.md`
decision 2, which supersedes this file's earlier
`PATCH /api/initiative/:id {"paused":true}` sketch: that row is 021's rename row,
and one row cannot serve rename and pause without logic inside `run`. The same
decision admits `PUT` for that one row — reversing 019's `PUT` non-goal, approved
by Ulrich after an adversarial review, and gated by a one-entry `PUT_ROWS`
allowlist in `routes.test.ts` so no other epic may add a `PUT` row without its own
reviewed entry.

Authored as `.agent/plan/epics/023-http-state-transitions.md` (2026-07-30): 9
rows for 9 leaves, `ROUTES` 54 → 63, proved by
`scripts/e2e/http-transitions-proof.sh`.

### Target 024 — ai-provider writes

`register ai-provider`, `update ai-provider`, `remove ai-provider`,
`set-default ai-provider`, `assign ai-provider`, `unassign ai-provider`,
`logout ai-provider`, `test ai-provider`.
Shape: `POST /api/ai-provider` (`201`), `PATCH /api/ai-provider/:id`,
`DELETE /api/ai-provider/:id`, `PUT /api/ai-provider/default`,
`DELETE /api/ai-provider/:id/credential`, `POST /api/project/:id/ai-provider`
for the chain (provider id in the BODY), `POST /api/ai-provider/:id/probe` and
`POST /api/ai-provider/:id/completion`. Human-gated operations keep their
`--yes`-equivalent as an explicit request field, never a default.

This is the provider half of what this file used to call "Target 024 —
high-impact operations". Authored as
`.agent/plan/epics/024-ai-provider-writes.md` (2026-07-30): 9 rows for 8 leaves,
`ROUTES` 63 → 72, stories expanded under
`.agent/plan/stories/024-ai-provider-writes/`, with
`scripts/e2e/http-provider-writes-proof.sh` written and RED until the epic runs.
Not implemented yet — the `Implemented:` line lands when Story S6 turns that
Proof green.

Two decisions worth carrying forward, because they change what a UI can do:
`test ai-provider` is covered in FULL (`POST /api/ai-provider/:id/completion`
takes the caller's prompt and returns the model's reply), and
`POST /api/ai-provider/:id/probe` claims no CLI leaf — it is a new capability the
readiness screen needs, and it plus `…/completion` are the only two routes in the
whole surface allowed a real outbound call.

### Target 025 — the async job API

`run daemon`, `setup project`, `login provider`, `db migrate`, `db status`.
Shape: `POST /api/job` → `202` + a job resource, `GET /api/job/:id` for
progress. These are the leaves with no request/response shape: they stream,
prompt, or run forever. `db status` may instead join 020 as a read.

### Target 026 — the UI

The Preact screens the 020–025 routes exist for: the Control Center home, the
planning editors, the provider settings screen, the verdict controls, and the
inbox that polls `GET /api/event?after=…`.

**Scope is deliberately not fixed here** (Ulrich, 2026-07-30): it is decided while
building, and anything the screens turn out to need is added then rather than
predicted now. The earlier "frontend host" sections — which pinned it first to
"only the 020–022 surfaces" and then to 020–024 — are cut, because that constraint
was a guess about a slice nobody had started.

Claims no CLI leaf of its own.

### Not yet assigned to a target

`land repository`, `publish repository`. Previously planned as "Target 027 —
delivery" (`POST /api/repository/:id/landing`, `POST /api/repository/:id/publication`,
human-gated, fast-forward-only per AGENTS.md's delivery contract). That target is
cut; the two leaves stay uncovered and unplanned until someone picks them up.

### Why the numbering changed (2026-07-30, Ulrich)

AGENTS.md binds dependency order to numeric order ("epic N always depends on
epic N-1"), so the roadmap is listed in the order it can be built.

- **024 (provider writes) before 025 (the daemon epic).** An empty resolved
  provider chain fails every task without attempting it —
  `src/app/task/run-next-task.ts:289-295` fails it with `no_provider_available`
  — and `ai_provider` is a config check
  (`src/app/project/project-readiness.ts:45-50`). Provider setup must exist
  before the daemon can be driven over HTTP.
- **026 (the UI) after 025**, so the screens can use everything 020–025 ship.

EPIC 021 decision 6 defers `check project --probe-*` and
`POST /api/ai-provider/:id/probe` to "EPIC 024"; that reference is correct as
written — the provider writes ARE 024. Of the two, only the probe ROUTE joins
024: **`check project --probe-repositories` / `--probe-provider` stay operator
CLI flags** and are NOT exposed over HTTP, because `GET
/api/project/:id/readiness` (021) must stay a pure read over stored state.
A UI that wants a live provider check calls `POST /api/ai-provider/:id/probe`
instead.

**Numbering history, so a superseded state is not reintroduced.** This file once
had 024/025 as frontend/provider-writes (swapped — the 024 epic file was right),
and the serve-hosted daemon epic briefly sat at 026. Final: 024 provider writes,
025 serve-hosted daemon, 026 the UI. "Target 027 — delivery" is cut; its two
leaves moved to "Not yet assigned to a target".

**The retirement plan is on hold.** No CLI leaf is removed until Ulrich revisits
this file after the UI and integration are done. Targets 020–025 record which
routes exist; they do not authorise a removal.

### Never retired (operator-only, stays CLI)

`serve` (it IS the server), `commands` (a CLI help table).

## Deliberately unresolved here

- Whether `login provider`'s OAuth device flow can run behind the API at all, or
  stays a terminal-only operation. Decide in 025 with the flow in hand.
- Whether the UI needs `export diagnostic` at all, or whether a support bundle
  download replaces it.
