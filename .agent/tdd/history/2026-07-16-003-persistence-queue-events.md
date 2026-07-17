---
epic: .agent/plan/epics/003-persistence-queue-events.md
opened: 2026-07-16
opener: test-engineer
base-ref: 690f9c46de8660a4dc03c72070c5a1365609b722
---

# Implementation cycle — 003-persistence-queue-events

Pulled from EPIC: `.agent/plan/epics/003-persistence-queue-events.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):

> Gates: `npm run typecheck && npm test`
> Proof:
>
> ```bash
> export KANTHORD_DB="$(mktemp -d)/kanthord.db"
> node src/main.ts db migrate   # prints each applied migration. Exit 0.
> node src/main.ts db migrate   # prints "up to date". Exit 0.
> node src/main.ts db status    # prints schema version, journal_mode=wal,
>                               # and a row count per table. Exit 0.
> ```

TDD protocol:

1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate and appends IMPLEMENTATION_READY_FOR_REVIEW.

## TEST-ENGINEER — Story 001 · Task T1: openDatabase helper

**Cycle.** RED for Task `S001-T1` (`src/storage/sqlite/open.test.ts`).

**Test written.**

- file: `src/storage/sqlite/open.test.ts` (new) — suite: `open` — methods: `creates missing parent directory`, `journal_mode is wal`, `foreign_keys is on (1)`, `busy_timeout is 5000`, `second open of same file succeeds and still reports wal`
- asserts: `openDatabase(path)` creates the parent directory if missing, returns a `DatabaseSync` with `journal_mode=wal`, `foreign_keys=1`, `busy_timeout=5000`, and a second open of the same file also reports `wal`.

**RED proof.**

- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/open.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/open.test.ts`

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/open.ts` must export `openDatabase(path: string): DatabaseSync`. The Story's locked decisions (T1 spec) describe the contract: create parent directory, open `DatabaseSync`, set `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 001 · Task T1: openDatabase helper

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/open.test.ts`.

**Files changed.**

- `src/storage/sqlite/open.ts` (new) — exports `openDatabase(path: string): DatabaseSync`

**Seam (GREEN).** `openDatabase` calls `mkdirSync(dirname(path), { recursive: true })` to create missing parents, constructs a `DatabaseSync`, then sets `journal_mode=WAL`, `foreign_keys=ON`, and `busy_timeout=5000` via `db.exec("PRAGMA ...")` before returning.

**Refactor.** None specified.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 001 · Confirm S001-T1 GREEN + Task S001-T2: migration report

**Cycle.** Confirmed GREEN for Task `S001-T1`; RED for Task `S001-T2` (`src/storage/sqlite/migrate.test.ts`).

**S001-T1 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 87 tests, 0 fail (before S001-T2 edits)
- Note: the pragma helper had a bug — `PRAGMA busy_timeout` returns column `timeout`, not `busy_timeout`; fixed the helper to return `Object.values(row)[0]` so it works for all pragmas.

**Test written.**

- file: `src/storage/sqlite/migrate.test.ts` (edited) — suite: `migrate` — methods: `applies pending migrations in order and returns the final version`, `skips already-applied migrations on re-run (idempotent)` (both updated to the new `MigrationReport` return shape)
- asserts: `migrate(db, migrations)` returns `{ version: number, applied: Array<{ version: number, name: string }> }`; re-run returns `{ version, applied: [] }`; existing behavior tests remain in place.

**RED proof.**

- command: `npm test`
- exit: 1 — failure: `AssertionError: undefined !== 2` (at `migrate.test.ts:26`) — `result.version` is `undefined` because `migrate` still returns a bare `number`; `MigrationReport` type import also causes typecheck error `TS2305: Module '"./migrate.ts"' has no exported member 'MigrationReport'`.

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/migrate.ts` — change `migrate` return type from `number` to `MigrationReport` (export `MigrationReport = { version: number; applied: Array<{ version: number; name: string }> }`); collect applied entries during the loop and return `{ version: current, applied }`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 001 · Task S001-T2: migration report

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/migrate.test.ts`.

**Files changed.**

- `src/storage/sqlite/migrate.ts` (edited) — added `MigrationReport` export; changed `migrate` return type from `number` to `MigrationReport`; collects `applied` entries during the loop.

**Seam (GREEN).** Added `export interface MigrationReport { version: number; applied: Array<{ version: number; name: string }> }` and updated `migrate` to accumulate `applied` entries per migration run, returning `{ version: current, applied }` instead of the bare `number`.

**Refactor.** None specified; the change is already minimal.

**Build check.**

- typecheck: exit 0

**Assumptions.**

- VERIFIED: `sqlite-status-store.ts` discards the `migrate` return value — no callers need updating.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 001 · Confirm S001-T2 GREEN + Task S001-T3: db use cases + ports

**Cycle.** Confirmed GREEN for Task `S001-T2`; RED for Task `S001-T3` (`src/app/db/migrate-db.test.ts`, `src/app/db/get-db-status.test.ts`).

**S001-T2 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 87 tests, 0 fail (before S001-T3 edits)

**Tests written.**

- file: `src/app/db/migrate-db.test.ts` (new) — suite: implied — methods: `MigrateDb.execute() returns the MigrationReport from the Migrator`, `MigrateDb.execute() returns applied:[] when nothing to apply`
  - asserts: `MigrateDb(migrator).execute()` returns the exact `MigrationReport` produced by the injected `Migrator`.
- file: `src/app/db/get-db-status.test.ts` (new) — suite: implied — methods: `GetDbStatus.execute() returns dbPath, schemaVersion, journalMode, and tables from the store`, `GetDbStatus.execute() returns tables:[] on an unmigrated store`
  - asserts: `GetDbStatus(store).execute()` returns `{ dbPath, schemaVersion, journalMode, tables }` delegated from the injected `StatusStore`.

**RED proof.**

- command: `npm test`
- exit: 1 — failures:
  - `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/db/migrate-db.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/db/migrate-db.test.ts`
  - `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/db/get-db-status.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/db/get-db-status.test.ts`
- 89 tests, 2 fail.

**Open to Software Engineer.**

- Seam 1: `src/storage/port.ts` — add `Migrator { migrate(): MigrationReport }` (importing `MigrationReport` from `../storage/sqlite/migrate.ts`); rework `StatusStore` to replace `taskCount()` with `tables(): Array<{ name: string; rows: number }>`.
- Seam 2: `src/app/db/migrate-db.ts` — export class `MigrateDb` with constructor taking a `Migrator` and `execute(): Promise<MigrationReport>`.
- Seam 3: `src/app/db/get-db-status.ts` — export class `GetDbStatus` with constructor taking a `StatusStore` and `execute(): Promise<{ dbPath: string; schemaVersion: number; journalMode: string; tables: Array<{ name: string; rows: number }> }>`.
- Note: `src/app/status/get-status.ts` and its test are removed per the Task spec (replaced by the new pair).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 001 · Task S001-T3: db use cases + ports

**Cycle.** GREEN+REFACTOR for `src/app/db/migrate-db.test.ts` and `src/app/db/get-db-status.test.ts`.

**Files changed.**

- `src/storage/port.ts` (edited) — defines `MigrationReport`, adds `Migrator { migrate(): MigrationReport }`, replaces `taskCount()` with `tables(): Array<{ name, rows }>` on `StatusStore`
- `src/storage/sqlite/migrate.ts` (edited) — imports `MigrationReport` from `../port.ts`; re-exports it for backward-compat (test imports from `./migrate.ts` continue to work)
- `src/storage/sqlite/sqlite-status-store.ts` (edited) — adds stub `tables(): []` so `SqliteStatusStore` satisfies the updated `StatusStore` interface (T4 replaces with real query)
- `src/app/db/migrate-db.ts` (new) — exports `MigrateDb`; constructor takes `Migrator`; `execute()` delegates to `migrator.migrate()`
- `src/app/db/get-db-status.ts` (new) — exports `GetDbStatus` and `DbStatus`; constructor takes `StatusStore`; `execute()` maps `path`, `schemaVersion()`, `journalMode()`, `tables()` into `DbStatus`
- `src/app/status/get-status.ts` (deleted) — replaced by the new use-case pair per Task spec
- `src/app/status/get-status.test.ts` (deleted) — per Task spec
- `src/apps/cli/index.ts` (edited) — removed `GetStatus` import and `status` command (AC: "status is removed from the command table")
- `src/main.ts` (edited) — removed `GetStatus` construction; passes `{}` to `buildProgram`

**Seam (GREEN).** `MigrateDb` and `GetDbStatus` each delegate to their injected port (`Migrator` / `StatusStore`) and return the result as an async Promise; `FakeMigrator` and `FakeStatusStore` in the tests satisfy the updated `StatusStore` interface which now has `tables()` instead of `taskCount()`.

**Refactor.** None specified; all changes are minimal and directly satisfy the failing assertion.

**Build check.**

- typecheck: exit 0

**Assumptions.**

- VERIFIED: `sqlite-status-store.test.ts` references `store.taskCount()` on the concrete class (not through the interface), so keeping `taskCount()` on `SqliteStatusStore` while removing it from the `StatusStore` interface leaves those tests intact.
- VERIFIED: `MigrationReport` moved to `port.ts` and re-exported from `migrate.ts` satisfies the import in `migrate-db.test.ts` which imports from `../../storage/sqlite/migrate.ts`.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 001 · Confirm S001-T3 GREEN + Task S001-T4: sqlite adapters

**Cycle.** Confirmed GREEN for Task `S001-T3`; RED for Task `S001-T4` (`src/storage/sqlite/sqlite-migrator.test.ts`, `src/storage/sqlite/sqlite-status-store.test.ts`).

**S001-T3 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 90 tests, 0 fail (before S001-T4 edits)

**Tests written.**

- file: `src/storage/sqlite/sqlite-migrator.test.ts` (new) — suite: implied — methods: `SqliteMigrator.migrate() applies toy migrations and returns the report`, `SqliteMigrator.migrate() re-run returns applied:[]`
  - asserts: `SqliteMigrator(db, migrations).migrate()` returns `{ version: 2, applied: [{version:1,…},{version:2,…}] }`; re-run returns `{ version: 2, applied: [] }`.
- file: `src/storage/sqlite/sqlite-status-store.test.ts` (edited) — methods: `SqliteStatusStore schemaVersion() is 0 on a fresh DB`, `SqliteStatusStore journalMode() is wal`, `SqliteStatusStore tables() lists user tables with row count, alphabetical`, `SqliteStatusStore tables() returns [] on unmigrated DB`, `close() releases the handle`
  - asserts: constructor is now `SqliteStatusStore(db: DatabaseSync, path: string)` (no migrate-on-open); `schemaVersion() === 0` on fresh DB; `journalMode() === 'wal'`; after applying toy migrations with `SqliteMigrator`, `tables()` returns `[{name:'alpha',rows:1},{name:'beta',rows:0}]` (alphabetical, with correct counts).

**RED proof.**

- command: `npm test`
- exit: 1 — failures: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../sqlite-migrator.ts'` (both test files fail because `sqlite-migrator.ts` does not exist yet); 89 tests, 2 fail.

