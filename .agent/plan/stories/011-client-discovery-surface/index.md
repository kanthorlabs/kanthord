# EPIC 011 — Client discovery surface & project activity feed — stories

Epic: `.agent/plan/epics/011-client-discovery-surface.md`
Prereq: EPIC 010.2 (sequence order).

A client holding no ids can enumerate projects, list every resource kind
without leaking a secret, import a shipped v3 example graph package, and read
one project's activity as a server-side scoped, correctly paged event feed.

## Dispatch order

`01 → 02 → 03 → 06 → 04 → 05`

- `01` before `02`: Story 1 repairs the already-RED `architecture.test.ts`
  counters that Story 2 bumps again.
- `03` and `06` are both hard preconditions of `04`: Story 4's scoped read needs
  the `events.projectId` column, and the Proof's Phase D needs a `task.created`
  producer.
- `05` is independent of every other story; run it last (or in parallel) — it
  only adds files under `examples/`.
- `03 + 04` are a coupled pair: Story 3 writes the column, Story 4 reads it.
  Neither is Proof-visible alone.

## Stories

- 1 — `list project` use case + CLI leaf, plus the architecture-counter repair → `01-list-project.md`
- 2 — `list notification` / `list filesystem` builders in the existing resource leaf → `02-list-notification-filesystem.md`
- 3 — migration 27: nullable `events.projectId`, hierarchy backfill, adapter-side derivation at append → `03-denormalise-event-project-id.md`
- 4 — `list event --project <id>`, SQL-scoped, with `nextCursor` = last scanned row → `04-list-event-project-paging.md`
- 5 — `examples/oauth-package`, an importable `formatVersion: 3` package → `05-oauth-package-example.md`
- 6 — `create task` emits `task.created` (**derived from the Proof, not an epic bullet** — see B1) → `06-task-created-event.md`

Proof-line coverage: Phase A → Story 1 · Phase B → Story 2 · Phase C → Story 5 ·
Phase D → Stories 3 + 6 + 4.

## Facts (needed for implementation)

- **`architecture.test.ts` is RED on HEAD**, independent of this epic:
  `EXPECTED_LEAF_COUNT` is 67 (`src/apps/cli/architecture.test.ts:31`) but
  `buildProgram` exposes 68 leaves — commit `fd6f799` added the `commands` leaf
  without bumping it. `commands.ts` also has no `Example` help text, which the
  per-leaf assertion at `architecture.test.ts:117-120` requires. Both are fixed
  in Story 1, otherwise the epic's `npm run verify` gate can never go green.
  Final counters after Stories 1+2: `EXPECTED_LEAF_FILE_COUNT = 66`,
  `EXPECTED_LEAF_COUNT = 71`.
- **`task.created` has no producer.** Grep confirms it appears only in
  `src/domain/event.ts:4`, the `events.type` CHECK lists in
  `src/storage/sqlite/migrations.ts`, and tests. Story 6 adds the only producer.
- **Event ownership precedence** is `taskId → objectiveId → initiativeId →
repositoryId`, matching the CLI's existing `scopeId` fallback chain
  (`src/apps/cli/events.ts:110-114`). Story 3's backfill `COALESCE` order and
  the adapter's `if` chain both use exactly this order.
- **Join chain for the backfill**: `tasks.objectiveId → objectives.id`,
  `objectives.initiativeId → initiatives.id`, `initiatives.projectId →
projects.id`; a repository is a `resources` row with
  `type='repository'` and its own `projectId` (`migrations.ts:744-753`) —
  there is no `repositories` table. `events.repositoryId` carries **no** FK
  (`migrations.ts:789`).
- **Migration convention**: `MIGRATIONS` is a contiguous 1..n array in
  `src/storage/sqlite/migrations.ts` (last entry version 26 at `:762-796`);
  `migrate.ts:54-63` rejects gaps; `PRAGMA user_version` is bumped inside the
  migration's transaction. There is no checksum guard and no `scripts/` guard —
  the lock is `src/storage/sqlite/migrations.test.ts`, which hardcodes `26` in
  many assertions and locks each table's column list
  (events at `migrations.test.ts:156-164`). `userTables`
  (`migrations.test.ts:25-32`) filters `type='table'`, so a new index does not
  affect it.
- **`nextCursor` today** is `hasMore ? cursor : ""` (`src/apps/cli/events.ts:135`),
  produced from a `pageSize + 1` probe row (`events.ts:69,93-94`). Story 4
  changes it to plain `cursor`. `cursor` only advances when a page is non-empty
  (`events.ts:124-126`), so an empty page returns the caller's `--after`
  unchanged — which is why `scripts/e2e/drive-run.sh:79-80`
  (`[ "$next" != "$cursor" ] || return 0`) still terminates and needs no edit.
