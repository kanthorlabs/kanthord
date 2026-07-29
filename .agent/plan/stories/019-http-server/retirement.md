# CLI → HTTP retirement roadmap

Epic: `.agent/plan/epics/019-http-server.md`

Planning document, not an assertion. `src/apps/http/cli-coverage.test.ts`
(Story 08) checks only that each `cliCommands` entry names a real CLI leaf and
prints the uncovered set on demand. The target epics below are intent and may be
re-planned without touching a test.

**Retirement rule:** a CLI leaf is removed only when its HTTP route(s) exist, are
proved by their epic's Proof, and the UI uses them. 019 removes nothing.

## Inventory — 79 leaves today (80 with `serve`)

`serve` and `commands` are HTTP-irrelevant and never counted as uncovered.

### Target 020 — reads (the UI's first screens)

`get project`, `get initiative`, `get objective`, `get task`, `get resource`,
`get repository`, `get ai-provider`, `get graph`, `get overview`, `get conflict`,
`list project`, `list initiative`, `list objective`, `list task`,
`list resource`-family (`list credential`, `list filesystem`,
`list notification`, `list repository`), `list ai-provider`, `list model`,
`queue`.

Shape: `GET /api/<plural>` and `GET /api/<plural>/:id`. `find <kind> --name` does
not become a route — it becomes a query parameter on the collection
(`GET /api/projects?name=…`), so `find project`, `find initiative`,
`find objective`, `find resource` retire with their collection.

### Target 021 — the event feed

`list event`, `ack project`.
Shape: `GET /api/events?after=<ulid>` and
`POST /api/projects/:id/acknowledgement`. Pull-based per AGENTS.md; no SSE.

### Target 022 — planning writes

`create project`, `create initiative`, `create objective`, `create task`,
`create credential`, `create filesystem`, `create notification`,
`create repository`, `rename project`, `rename initiative`, `rename objective`,
`add dependency`, `add initiative-dependency`, `add objective-dependency`,
`remove dependency`, `remove initiative-dependency`,
`remove objective-dependency`, `update credential`, `update filesystem`,
`update notification`, `update repository`, `import resource`, `import graph`,
`export initiative`, `export diagnostic`, `check graph`, `check project`.
Shape: `POST` on the collection (`201` + `Location`), `PATCH` on the item.
Dependencies are sub-resources: `POST|DELETE /api/tasks/:id/dependencies/:otherId`.
`import graph` is a `POST` with a JSON body; the interactive form stays CLI-only
until the async job API. This is the epic that adds the request-body reader's
first real consumer and the `If-Match`/`ETag` convention.

### Target 023 — state transitions

`approve task`, `approve objective`, `reject task`, `reject objective`,
`retry task`, `retry objective`, `abandon task`, `pause initiative`,
`resume initiative`.
Shape: `POST /api/tasks/:id/approval`, `…/rejection`, `…/retry` → a noun
(`…/retry` is a verb; use `POST /api/tasks/:id/reattempt` or
`/api/tasks/:id/attempts`), `POST /api/tasks/:id/abandonment`. Pausing is state:
`PATCH /api/initiatives/:id {"paused":true}`. The REST-shape test in
`src/apps/http/routes.test.ts` enforces the noun rule.

### Target 024 — high-impact operations

`land repository`, `publish repository`, `remove ai-provider`,
`set-default ai-provider`, `assign ai-provider`, `unassign ai-provider`,
`register ai-provider`, `update ai-provider`, `logout ai-provider`,
`test ai-provider`.
Shape: `POST /api/repositories/:id/landing`, `…/publication`,
`POST /api/ai-providers` (`201`), `PATCH /api/ai-providers/:id`,
`DELETE /api/ai-providers/:id`, `POST /api/projects/:id/ai-providers` for the
chain, `POST /api/ai-providers/:id/probe`. Human-gated operations keep their
`--yes`-equivalent as an explicit request field, never a default.

### Target 025 — the async job API

`run daemon`, `setup project`, `login provider`, `db migrate`, `db status`.
Shape: `POST /api/jobs` → `202` + a job resource, `GET /api/jobs/:id` for
progress. These are the leaves with no request/response shape: they stream,
prompt, or run forever. `db status` may instead join 020 as a read.

### Never retired (operator-only, stays CLI)

`serve` (it IS the server), `commands` (a CLI help table).

## Deliberately unresolved here

- Whether `login provider`'s OAuth device flow can run behind the API at all, or
  stays a terminal-only operation. Decide in 025 with the flow in hand.
- Whether the UI needs `export diagnostic` at all, or whether a support bundle
  download replaces it.