**Open to Software Engineer.**

- Seam 1: `src/storage/sqlite/sqlite-migrator.ts` — export class `SqliteMigrator` with constructor `(db: DatabaseSync, migrations: readonly Migration[])` implementing `Migrator`; `migrate()` delegates to the existing `migrate(db, migrations)` function from `./migrate.ts`.
- Seam 2: `src/storage/sqlite/sqlite-status-store.ts` — rework constructor to `(db: DatabaseSync, path: string)` — accepts an already-open handle, no migrate-on-open; drop `taskCount()`; implement `tables()` by querying `sqlite_master` (`type='table'`, name not like `sqlite_%`) `ORDER BY name`, counting rows per table; `close()` closes the injected `db`.
- Note: the `Migrator` interface is already in `src/storage/port.ts`; `SqliteMigrator` must implement it.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 001 · Task S001-T4: sqlite adapters

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-migrator.test.ts` and `src/storage/sqlite/sqlite-status-store.test.ts`.

**Files changed.**

- `src/storage/sqlite/sqlite-migrator.ts` (new) — exports `SqliteMigrator` implementing `Migrator`; constructor takes `(db: DatabaseSync, migrations: readonly Migration[])`; `migrate()` delegates to the existing `migrate(db, migrations)` function from `./migrate.ts`.
- `src/storage/sqlite/sqlite-status-store.ts` (rewritten) — constructor changed to `(db: DatabaseSync, path: string)` (accepts already-open handle, no migrate-on-open); removed `taskCount()` and the internal `DatabaseSync` construction; implemented `tables()` via `sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name` with per-table `count(*)` row counts; `close()` closes the injected handle.
- `src/main.ts` (edited) — updated to use `openDatabase(dbPath)` + `new SqliteStatusStore(db, dbPath)` to match the new constructor; removed unused `MIGRATIONS` import and `mkdirSync`/`dirname` (now handled by `openDatabase` internally).

**Seam (GREEN).** `SqliteMigrator` wraps the existing pure `migrate` function as a class conforming to the `Migrator` port; `SqliteStatusStore` accepts an already-open `DatabaseSync` handle and queries `sqlite_master` for `tables()`, satisfying both the alphabetical ordering and the row-count assertions in the tests.

**Refactor.** None named in the Task spec; all changes are minimal and directly trace to the failing assertions.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 001 · Confirm S001-T4 GREEN + Task S001-T5: CLI + composition

**Cycle.** Confirmed GREEN for Task `S001-T4`; RED for Task `S001-T5` (`src/apps/cli/db.test.ts`).

**S001-T4 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 94 tests, 0 fail (before S001-T5 edits)

**Test written.**

- file: `src/apps/cli/db.test.ts` (new) — suite: implied — methods: `runDbMigrate formats one 'applied: V name' line per entry and exits 0`, `runDbMigrate prints 'up to date' when applied is empty and exits 0`, `runDbMigrate on throwing migrator outputs applied lines then error line and exits 1`, `runDbStatus formats db path, schema, journal_mode, and table rows`, `runDbStatus on unmigrated DB prints only the first three lines`
- asserts: `runDbMigrate(migrateDb)` formats `applied: V name` lines from the report or `up to date` (exit 0); a migrator throwing an error with `{ applied, failedVersion, failedName }` fields produces the already-applied stdout lines plus `error: migration V name failed: msg` on stderr (exit 1). `runDbStatus(getDbStatus)` formats `db: <path>`, `schema: <version>`, `journal_mode: <mode>`, then `<table>: <rowcount>` lines; empty tables list → first three lines only (exit 0).

**RED proof.**

- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/apps/cli/db.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/apps/cli/db.test.ts`
- 95 tests, 1 fail.

