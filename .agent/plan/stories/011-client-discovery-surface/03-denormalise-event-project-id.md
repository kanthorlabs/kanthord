# Story 3 — denormalise `projectId` onto `events`

Epic: `.agent/plan/epics/011-client-discovery-surface.md`

## Change

1. **A new migration** appended to `MIGRATIONS` in
   `src/storage/sqlite/migrations.ts` (the array ends at `migrations.ts:797`;
   the previous entry is version 26 at `migrations.ts:762-796`). Use
   `ALTER TABLE ADD COLUMN` — **not** an `events_new*` rebuild — because only a
   nullable column is added and no CHECK constraint changes.

   **The `name` is fixed; the `version` is NOT.** Use `name:
"011-s3-events-project-id"` exactly, and set `version` to the last existing
   version + 1 at implementation time (`validateSequence` enforces
   contiguity). EPIC 013 stories 1 and 5 also append migrations, so the number
   depends on land order — never hardcode it from this document.

   **Cross-epic hazard — read before implementing.** EPIC 013 story 5 rebuilds
   the `events` table to widen its `type` CHECK. If THIS story lands first,
   `events` has an extra `projectId` column and that rebuild must carry it over
   or this feature is silently destroyed. 013 story 5 owns the corresponding
   instruction; if it has already landed when this story runs, verify
   `projectId` survives a fresh `db migrate` from an empty database.

   ```ts
   {
     version: /* last + 1 — see above */ 27,
     name: "011-s3-events-project-id",
     up: (db) =>
       db.exec(`
   ALTER TABLE events ADD COLUMN projectId TEXT;
   UPDATE events SET projectId = COALESCE(
     (SELECT i.projectId FROM tasks t
        JOIN objectives o ON t.objectiveId = o.id
        JOIN initiatives i ON o.initiativeId = i.id
      WHERE t.id = events.taskId),
     (SELECT i2.projectId FROM objectives o2
        JOIN initiatives i2 ON o2.initiativeId = i2.id
      WHERE o2.id = events.objectiveId),
     (SELECT i3.projectId FROM initiatives i3 WHERE i3.id = events.initiativeId),
     (SELECT r.projectId FROM resources r WHERE r.id = events.repositoryId)
   );
   CREATE INDEX events_project_cursor ON events(projectId, id);
   `),
   },
   ```

   The `COALESCE` order **is** the ownership precedence:
   `taskId → objectiveId → initiativeId → repositoryId`, the same precedence the
   CLI already uses for `scopeId` (`src/apps/cli/events.ts:110-114`). A row
   whose every owner subquery yields NULL stays NULL — never guessed.
   No `disableForeignKeys` (events is not an FK parent — see the precedent
   comment at `migrations.ts:488-492`).

2. **Derive `projectId` at append time inside the adapter** —
   `src/events/sqlite.ts`. Add a private resolver and use it in `append`
   (`sqlite.ts:12-28`):

   ```ts
   #resolveProjectId(event: Event): string | null {
     const one = (sql: string, id: string): string | null => {
       const row = this.#db.prepare(sql).get(id) as
         | { projectId: string }
         | undefined;
       return row?.projectId ?? null;
     };
     if (event.taskId !== undefined)
       return one(
         "SELECT i.projectId AS projectId FROM tasks t JOIN objectives o ON t.objectiveId = o.id JOIN initiatives i ON o.initiativeId = i.id WHERE t.id = ?",
         event.taskId,
       );
     if (event.objectiveId !== undefined)
       return one(
         "SELECT i.projectId AS projectId FROM objectives o JOIN initiatives i ON o.initiativeId = i.id WHERE o.id = ?",
         event.objectiveId,
       );
     if (event.initiativeId !== undefined)
       return one(
         "SELECT projectId AS projectId FROM initiatives WHERE id = ?",
         event.initiativeId,
       );
     if (event.repositoryId !== undefined)
       return one(
         "SELECT projectId AS projectId FROM resources WHERE id = ?",
         event.repositoryId,
       );
     return null;
   }
   ```

   `append` becomes an 8-column INSERT:
   `INSERT INTO events(id, type, taskId, payload, objectiveId, initiativeId, repositoryId, projectId) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
   with `this.#resolveProjectId(event)` as the 8th bind value.

   **This is deliberately the only append path change.** All 34 `newEvent(...)`
   call sites (from `src/composition.ts:155` through
   `src/app/task/retry-task.ts:138`) and the `EventFeed` port
   (`src/events/port.ts:10-13`) stay untouched: deriving inside the single
   `append` implementation makes it impossible for a call site to forget, and
   the derivation still happens at append time from the owner the event already
   carries.

