# EPIC 026.8 — decision occurrences: stable identity, real names, an addressable Inbox — stories

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Prereq: EPIC 026.7 (sequence order) — its Inbox page and testids are what Story
7 extends.

A decision becomes a persisted occurrence with an opaque id, a machine kind and
an open/resolved/expired lifecycle; the queue DTO carries the entity names it
already reads; `GET /api/queue/:id` and `#/inbox/:decisionId` address one
decision; `kind` and `project` filter on the server before ranking and limiting.

## Dispatch order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

- **1 + 2 + 3 are a coupled run**: the domain rule, its table, and the projection
  that writes it. Nothing observable changes until 3 lands.
- **5 and 6 are independent of each other** and may run in either order after 4.
- **7 needs 026.7 implemented** in the same tree.
- **8 is the gate**: it changes no production code of its own.

## Stories

- 1 — the occurrence domain: identity keyed by subject, reconcile plan, close
  classification → `01-occurrence-domain.md`
- 2 — migration 32 `decision_occurrences` + repository → `02-occurrence-persistence.md`
- 3 — `DecisionProjection` + `ReconcileDecisions`: the item set moves into a
  shared collaborator and every read reconciles occurrences → `03-projection-writes-occurrences.md`
- 4 — the queue DTO gains `id`, `kind`, `state` and the real names → `04-queue-dto-names.md`
- 5 — `GET /api/queue/:id` with three states and `404` → `05-decision-detail-route.md`
- 6 — server-side `kind` / `project` filters, global counts → `06-server-side-filters.md`
- 7 — Inbox titles, kind filter, `#/inbox/:decisionId`, honest "Next" → `07-inbox-wiring.md`
- 8 — `scripts/e2e/ui-decision-identity-proof.sh` prints `026.8 ok:` → `08-proof.md`

## Facts (needed for implementation)

- The queue is a projection with no table: `GetDecisionQueue.execute`
  (`src/app/project/get-decision-queue.ts:225`) recomputes per call;
  `DEFAULT_LIMIT = 50` (`:94`); items concatenated `:358-361`, ranked `:362`,
  counted `:364-370`, sliced `:372-375`.
- The names are already read and then discarded: task title `:278`, objective
  name `:309`, initiative name `:263`, project name `:335`.
- `projectDecisions` / `rankDecisions` / `DecisionItem` live in
  `src/domain/decision-queue.ts:145-249` / `:252-269` / `:79-97`. Sort:
  `downstream` desc, `actionableSince` asc (null last), then
  `taskId ?? objectiveId ?? initiativeId`.
- `actionableSince` is null exactly when the element has no actionable event
  (`decision-queue.ts:124-126`) — those decisions are minted on first sight.
- `decisionKindLabel` (`src/domain/actionability.ts:389-420`) produces the five
  strings the machine `kind` reuses; its header (`:378-380`) says it is
  display-only, so identity and filtering read `kind`, never `kindLabel`.
- Migration head is **31** (`src/storage/sqlite/migrations.ts:916-917`); the
  runner requires contiguous `1..n` (`migrate.ts:54-63`), so the new one is
  **32**. `migrations.test.ts` pins the head version, the alphabetical table
  list, the locked DDL, the last-migration identity (`:2180-2192`) and the
  upgrade path (`:2212-2258`).
- Migrations never import `src/domain/` (`migrations.ts:11-60`), so the backfill
  of open decisions is a post-migration step inside `db migrate`
  (`src/apps/cli/db.ts:24-51`), not SQL.
- Identity uses the opening event id as a generation marker: without it a retry
  followed by a second failure, with no queue read in between, would let a stale
  id address a new decision.
- The lifecycle is reconciled by `ReconcileDecisions` (Story 3) inside one
  `BEGIN IMMEDIATE` transaction. Both `GetDecisionQueue` and `GetDecision` inject
  it together with `DecisionProjection`, which owns the item computation moved out
  of `get-decision-queue.ts:233-361`. Neither use case calls the other, and the
  detail read reconciles too — otherwise it would report `open` forever.
- Adapter conventions: `src/storage/sqlite/publication.ts` (prepare per call);
  `daemon-heartbeat-repository.ts` prepares in the constructor and therefore had
  to be built lazily (`composition.ts:685-690`) — the new adapter prepares per
  call and is built eagerly beside `composition.ts:252`.
- `newId()` is `src/domain/entity.ts` (monotonic ULID); use cases take it
  injected (`composition.ts:405`, `:414`). There is no Clock port.
- HTTP: `defineRoute` `src/apps/http/routes.ts:137-141`; `queue.get` `:510-523`;
  `optionalQueryInt` / `optionalQueryString` `src/apps/http/decode.ts:15-56`;
  the enum-validated query param precedent `:410-420`; `UnknownReferenceError` →
  `404 unknown_reference` (`error-registry.ts:48`). `410` does not exist anywhere
  in `src` and must not appear.
- `routes.test.ts` pins `ROUTES.length === 57` (`:316-318`) and the id inventory
  (`:335-391`); `cliCommands: []` is legal for a json row (`health.get`,
  `routes.ts:267-272`); `cli-coverage.test.ts` only checks that claimed leaves
  exist.
- HTTP tests use `node:test` + supertest against `buildHttpApp` with fake deps;
  `KEY`/`AUTH`/`REQUEST_ID` fixtures at the top of each `routes.*.test.ts`.
- UI is at 026 + 026.1 only in this tree: `ui/src/lib/api-client.ts` is the only
  `fetch` and never sets `Authorization`; `asyncStateOf`
  (`ui/src/lib/async-state.ts:29-45`) maps `404` → `missing`; `ui/src/lib/queries.ts:19-39`
  fixes the `<thing>QueryOptions` + `use<Thing>` convention; `routes.test.tsx:84-93`
  currently forbids any `/inbox/` deep link and must be rewritten by Story 7.
- `ui/src/lib/status-role.ts` is the only place a state may gain a role
  (`docs/ui-design.md:279-299`); Vitest tests mock `apiGet`, never `fetch`
  (`ui/src/pages/operations.test.tsx:12-20`).
- `scripts/e2e/ui-browser.mjs` always cold-loads (`:95-102`), supplies auth from
  the browser context (`:65-67`), records `requests[].authorization` before the
  credential is applied (`:72-82`), and exposes raw `page` for `selectOption`.
- `npm run verify` = root typecheck, `node --test`, verify:handoff, root eslint,
  ui typecheck, ui eslint, vitest, `build:ui`, `node src/main.ts db status`.