**Open to Software Engineer.**

- Seam: `src/apps/cli/db.ts` must export two functions:
  - `runDbMigrate(migrateDb: MigrateDb): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>` — calls `migrateDb.execute()`; on success formats `applied: V name` lines (or `"up to date"` when `applied` is empty); on throw checks for `{ applied, failedVersion, failedName }` on the error object and produces the applied stdout lines plus `"error: migration V name failed: <message>"` on stderr with exit 1.
  - `runDbStatus(getDbStatus: GetDbStatus): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }>` — calls `getDbStatus.execute()`; formats `db: <path>`, `schema: <version>`, `journal_mode: <mode>`, then one `<table>: <rowcount>` line per table entry.
- The Story also requires: register `db migrate` and `db status` sub-commands in `src/apps/cli/index.ts` (add `CliDeps` fields for the two use cases); wire in `src/main.ts` (open once via `openDatabase`, construct `SqliteMigrator` + `SqliteStatusStore` + `MigrateDb` + `GetDbStatus`, inject into CLI; no migration at bootstrap).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 001 · Task S001-T5: CLI + composition

**Cycle.** GREEN+REFACTOR for `src/apps/cli/db.test.ts`.

**Files changed.**

- `src/apps/cli/db.ts` (new) — exports `runDbMigrate(migrateDb: MigrateDb)` and `runDbStatus(getDbStatus: GetDbStatus)`, each returning `Promise<{ exitCode, stdout, stderr }>`. Error branch inspects the thrown object for `applied`, `failedVersion`, `failedName` fields.
- `src/apps/cli/index.ts` (edited) — added `migrateDb: MigrateDb` and `getDbStatus: GetDbStatus` to `CliDeps`; registered `db migrate` and `db status` sub-commands that call the handlers and write to `process.stdout`/`process.stderr`.
- `src/main.ts` (edited) — wires `SqliteMigrator(db, MIGRATIONS)`, `SqliteStatusStore(db, dbPath)`, `MigrateDb`, and `GetDbStatus`; injects them into `buildProgram({ migrateDb, getDbStatus })`; no migration at bootstrap.

**Seam (GREEN).** `runDbMigrate` delegates to `migrateDb.execute()`, formats `applied: V name` lines (or `up to date`) on success, catches the structured throw and produces applied stdout lines plus one stderr error line (exit 1). `runDbStatus` delegates to `getDbStatus.execute()` and emits `db:`, `schema:`, `journal_mode:` plus per-table lines.

**Refactor.** None specified; all changes are minimal and directly trace to the failing assertions.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 001 · Confirm S001-T5 GREEN + Story 002 Task S002-T1: core-schema migration

**Cycle.** Confirmed GREEN for Task `S001-T5`; RED for Task `S002-T1` (`src/storage/sqlite/migrations.test.ts`).

**S001-T5 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 99 tests, 0 fail (before S002-T1 edits)

**Test written.**

- file: `src/storage/sqlite/migrations.test.ts` (new) — suite: implied — methods: `migrates to version 2 and creates exactly the eight core tables`, `schema columns match locked DDL for all eight tables`, `foreign key constraint rejects task with unknown objectiveId`, `CHECK constraints reject invalid status and type values`, `partial unique index rejects two queued jobs for the same taskId; queued plus running coexist`, `composite primary key rejects duplicate task_dependencies row`, `re-run of MIGRATIONS returns applied empty (idempotent)`
- asserts: after `migrate(db, MIGRATIONS)` on a temp DB opened via `openDatabase`: (a) `userVersion === 2` and exactly the 8 locked tables exist; (b) `pragma table_info` for each table returns the locked column names; (c) INSERT into `tasks` with unknown `objectiveId` throws (FK); (d) bad `tasks.status`, `resources.type`, `events.type`, `jobs.status` each throw (CHECK); (e) two `queued` jobs for the same `taskId` throw; `queued` + `running` for the same `taskId` coexist; (f) duplicate `(taskId, dependency)` in `task_dependencies` throws (composite PK); (g) re-run returns `{ version: 2, applied: [] }`.

**Note on FK test (c).** `foreign key constraint rejects task with unknown objectiveId` passes on the first run because the current `tasks` table (migration 1, only `id`) has no `objectiveId` column — the INSERT throws for the wrong reason (missing column). After migration 2 drops and recreates `tasks` with FK on `objectiveId`, the INSERT will still throw — now for the correct reason (FK violation). The observable behavior (`assert.throws`) is unaffected; the test is sensitive to the right post-migration behavior and is intentionally left as-is.

**RED proof.**

- command: `npm test`
- exit: 1 — failures: 6 new tests fail; first failure: `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 1 !== 2` at `migrations.test.ts:60` (`assert.equal(userVersion(db), 2)` — migration 2 does not exist yet so `userVersion` returns 1 from the only applied migration).
- 106 tests, 6 fail.

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/migrations.ts` — append migration `{ version: 2, name: 'core-schema', up: (db) => db.exec(<locked DDL>) }` to `MIGRATIONS`. The locked DDL is reproduced verbatim in the Story 002 file (`.agent/plan/stories/003-persistence-queue-events/002-schema.md`). No other files need to change.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 002 · Task S002-T1: core-schema migration

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/migrations.test.ts`.

**Files changed.**

- `src/storage/sqlite/migrations.ts` (edited) — appended migration `{ version: 2, name: 'core-schema' }` with the locked DDL verbatim from Story 002.

**Seam (GREEN).** `MIGRATIONS[1]` executes `DROP TABLE tasks` then creates the eight locked tables (`projects`, `resources`, `initiatives`, `objectives`, `tasks`, `task_dependencies`, `jobs`, `events`) with their FK constraints, CHECK constraints, and the partial unique index `jobs_queued_taskId`. The `user_version` guard in `migrate.ts` makes re-runs return `applied: []`.

**Refactor.** None specified; the Task spec says none.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 002 · Confirm S002-T1 GREEN + Story 003 Task S003-T1: ProjectRepository

**Cycle.** Confirmed GREEN for Task `S002-T1`; RED for Task `S003-T1` (`src/storage/sqlite/sqlite-project-repository.test.ts`).

**S002-T1 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 106 tests, 0 fail (before S003-T1 edits)

**Test written.**

- file: `src/storage/sqlite/sqlite-project-repository.test.ts` (new) — suite: implied — methods: `SqliteProjectRepository save then get round-trips the project`, `SqliteProjectRepository get returns undefined for unknown id`, `SqliteProjectRepository duplicate save throws`, `SqliteProjectRepository addResource + listResources round-trips repository variant`, `SqliteProjectRepository addResource + listResources round-trips credential variant`, `SqliteProjectRepository addResource + listResources round-trips notification variant`, `SqliteProjectRepository addResource + listResources round-trips ai_provider variant`, `SqliteProjectRepository addResource + listResources round-trips filesystem variant`, `SqliteProjectRepository addResource with unknown projectId throws`
- asserts: `SqliteProjectRepository(db)` satisfies the `ProjectRepository` port: `save`+`get` deep-equals the project; `get` unknown id returns `undefined`; duplicate `save` throws; `addResource`+`listResources` round-trips each resource union variant with all vendor fields intact; `addResource` with an unknown `projectId` throws (FK violation).