3. **Do not add `projectId` to the domain `Event` type**
   (`src/domain/event.ts:35-43`), to `newEvent`, or to the `SELECT` list in
   `readAfter` (`src/events/sqlite.ts:39`). The column is storage-internal
   filtering state; adding it to read results would change every existing
   `{events:[…]}` JSON assertion for no gain.

4. **Update the schema-lock tests** in
   `src/storage/sqlite/migrations.test.ts`:
   - every expected `user_version` of `26` becomes `27` (the test title at
     `migrations.test.ts:70` and every `assert.equal(userVersion(db), 26)`);
   - the events column list at `migrations.test.ts:156-164` gains
     `"projectId"` as the **last** entry (ALTER TABLE appends);
   - `userTables(db)` (`migrations.test.ts:73-96`) is **unchanged** — it filters
     `type='table'` (`migrations.test.ts:28`), so the new index does not appear.

## Constraints

- Nullable column, no `REFERENCES projects(id)`: `events.repositoryId` already
  carries no FK (`migrations.ts:789`), and a NULL-able backfill must not fail on
  unresolvable rows.
- Migration versions must stay contiguous 1..27
  (`src/storage/sqlite/migrate.ts:54-63`).
- `src/storage/sqlite/sqlite-task-repository.ts:475`
  (`DELETE FROM events WHERE taskId = ?`) is unchanged.
- The scoped **read** is Story 4's work. This story only writes the column.

## Verify

- `node --test src/events/sqlite.test.ts` — new cases on the existing real-sqlite
  temp-dir harness (`sqlite.test.ts:19-45`, which already inserts the full
  project → initiative → objective → task chain). Each asserts the stored column
  by raw SQL (`SELECT projectId FROM events WHERE id = ?`):
  - `append(newEvent("task.started", { taskId }))` → stored `projectId` equals
    the chain's project id;
  - `append(newEvent("objective.integrated", { objectiveId }))` → the same
    project id;
  - `append(newEvent("initiative.landed", { initiativeId }))` → the same
    project id;
  - `append(newEvent("repository.published", { repositoryId }))` where the
    repository is a `resources` row of `type='repository'` in that project →
    the same project id;
  - **precedence**: an event carrying both `taskId` (project A) and
    `initiativeId` of an initiative in project B resolves to **project A**;
  - **unresolvable**: `append(newEvent("repository.published", { repositoryId: "no-such-resource" }))`
    → stored `projectId` is `null` (and `append` does not throw);
  - `readAfter("0")` results are byte-identical in shape to before — the
    returned objects must **not** contain a `projectId` key.
- `node --test src/storage/sqlite/migrations.test.ts` — updated locks pass, plus
  two new cases:
  - **backfill**: `migrate(db, MIGRATIONS.slice(0, 26))` (the pre-27 state — the
    slice convention at `migrations.test.ts:1795`), raw-insert the chain plus
    four events (one per owner kind) and one event with an unknown
    `repositoryId`, then `migrate(db, MIGRATIONS)`; assert the four resolve to
    the correct project id and the fifth is `null`;
  - **index exists**: `SELECT name FROM sqlite_master WHERE type='index' AND name='events_project_cursor'`
    returns one row.
- `npm run verify` exits 0 (includes `node src/main.ts db status`, which must
  report `schema: 27`).
- Proof: none directly — this story is the precondition for Phase **D**.
