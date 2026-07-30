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
Shape: `POST /api/task/:id/approval`, `…/rejection`, `…/retry` → a noun
(`…/retry` is a verb; use `POST /api/task/:id/reattempt` or
`/api/task/:id/attempt`), `POST /api/task/:id/abandonment`. Pausing is state:
`PATCH /api/initiative/:id {"paused":true}`. The REST-shape test in
`src/apps/http/routes.test.ts` enforces the noun rule.

### Target 024 — the frontend host

No CLI leaf. The Preact screens the 020/021/022 routes exist for: the Control
Center home, the planning editors, and the inbox that polls
`GET /api/event?after=…`.

This slice consumes **only** the 020–022 surfaces — reads, planning writes, the
feed. It needs no provider write and no job API, which is what lets it sit
before 025 and 026. Stated so a later session cannot grow the frontend a
dependency on an epic that has not run yet.

### Target 025 — ai-provider writes

`register ai-provider`, `update ai-provider`, `remove ai-provider`,
`set-default ai-provider`, `assign ai-provider`, `unassign ai-provider`,
`logout ai-provider`, `test ai-provider`.
Shape: `POST /api/ai-provider` (`201`), `PATCH /api/ai-provider/:id`,
`DELETE /api/ai-provider/:id`, `POST /api/project/:id/ai-provider` for the
chain, `POST /api/ai-provider/:id/probe`. Human-gated operations keep their
`--yes`-equivalent as an explicit request field, never a default.

This is the provider half of what this file used to call "Target 024 —
high-impact operations" (renumbered 2026-07-30, Ulrich; see the note below).

### Target 026 — the async job API

`run daemon`, `setup project`, `login provider`, `db migrate`, `db status`.
Shape: `POST /api/job` → `202` + a job resource, `GET /api/job/:id` for
progress. These are the leaves with no request/response shape: they stream,
prompt, or run forever. `db status` may instead join 020 as a read.

### Target 027 — delivery

`land repository`, `publish repository`.
Shape: `POST /api/repository/:id/landing`, `POST /api/repository/:id/publication`.
Human-gated, so the `--yes` equivalent is an explicit request field, never a
default; `publish` stays fast-forward-only and never force-pushes (AGENTS.md,
delivery contract).

This is the delivery half of the old "Target 024".

### Why the numbering changed (2026-07-30, Ulrich)

AGENTS.md binds dependency order to numeric order ("epic N always depends on
epic N-1"), so the roadmap must be listed in the order it can be built:

- **025 (provider writes) before 026 (the daemon job API).** An empty resolved
  provider chain fails every task without attempting it —
  `src/app/task/run-next-task.ts:289-295` fails it with `no_provider_available`
  — and `ai_provider` is a config check
  (`src/app/project/project-readiness.ts:45-50`). Provider setup must exist
  before the daemon can be driven over HTTP.
- **024 (frontend) before both.** It uses only the 020–022 surfaces, so it
  depends on nothing in 025 or 026.
- **027 (delivery) after 026.** `land` and `publish` need a landed candidate,
  which only a daemon run produces. Delivery therefore depends on the job API,
  not the reverse.

EPIC 021 decision 6 defers `check project --probe-*` and
`POST /api/ai-provider/:id/probe` to "EPIC 024"; that reference now reads
**025**.

### Never retired (operator-only, stays CLI)

`serve` (it IS the server), `commands` (a CLI help table).

## Deliberately unresolved here

- Whether `login provider`'s OAuth device flow can run behind the API at all, or
  stays a terminal-only operation. Decide in 026 with the flow in hand.
- Whether the UI needs `export diagnostic` at all, or whether a support bundle
  download replaces it.