**RED proof.**

- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/sqlite-project-repository.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/sqlite-project-repository.test.ts`
- 107 tests, 1 fail.

**Open to Software Engineer.**

- Seam 1: `src/storage/port.ts` — add `ProjectRepository { save(project: Project): void; get(id: string): Project | undefined; addResource(projectId: string, resource: Resource): void; listResources(projectId: string): Resource[] }`. Import `Project` and `Resource` from `../domain/project.ts` and `../domain/resource.ts` using `import type`.
- Seam 2: `src/storage/sqlite/sqlite-project-repository.ts` — export class `SqliteProjectRepository` with constructor `(db: DatabaseSync)` implementing `ProjectRepository`. `save` inserts a row into `projects`; `get` selects by id (returns `undefined` when absent); `addResource` inserts into `resources` with vendor fields serialized as JSON into the `attributes` column (rehydrate by `type` on read); `listResources` selects all resources for the project and rehydrates each row back to its discriminated union variant.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 003 · Task S003-T1: ProjectRepository

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-project-repository.test.ts`.

**Files changed.**

- `src/storage/port.ts` (edited) — added `import type { Project }` and `import type { Resource }` from domain; appended `ProjectRepository { save, get, addResource, listResources }` interface.
- `src/storage/sqlite/sqlite-project-repository.ts` (new) — exports `SqliteProjectRepository` implementing `ProjectRepository`; `save` inserts into `projects`; `get` selects by id (returns `undefined` when absent); `addResource` destructures the resource into `{ id, type, name }` columns + JSON-serialised remaining vendor fields in `attributes`; `listResources` selects all rows for the project and spreads `JSON.parse(attributes)` back onto `{ id, type, name }`.

**Seam (GREEN).** The discriminated union is round-tripped by storing `{ id, type, name }` as named columns and the remaining type-specific fields as a JSON `attributes` blob; on read, `{ id, type, name, ...JSON.parse(attributes) }` reconstructs the original shape for every variant. `undefined` fields (e.g. `AIProvider.baseUrl`) are absent from JSON so they are absent on read, matching `deepEqual` semantics.

**Refactor.** None specified in the Task spec.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 003 · Confirm S003-T1 GREEN + Task S003-T2: InitiativeRepository

**Cycle.** Confirmed GREEN for Task `S003-T1`; RED for Task `S003-T2` (`src/storage/sqlite/sqlite-initiative-repository.test.ts`).

**S003-T1 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 115 tests, 0 fail (before S003-T2 edits)

**Test written.**

- file: `src/storage/sqlite/sqlite-initiative-repository.test.ts` (new) — suite: implied — methods: `SqliteInitiativeRepository save then get round-trips the initiative`, `SqliteInitiativeRepository get returns undefined for unknown id`, `SqliteInitiativeRepository duplicate save throws`, `SqliteInitiativeRepository saveObjective + listObjectives round-trips in id order`, `SqliteInitiativeRepository listObjectives returns [] for unknown initiativeId`, `SqliteInitiativeRepository save with unknown projectId throws (FK)`, `SqliteInitiativeRepository saveObjective with unknown initiativeId throws (FK)`
- asserts: `SqliteInitiativeRepository(db)` satisfies the `InitiativeRepository` port: `save`+`get` deep-equals the initiative; `get` unknown id returns `undefined`; duplicate `save` throws; `saveObjective`+`listObjectives` round-trips two objectives with results ordered by id ascending; `listObjectives` for unknown initiativeId returns `[]`; `save` with unknown `projectId` throws (FK); `saveObjective` with unknown `initiativeId` throws (FK).

**RED proof.**

- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/sqlite-initiative-repository.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/sqlite-initiative-repository.test.ts`
- 116 tests, 1 fail.

**Open to Software Engineer.**

- Seam 1: `src/storage/port.ts` — add `InitiativeRepository { save(initiative: Initiative): void; get(id: string): Initiative | undefined; saveObjective(objective: Objective): void; listObjectives(initiativeId: string): Objective[] }` (import `Initiative`, `Objective` from `../domain/initiative.ts` using `import type`).
- Seam 2: `src/storage/sqlite/sqlite-initiative-repository.ts` — export class `SqliteInitiativeRepository` with constructor `(db: DatabaseSync)` implementing `InitiativeRepository`; `save` inserts into `initiatives`; `get` selects by id (returns `undefined` when absent); `saveObjective` inserts into `objectives`; `listObjectives` selects all objectives for the given `initiativeId` ordered by `id ASC`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 003 · Task S003-T2: InitiativeRepository

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-initiative-repository.test.ts`.

**Files changed.**

- `src/storage/port.ts` (edited) — added `import type { Initiative, Objective }` from domain; appended `InitiativeRepository { save, get, saveObjective, listObjectives }` interface.
- `src/storage/sqlite/sqlite-initiative-repository.ts` (new) — exports `SqliteInitiativeRepository` implementing `InitiativeRepository`; `save` inserts into `initiatives`; `get` selects by id (returns `undefined` when absent); `saveObjective` inserts into `objectives`; `listObjectives` selects all objectives for the given `initiativeId` ordered by `id ASC`.

**Seam (GREEN).** `SqliteInitiativeRepository` follows the same shape as `SqliteProjectRepository` — named columns only (no JSON blob needed since `Initiative` and `Objective` have no vendor-specific variant fields); `listObjectives` sorts by `id ASC` to satisfy the lexicographic ordering assertion.

**Refactor.** None specified in the Task spec.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 003 · Confirm S003-T2 GREEN + Task S003-T3: TaskRepository

**Cycle.** Confirmed GREEN for Task `S003-T2`; RED for Task `S003-T3` (`src/storage/sqlite/sqlite-task-repository.test.ts`).

**S003-T2 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 122 tests, 0 fail (before S003-T3 edits)

**Test written.**

- file: `src/storage/sqlite/sqlite-task-repository.test.ts` (new) — suite: implied — methods: `SqliteTaskRepository save then get round-trips task with two dependencies in declared order`, `SqliteTaskRepository get returns undefined for unknown id`, `SqliteTaskRepository save is transactional — dependency on missing task throws and leaves no tasks row`, `SqliteTaskRepository saveAll succeeds when second task depends on first regardless of array order`, `SqliteTaskRepository saveAll with a duplicate id persists nothing`, `SqliteTaskRepository listByInitiative returns tasks across two objectives in id order with dependencies rehydrated`, `SqliteTaskRepository listByInitiative excludes tasks from another initiative`, `SqliteTaskRepository listByInitiative returns [] for unknown initiativeId`
- asserts: `SqliteTaskRepository(db)` satisfies the `TaskRepository` port: `save`+`get` deep-equals the task with dependencies in declared position order; `get` unknown id returns `undefined`; `save` with a missing dependency throws and leaves no row; `saveAll([taskB_depOnA, taskA])` succeeds (all task rows inserted before dependencies); `saveAll` with a duplicate id rolls back the entire batch; `listByInitiative` returns all tasks for the initiative (across two objectives) ordered by `id ASC`, with dependencies rehydrated, excluding tasks from other initiatives; unknown initiative returns `[]`.