- **`EventFeed`** is at `src/events/port.ts:10-13` (not in
  `src/storage/port.ts`); its sqlite adapter is `src/events/sqlite.ts`
  (`append:12-28`, `readAfter:30-73`, default limit 100, `RangeError` on a
  non-positive limit).
- **Graph package format**: any `*.md` at any depth is read
  (`src/apps/cli/graph-md/parse.ts:10-24`); the node kind comes only from
  frontmatter `kind:`; filenames are meaningless. `--create` rejects any
  persisted `id:` (`src/app/graph/create-graph.ts:96-110`), mints fresh ULIDs,
  then **rewrites the package's `.md` files and `.kanthord-export.json` in place**
  (`src/apps/cli/import-graph.ts:461-543`). Working hand-authored reference:
  `scripts/e2e/make-todo-service-graph.sh:39-108`.
- **Task required fields at import**: non-empty single-line `title`, non-empty
  `# Instructions`, at least one `# Acceptance Criteria` item
  (`src/domain/task.ts:65-75` via `create-graph.ts:212-220`).
- **Live agent catalog** admits only `generic@1` and `fake@1`
  (`src/composition.ts:283-285`).
- **CLI conventions**: list leaves live in `src/apps/cli/commands/list/`, are
  registered by sequential `command.addCommand(...)` calls in
  `src/apps/cli/commands/list.ts:25-32` (no table), and every leaf must carry a
  non-empty `.description()` plus `.addHelpText("after", "\nExample:\n  …")`.
  `--json` output is a single `JSON.stringify(rows)` stdout element; human output
  is `` `${r.id}  ${r.name}` `` with two spaces
  (`src/apps/cli/initiative.ts:107-121`).
- **CLI test harness**: `src/apps/cli/commands/read.test.ts` uses the in-memory
  `capture()` recorder (`:8-25`), object-literal deps cast
  `as unknown as Parameters<typeof buildListCommand>[0]`, and
  `.parseAsync([...], { from: "user" })` — no sqlite, no temp dir.
  `src/events/sqlite.test.ts:19-45` is the real-sqlite temp-dir harness.

## Blockers / suggestions

- `B1 - action:YES - epic Stories list is missing the task.created producer` -
  Proof Phase D depends on `create task` emitting `task.created`
  (`scripts/e2e/client-discovery-proof.sh:70-71,96`), but no producer exists and
  no epic bullet adds one. `06-task-created-event.md` specifies the change in
  full; the epic's `## Stories` section must be amended to list it as bullet 6
  so the file/bullet mapping stays 1:1.
- `B2 - action:YES - the Proof mutates the committed example package` - Phase C
  runs `import graph examples/oauth-package --create` in place, and
  `--create` rewrites every `.md` with a minted `id:` and overwrites
  `.kanthord-export.json` (`src/apps/cli/import-graph.ts:461-543`). A first run
  passes and dirties the git tree; a second run fails with `CreateModeIdError`.
  The Proof is therefore not repeatable. Fix (owner: the human, who owns the
  proof script): copy the package into `$PD` before importing —
  `cp -R examples/oauth-package "$PD/oauth-package"` after the `test -f` /
  `formatVersion` checks at `:53-54`, then import and read `initiativeId` from
  `"$PD/oauth-package"` at `:58-60`.
- `B3 - action:YES - npm run verify is already RED on HEAD` -
  `src/apps/cli/architecture.test.ts:92` fails with `68 !== 67`. Story 1 fixes
  it as part of its counter bump, but note that no story in this epic can show
  a green gate until Story 1 lands.
- `S1 - action:NO - CreateGraph does not emit task.created` - after Story 6,
  tasks created by `create task` produce an event while tasks created by
  `import graph` do not. Consistent event coverage for graph import is a
  separate read-model/event decision and is out of this epic's Non-goals
  ("no new event types", "only makes existing events queryable").
- `S2 - action:NO - the epic's "nextCursor is the last scanned row" decision is
moot under SQL filtering` - with `WHERE projectId = ?` in SQL, the last
  matching row is already the last scanned row, so no stall is possible. The
  decision still has a load-bearing effect the epic's wording implies and the
  Proof enforces (`:123`): a non-empty terminal page must carry a cursor rather
  than `""`. Story 4 implements exactly that; no epic edit needed.