**RED proof.**

- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/sqlite-task-repository.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/storage/sqlite/sqlite-task-repository.test.ts`
- 123 tests, 1 fail.

**Open to Software Engineer.**

- Seam 1: `src/storage/port.ts` — add `TaskRepository { save(task: Task): void; saveAll(tasks: Task[]): void; get(id: string): Task | undefined; listByInitiative(initiativeId: string): Task[] }` (import `Task` from `../domain/task.ts` using `import type`).
- Seam 2: `src/storage/sqlite/sqlite-task-repository.ts` — export class `SqliteTaskRepository` with constructor `(db: DatabaseSync)` implementing `TaskRepository`. `save` inserts one task row then all dependency rows (with `position` index) in a single transaction; if any dependency id is absent the transaction rolls back leaving no `tasks` row. `saveAll` inserts all task rows first (so intra-batch deps resolve) then all dependency rows, in one transaction — any failure (including duplicate id) rolls back everything. `get` selects by id and joins `task_dependencies ORDER BY position ASC` to rehydrate `dependencies: string[]` in declared order, or returns `undefined` when absent. `listByInitiative` joins `tasks → objectives → initiatives` filtering on `initiativeId`, orders by task `id ASC`, rehydrates dependencies per task.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 003 · Task S003-T3: TaskRepository

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/sqlite-task-repository.test.ts`.

**Files changed.**

- `src/storage/port.ts` (edited) — added `import type { Task }` from domain; appended `TaskRepository { save, saveAll, get, listByInitiative }` interface.
- `src/storage/sqlite/sqlite-task-repository.ts` (new) — exports `SqliteTaskRepository` implementing `TaskRepository`. `save` and `saveAll` wrap inserts in explicit `BEGIN`/`COMMIT`/`ROLLBACK` transactions; `saveAll` inserts all task rows before any dependency rows so intra-batch FK references resolve; `get` fetches the task row then dependency rows ordered by `position ASC`; `listByInitiative` joins `tasks → objectives` filtering on `initiativeId` ordered by `t.id ASC`, rehydrates dependencies per task.

**Seam (GREEN).** `save` uses `BEGIN`/`COMMIT`/`ROLLBACK` with a FK violation on a missing dependency causing rollback and re-throw (task row never persists). `saveAll` two-phase insert (all tasks, then all deps) satisfies the out-of-order case; duplicate task id causes rollback of the entire batch. Dependencies are stored with a `position` index and rehydrated in that order on read.

**Refactor.** None specified in the Task spec; all changes are minimal and directly trace to the failing assertions.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 003 · Confirm S003-T3 GREEN + Story 004 Task S004-T1: port + adapter, single connection

**Cycle.** Confirmed GREEN for Task `S003-T3`; RED for Task `S004-T1` (`src/queue/sqlite.test.ts`).

**S003-T3 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 130 tests, 0 fail (before S004-T1 edits)

**Test written.**

- file: `src/queue/sqlite.test.ts` (new) — suite: implied — methods: `enqueue then claim returns { id, taskId } and job is running`, `claim on empty queue returns undefined`, `double enqueue leaves one queued job and returns true then false`, `after claiming, re-enqueue of same task returns true and creates new queued job`, `two tasks enqueued in order are claimed oldest-first`
- asserts: `SqliteJobQueue(db).enqueue(taskId)` returns `true` on first insert and `false` on idempotent re-enqueue of a still-queued task; `claim()` returns `{ id, taskId }` with the job row updated to `running`, or `undefined` when no jobs queued; after a job is claimed (`running`), re-enqueueing the same task returns `true` and creates a new `queued` row; two tasks enqueued in id order are claimed oldest-first.

**RED proof.**

- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/queue/sqlite.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/queue/sqlite.test.ts`
- 131 tests, 1 fail.

**Open to Software Engineer.**

- Seam 1: `src/queue/port.ts` — export `interface ClaimedJob { id: string; taskId: string }` and `interface JobQueue { enqueue(taskId: string): boolean; claim(): ClaimedJob | undefined }`. Include the `SQLITE_BUSY` policy and monotonic-id ordering doc comments per the Story spec.
- Seam 2: `src/queue/sqlite.ts` — export class `SqliteJobQueue` with constructor `(db: DatabaseSync)` implementing `JobQueue`. `enqueue` does `INSERT INTO jobs(id, taskId, status) VALUES(?,?,'queued') ON CONFLICT DO NOTHING` targeting the partial unique index; returns `true` if `changes > 0`, `false` otherwise. `claim` runs `UPDATE jobs SET status='running' WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY id LIMIT 1) RETURNING id, taskId`; returns `ClaimedJob` or `undefined` when no rows returned. Job ids use `newId()` from `domain/entity.ts`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 004 · Task S004-T1: port + adapter, single connection

**Cycle.** GREEN+REFACTOR for `src/queue/sqlite.test.ts`.

**Files changed.**

- `src/queue/port.ts` (new) — exports `ClaimedJob { id, taskId }` and `JobQueue { enqueue(taskId): boolean; claim(): ClaimedJob | undefined }` with SQLITE_BUSY policy and FIFO ordering documented.
- `src/queue/sqlite.ts` (new) — exports `SqliteJobQueue` implementing `JobQueue`; `enqueue` does `INSERT INTO jobs … ON CONFLICT DO NOTHING` (targeting the `jobs_queued_taskId` partial unique index) and returns `changes > 0`; `claim` does `UPDATE jobs SET status='running' WHERE id=(SELECT id … ORDER BY id LIMIT 1) RETURNING id, taskId`.

**Seam (GREEN).** `enqueue` uses the existing `jobs_queued_taskId` partial unique index (`WHERE status='queued'`) to guarantee idempotency — a second enqueue of a still-queued task hits the unique constraint and the `DO NOTHING` returns `changes=0`. `claim` uses a single atomic `UPDATE … RETURNING` statement so no separate read is needed; FIFO order is preserved because job ids are ULIDs (monotonically increasing) and the subquery orders by `id ASC LIMIT 1`.

**Refactor.** None specified in the Task spec.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 004 · Confirm S004-T1 GREEN + Task S004-T2: multi-process claim proof

**Cycle.** Confirmed GREEN for Task `S004-T1`; RED for Task `S004-T2` (`src/queue/sqlite.test.ts` extended).

**S004-T1 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 135 tests, 0 fail (before S004-T2 edits)

**Tests written.**

- file: `src/queue/sqlite.test.ts` (edited) — suite: implied — methods: `exact race: exactly one child claims, one sees empty`, `batch sweep: two workers together claim exactly the full set`
  - asserts (race): spawn two child workers against a DB with one queued job; each worker signals "ready" then waits on a barrier file; parent creates barrier after both ready; exactly one worker prints `claimed <taskId>`, exactly one prints `empty`.
  - asserts (batch): 50 jobs enqueued; two workers in batch mode (loop claim until undefined); both exit 0; total claimed lines = 50; sets are disjoint; union = all 50 enqueued task ids.
- New helper constant `WORKER_PATH` derived via `fileURLToPath(new URL("./claim-worker.test-helper.ts", import.meta.url))`.
- New `spawnWorker` helper that collects stdout line-by-line, resolves `ready` on the "ready" line, and rejects `ready` if the child exits with non-zero (preventing test hang).

**RED proof.**

- command: `npm test`
- exit: non-zero — 137 tests, 2 fail
- failure: `Error: worker exited with code 1` in both `exact race` and `batch sweep` tests — the child process exits code 1 because `src/queue/claim-worker.test-helper.ts` does not exist.

**Open to Software Engineer.**

- Seam: `src/queue/claim-worker.test-helper.ts` (new, test-only script outside `*.test.ts` glob). Must be a standalone runnable Node 24 TypeScript script that:
  - Parses CLI args `--db <path>` and `--wait-for <barrierFile>` and optional `--batch` flag.
  - Opens the database via `openDatabase(dbPath)`.
  - Constructs `SqliteJobQueue(db)`.
  - Writes `"ready\n"` to stdout (so the parent detects it).
  - Polls `existsSync(barrierFile)` in a tight loop until the file appears.
  - In single mode (no `--batch`): calls `claim()` once; if result is defined prints `"claimed <taskId>\n"` else prints `"empty\n"`; exits 0.
  - In batch mode (`--batch`): loops calling `claim()` until `undefined`; prints one `<taskId>` per line; exits 0.
  - Imports: `openDatabase` from `../storage/sqlite/open.ts`, `SqliteJobQueue` from `./sqlite.ts`, `existsSync` from `node:fs`, `process` from `node:process`.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 004 · Task S004-T2: multi-process claim proof

**Cycle.** GREEN+REFACTOR for `src/queue/sqlite.test.ts` (extended race + batch sweep tests).

**Files changed.**

- `src/queue/claim-worker.test-helper.ts` (new) — standalone Node 24 TypeScript worker: parses `--db <path>`, `--wait-for <barrierFile>`, and optional `--batch`; opens DB via `openDatabase`; constructs `SqliteJobQueue`; writes `"ready\n"` to stdout; polls `existsSync(barrierFile)` until the barrier appears; in single mode calls `claim()` once and writes `claimed <taskId>` or `empty`; in batch mode loops `claim()` until `undefined` writing one taskId per line; exits 0.

**Seam (GREEN).** The worker writes `"ready\n"` before polling so the parent's `spawnWorker` helper resolves its `ready` promise, then waits on the barrier file before claiming — satisfying both the single-race and batch-sweep scenarios.

**Refactor.** None specified in the Task spec.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 004 · Confirm S004-T2 GREEN + Story 005 Task S005-T1: event feed port + adapter + poller proof

**Cycle.** Confirmed GREEN for Task `S004-T2`; RED for Task `S005-T1` (`src/events/sqlite.test.ts`).

**S004-T2 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 137 tests, 0 fail (before S005-T1 edits)

**Test written.**

- file: `src/events/sqlite.test.ts` (new) — suite: implied — methods: `readAfter('0') returns all three events in id order`, `readAfter with cursor returns only new events`, `readAfter latest id returns []`, `paging with interleaved append yields each event exactly once`, `limit 0 throws RangeError`, `limit -1 throws RangeError`, `limit 1.5 throws RangeError`
- asserts: `SqliteEventFeed(db).append(event)` persists the event; `readAfter('0')` returns all appended events in id order; advancing cursor to last id and appending two more then calling `readAfter(cursor)` returns exactly the two new events; `readAfter(<latest id>)` returns `[]`; paging at size 2 over 5 events with one interleaved append yields all 5 events exactly once across 3 polls with no gap or duplicate; `readAfter` with `limit` 0, -1, or 1.5 throws `RangeError`.

**RED proof.**

- command: `npm test`
- exit: non-zero — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/events/sqlite.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/events/sqlite.test.ts`
- 138 tests, 1 fail.

**Open to Software Engineer.**

- Seam 1: `src/events/port.ts` — export `interface EventFeed { append(event: Event): void; readAfter(cursor: string, limit?: number): Event[] }` (import `Event` from `../domain/event.ts` using `import type`). Doc comment: cursor correctness requires strictly increasing ids (ULID from single-writer process); events from foreign id sources are out of contract.
- Seam 2: `src/events/sqlite.ts` — export class `SqliteEventFeed` with constructor `(db: DatabaseSync)` implementing `EventFeed`. `append` inserts a row `(id, type, taskId)` into `events`. `readAfter` guards `limit`: if provided and not a positive integer (i.e. `<= 0` or not `Number.isInteger(limit)`) throws `RangeError`; then runs `SELECT id, type, taskId FROM events WHERE id > ? ORDER BY id ASC LIMIT ?` with default limit 100.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 005 · Task S005-T1: event feed port + adapter + poller proof

**Cycle.** GREEN+REFACTOR for `src/events/sqlite.test.ts`.

**Files changed.**

- `src/events/port.ts` (new) — exports `EventFeed { append(event: Event): void; readAfter(cursor: string, limit?: number): Event[] }` with ULID cursor contract doc comment.
- `src/events/sqlite.ts` (new) — exports `SqliteEventFeed` implementing `EventFeed`; `append` inserts into `events`; `readAfter` validates `limit` (throws `RangeError` for non-positive-integer) then runs `SELECT … WHERE id > ? ORDER BY id ASC LIMIT ?` with default limit 100.

**Seam (GREEN).** `readAfter` guards `limit` before using it — `!Number.isInteger(limit) || limit <= 0` covers 0, -1, and 1.5; default is 100 when omitted. The `WHERE id > ?` predicate with ULID ordering satisfies the cursor advance and paging-with-interleaved-append assertions.

**Refactor.** None specified in the Task spec.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 005 · Confirm S005-T1 GREEN + Story 006 Task S006-T1: StoreGraph use case

**Cycle.** Confirmed GREEN for Task `S005-T1`; RED for Task `S006-T1` (`src/app/graph/store-graph.test.ts`).

**S005-T1 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 144 tests, 0 fail (before S006-T1 edits)

**Test written.**

- file: `src/app/graph/store-graph.test.ts` (new) — suite: implied — methods: `StoreGraph.execute stores two tasks, remaps dep label to ULID, returns in input order`, `StoreGraph.execute throws CycleError and does not call saveAll`, `StoreGraph.execute throws DuplicateTaskError and does not call saveAll`
- asserts: `StoreGraph(repo).execute({ objectiveId, tasks })` builds pending GraphNodes from labels, calls `validateGraph` before any persistence (cycle/duplicate errors propagate with zero `saveAll` calls on the fake), creates real Tasks via `newTask` (title defaults to label id), remaps label dependencies to new ULIDs, calls `TaskRepository.saveAll` once with all tasks, and returns the `Task[]` in input order.

**RED proof.**

- command: `node --test src/app/graph/store-graph.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/graph/store-graph.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/graph/store-graph.test.ts`

**Open to Software Engineer.**

- Seam: `src/app/graph/store-graph.ts` — export class `StoreGraph` with constructor taking a `TaskRepository` (from `../../storage/port.ts` via `import type`) and `execute({ objectiveId, tasks: Array<{ id: string; title?: string; dependencies?: string[] }> }): Promise<Task[]>`. The method: (1) builds label-keyed `GraphNode[]` with `status: 'pending'`; (2) calls `validateGraph` — propagates `CycleError` / `DuplicateTaskError` before touching the repo; (3) calls `newTask` for each input (title defaults to label id, dependencies `[]`); (4) remaps each task's `dependencies` from label strings to the corresponding new ULID; (5) calls `repo.saveAll(tasks)` once; (6) returns the tasks in input order.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 006 · Task S006-T1: StoreGraph use case

**Cycle.** GREEN for `src/app/graph/store-graph.test.ts`.

**Files changed.**

- `src/app/graph/store-graph.ts` (new) — exports `StoreGraph`; constructor takes `TaskRepository`; `execute({ objectiveId, tasks })` (1) builds `GraphNode[]` for validation, (2) calls `validateGraph` (propagates `CycleError`/`DuplicateTaskError` before any I/O), (3) calls `newTask` per input with `title ?? id`, (4) remaps label deps to new ULIDs, (5) calls `repo.saveAll(tasks)` once, (6) returns tasks in input order.

**Seam (GREEN).** A `Map<label, Task>` built during step 3 allows O(1) label→ULID remapping in step 4; `saveAll` is called exactly once after all tasks are created.

**Refactor.** None specified in the Task spec.

**Build check.**

- typecheck: FAIL — 10 errors, all in `src/app/graph/store-graph.test.ts` (TE-owned file, not my lane)

**OPEN: noUncheckedIndexedAccess errors in test file.**

`src/app/graph/store-graph.test.ts` uses `result[0]` and `result[1]` on the `Task[]` return value. With `"noUncheckedIndexedAccess": true` in tsconfig, TypeScript widens those to `Task | undefined`, producing 10 type errors (`TS18048`):

```
src/app/graph/store-graph.test.ts(41,18): error TS18048: 'apiTask' is possibly 'undefined'.
src/app/graph/store-graph.test.ts(42,18): error TS18048: 'apiTask' is possibly 'undefined'.
...
```

There is no production-side fix: `execute()` correctly returns `Promise<Task[]>` and `noUncheckedIndexedAccess` will always widen numeric-indexed access on that type to `T | undefined`. The test file must use non-index access — e.g. `const [apiTask, deployTask] = result` with appropriate narrowing, or `assert.ok(result[0]); const apiTask = result[0]` — but that is the TE's lane. Please update `store-graph.test.ts` to avoid direct `result[n]` access.

ATTEMPT-FAILED: S006-T1 — test file has 10 TS18048 typecheck errors from `noUncheckedIndexedAccess` that only the TE can resolve.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 006 · Confirm S006-T1 GREEN (typecheck fix) + RED for S006-T2: CheckStoredGraph use case

**Cycle.** Confirmed GREEN for Task `S006-T1` (typecheck fix applied); RED for Task `S006-T2` (`src/app/graph/check-stored-graph.test.ts`).

**S006-T1 fix applied.**
The SE's OPEN identified 10 `TS18048` errors caused by `noUncheckedIndexedAccess` widening `result[0]`/`result[1]` and `repo.calls[0]` to `T | undefined`. Fixed by:

- destructuring `const [apiTask, deployTask] = result` and adding `assert.ok(apiTask)` / `assert.ok(deployTask)` guards before use.
- narrowing `repo.calls[0]` via `const firstCall = repo.calls[0]; assert.ok(firstCall)` before the `deepEqual`.

**S006-T1 GREEN confirmation.**

- `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- `npm test` → 147 tests, 0 fail

**Test written.**

- file: `src/app/graph/check-stored-graph.test.ts` (new) — suite: implied — methods: `CheckStoredGraph.execute returns ready/blocked report for a diamond graph with mixed statuses`, `CheckStoredGraph.execute returns [] for an empty initiative`, `CheckStoredGraph.execute propagates UnknownDependencyError for a dangling dependency`
- asserts: `CheckStoredGraph(repo).execute({ initiativeId })` calls `repo.listByInitiative`, runs `validateGraph` + `readiness`, returns a `ReadinessEntry[]` of pending tasks only (root=completed excluded); left/right are `"ready"` (sole dep completed); bottom is `"blocked"` waiting on `["id-left","id-right"]`; empty initiative returns `[]`; a dangling dep id throws `UnknownDependencyError`.

**RED proof.**

- command: `node --test src/app/graph/check-stored-graph.test.ts`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/graph/check-stored-graph.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/app/graph/check-stored-graph.test.ts`

**Open to Software Engineer.**

- Seam: `src/app/graph/check-stored-graph.ts` — export class `CheckStoredGraph` with constructor taking a `TaskRepository` (from `../../storage/port.ts` via `import type`) and `execute({ initiativeId: string }): Promise<ReadinessEntry[]>`. The method: (1) calls `repo.listByInitiative(initiativeId)`; (2) calls `validateGraph(tasks)` — propagates `CycleError`/`UnknownDependencyError`; (3) calls `readiness(tasks)` and returns the result. Import `validateGraph` and `readiness` from `../../domain/graph.ts`; import type `ReadinessEntry` from same. `Task[]` satisfies `GraphNode[]` by structural typing (EPIC 002 S005 decision).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 006 · Task S006-T2: CheckStoredGraph use case

**Cycle.** GREEN+REFACTOR for `src/app/graph/check-stored-graph.test.ts`.

**Files changed.**

- `src/app/graph/check-stored-graph.ts` (new) — exports `CheckStoredGraph`; constructor takes `TaskRepository`; `execute({ initiativeId })` calls `repo.listByInitiative`, then `validateGraph` (propagates `CycleError`/`UnknownDependencyError`), then `readiness`, and returns the result.

**Seam (GREEN).** `Task[]` satisfies `GraphNode[]` by structural typing (both have `id: string`, `status: TaskStatus`, `dependencies: string[]`) so passing the result of `listByInitiative` directly to `validateGraph` and `readiness` requires no mapping.

**Refactor.** None specified in the Task spec.

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — Story 006 · Confirm S006-T2 GREEN + Task S006-T3: persisted round-trip integration

**Cycle.** Confirmed GREEN for Task `S006-T2`; Integration capstone RED/GREEN for Task `S006-T3` (`src/app/graph/graph-roundtrip.integration.test.ts`).

**S006-T2 GREEN confirmation.**

- command: `npm run verify:handoff` → `VERIFY: PASS` (exit 0)
- command: `npm test` → 150 tests, 0 fail (before S006-T3 edits)

**Test written.**

- file: `src/app/graph/graph-roundtrip.integration.test.ts` (new) — suite: implied — methods: `StoreGraph → CheckStoredGraph: both roots ready, deploy blocked on api ULID`, `StoreGraph → CheckStoredGraph: two tasks stored, loaded task has deps in declared order`
- asserts: (a) on a temp DB opened via `openDatabase` + `MIGRATIONS`, create project/initiative/objective via real repos, call `StoreGraph(SqliteTaskRepository)` with the EPIC 002 demo-fixture shape (api root, deploy-depends-api, monitor root); `CheckStoredGraph` report has `api` and `monitor` `ready` with `waiting:[]`, `deploy` `blocked` with `waiting:[apiTask.id]` (real ULID); each `StoreGraph` return value deep-equals the result of `taskRepo.get(id)` — round-trip proven. (b) A second test verifies declared dependency order is preserved on reload.

**First-run pass — intentional (integration capstone).**
The Story explicitly states `Action - GREEN: none expected — this is the integration capstone`. The RED state is "test does not exist"; once written, all production seams (StoreGraph, CheckStoredGraph, SqliteTaskRepository) installed in S006-T1/T2 already satisfy the assertions. This matches the legitimate exception: coverage of an already-implemented path. Sensitivity is real: removing any of those production seams makes the suite fail.

**S006-T3 GREEN confirmation (immediate).**

- command: `npm test` → 152 tests, 0 fail

**Verification Gate — all Stories complete.**

- `npm run verify:handoff` → `VERIFY: PASS` (exit 0); `npm test` → 152 tests, 0 fail

**Tasks closed.** 16 Tasks across 6 Stories (S001-T1…T5, S002-T1, S003-T1…T3, S004-T1…T2, S005-T1, S006-T1…T3). Story 007 (M1/M2) is a maintainer story — lane-forbidden files, executed by human + assistant directly outside /work.

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-17
- state: local-uncommitted

END: TEST-ENGINEER

AUTO_REVIEW: FAIL — routing 3 action:YES finding(s) to the TDD loop; 2 action:NO finding(s) recorded for the human.
BLOCKER: B1 migrate-error-fields — migrate.ts (applyOne, ~L51-59) rethrows the raw error without attaching { applied, failedVersion, failedName }; the CLI db.ts error branch reads those exact fields, so a real failing migration prints "migration 0 failed" with no applied lines. Only the test-only ThrowingMigrator adds them. Attach the fields in migrate.ts on failure and add a migrate.test.ts assertion that the thrown error carries them.
BLOCKER: S1 events-import-type — src/events/sqlite.ts uses a value import for DatabaseSync but only uses it as a type; change to `import type { DatabaseSync }` to match sibling adapters.
BLOCKER: S2 queue-private-field — src/queue/sqlite.ts uses TS `private readonly db`; all other adapters use JS `#` private fields. Change to `readonly #db` and update the two access sites.
INFO: S3 events-effectivelimit-order — events/sqlite.ts assigns effectiveLimit before the validation guard; harmless, cosmetic ordering only.
INFO: S4 status-store-n-plus-1 — sqlite-status-store.ts tables() runs one count(*) per table (N+1); acceptable at current table count, note for later epics.

## TEST-ENGINEER — BLOCKER B1 regression: migrate error fields

**Cycle.** RED for BLOCKER B1 (`src/storage/sqlite/migrate.test.ts` — regression test for structured migration error).

**Test written.**

- file: `src/storage/sqlite/migrate.test.ts` (edited) — suite: `migrate` — method: `failed migration error carries applied, failedVersion, and failedName`
- asserts: when `migrate(db, migrations)` throws because migration 2 fails (migration 1 already applied), the caught error object carries `applied: [{version:1, name:'ok'}]`, `failedVersion: 2`, and `failedName: 'boom'`. The real `migrate` function is used — no fakes.

**RED proof.**

- command: `npm test -- --test-name-pattern="failed migration error carries"`
- exit: non-zero — failure: `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: + undefined - [{ name: 'ok', version: 1 }]` at `migrate.test.ts:85`
- The raw error from `applyOne` is rethrown without any fields attached; `e.applied` is `undefined`.

**Open to Software Engineer.**

- Seam: `src/storage/sqlite/migrate.ts` — in `applyOne` (or its call site in `migrate`), after catching the raw error and rolling back, attach `{ applied: <entries applied so far>, failedVersion: m.version, failedName: m.name }` to the error object before rethrowing. The `applied` list is the accumulator that exists in `migrate`'s loop at the point of failure.

**Carry-forward — S1 and S2 from AUTO_REVIEW.**
These are pure refactors (no new test needed); the SE should pick them up as part of this GREEN turn:

- S1 `events-import-type`: `src/events/sqlite.ts` — change the `DatabaseSync` value import to `import type { DatabaseSync }`.
- S2 `queue-private-field`: `src/queue/sqlite.ts` — change `private readonly db` to JS `#db` private field (matching all sibling adapters).

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — Story 001-006 · Review blockers B1, S1, S2

**Cycle.** GREEN+REFACTOR for `src/storage/sqlite/migrate.test.ts` (B1) + two carry-forward refactors from AUTO_REVIEW (S1, S2).

**Review blockers addressed.**

- `BLOCKER: B1 migrate-error-fields` — `migrate.ts` rethrew the raw error without the structured fields db.ts reads.
- `BLOCKER: S1 events-import-type` — `events/sqlite.ts` used a value import for `DatabaseSync` only used as a type.
- `BLOCKER: S2 queue-private-field` — `queue/sqlite.ts` used TS `private readonly db` instead of JS `#` private field.

**Files changed.**

- `src/storage/sqlite/migrate.ts` (edited) — wrapped the `applyOne(db, m)` call in a try/catch inside the `migrate` loop; on catch, `Object.assign(err, { applied, failedVersion: m.version, failedName: m.name })` attaches the structured fields before rethrowing. The `applied` snapshot at catch time is exactly the list of migrations that completed before the failure.
- `src/events/sqlite.ts` (edited) — changed `import { DatabaseSync }` to `import type { DatabaseSync }` (verbatimModuleSyntax compliance).
- `src/queue/sqlite.ts` (edited) — changed `private readonly db: DatabaseSync` to `readonly #db: DatabaseSync`; updated both access sites (`this.db` → `this.#db`) in `enqueue` and `claim`.

**Seam (GREEN).** The `migrate` loop now catches `applyOne` failures and augments the error object with `{ applied, failedVersion, failedName }` before rethrowing — satisfying the test's `deepEqual` assertions on those fields and matching exactly what `db.ts`'s catch branch reads.

**Refactor.** S1 and S2 applied (import type + # private field).

**Build check.**

- typecheck: exit 0

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — implementation ready for review

**EPIC verification gate.**

Handoff artifact: `npm run verify:handoff` → `VERIFY: PASS` (exit 0, typecheck clean).

Unit tests: `npm test` → 153 tests, 0 fail (B1 regression test `failed migration error carries applied, failedVersion, and failedName` passes; no regressions).

EPIC Proof (verbatim):

- `node src/main.ts db migrate` (first run) → prints `applied: 1 create tasks table` / `applied: 2 core-schema`. Exit 0.
- `node src/main.ts db migrate` (second run) → prints `up to date`. Exit 0.
- `node src/main.ts db status` → prints `schema: 2`, `journal_mode: wal`, row counts for all 8 tables (all 0). Exit 0.

All three review blockers confirmed resolved:

- B1 `migrate-error-fields`: error carries `applied`, `failedVersion`, `failedName` — regression test green.
- S1 `events-import-type`: `import type { DatabaseSync }` in `src/events/sqlite.ts` — typecheck clean.
- S2 `queue-private-field`: `#db` JS private field in `src/queue/sqlite.ts` — typecheck clean.

**Tasks closed.** 16 Tasks across 6 Stories (S001-T1…T5, S002-T1, S003-T1…T3, S004-T1…T2, S005-T1, S006-T1…T3). Story 007 (M1/M2) is a maintainer story — lane-forbidden files, executed by human + assistant directly outside /work.

IMPLEMENTATION_READY_FOR_REVIEW:

- gates: PASS
- date: 2026-07-17
- state: local-uncommitted

END: TEST-ENGINEER

HUMAN_REVIEW: PASS
