# Story 001 - db CLI: migrate + status

Epic: `.agent/plan/epics/003-persistence-queue-events.md`

## Goal

Migrations become an explicit CLI operation on the EPIC 001 runner: `db
migrate` applies pending migrations and reports them; `db status` inspects
the real database. Opening the database no longer migrates; the skeleton
`status` command and its migrate-on-open store are replaced.

## Locked decisions

- **No new migration framework.** EPIC 001's runner
  (`storage/sqlite/migrate.ts`, `PRAGMA user_version` + ordered in-code
  list, one transaction per migration) is the mechanism; the epic text's
  "schema-version table" is satisfied by `user_version` (debate finding —
  EPIC 001's non-goals bind this epic to register migrations through that
  runner, not rebuild it). EPIC 003 registers migrations and adds CLI
  control.
- **Bootstrap no longer migrates.** Migrations run only via `db migrate` —
  otherwise the Proof's first `db migrate` would print `up to date` because
  opening the DB already migrated. The skeleton `status` command is removed;
  `db status` replaces it (consumer sweep is maintainer story 007 M1).
- **One connection helper.** `openDatabase(path)` in
  `src/storage/sqlite/open.ts` creates the parent directory, opens
  `DatabaseSync`, sets `journal_mode=WAL`, `foreign_keys=ON`,
  `busy_timeout=5000`. Every connection — main.ts, tests, child processes —
  opens through it. SQLite adapters never open the DB themselves; they get
  the handle by constructor injection (main.ts opens once).

## Acceptance Criteria

- `openDatabase(path)` returns a `DatabaseSync` with parent dir created,
  `journal_mode=wal`, `foreign_keys=on`, `busy_timeout=5000`.
- `migrate(db, migrations)` returns `{ version: number, applied:
  Array<{ version: number, name: string }> }`; re-run returns
  `applied: []`.
- `db migrate` stdout: one `applied: <version> <name>` line per applied
  migration, in order; nothing pending → single line `up to date`. Exit 0.
  A failing migration → the lines for migrations already applied in this
  run, then stderr `error: migration <version> <name> failed: <message>`,
  exit 1. **Only the failing migration rolls back** (per-migration
  transaction, EPIC 001 mechanism); earlier migrations in the run stay
  applied (debate finding — "schema untouched" would be false).
- `db status` stdout, in order: `db: <path>`, `schema: <version>`,
  `journal_mode: wal`, then one `<table>: <rowcount>` line per user table,
  **alphabetical** (debate finding — `sqlite_master` order is not a
  contract). Unmigrated DB → just the first three lines with `schema: 0`.
  Exit 0.
- `status` is removed from the command table; `GetStatus` /
  `SqliteStatusStore` are reworked into the new pair below.

## Constraints

- `app/db/` use cases import ports only (`import type`); CLI handlers call
  use cases; only `main.ts` constructs adapters. `KANTHORD_DB` env with
  `.data/kanthord.db` default unchanged from EPIC 001.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green. The epic Proof block is
  the program-level check (run by maintainer story 007).

### Task T1 - openDatabase helper

**Requires:** none.

**Input:** `src/storage/sqlite/open.ts` (new),
`src/storage/sqlite/open.test.ts` (new); consumes `node:sqlite`
`DatabaseSync`.

**Action - RED:** tests on a temp path assert: (a) a missing parent
directory is created; (b) `PRAGMA journal_mode` is `wal`; (c)
`PRAGMA foreign_keys` is on; (d) `PRAGMA busy_timeout` is 5000; (e) a
second open of the same file succeeds and still reports `wal`. Fails
today: module does not exist.

**Action - GREEN:** implement `openDatabase(path): DatabaseSync`.

**Action - REFACTOR:** none.

**Output:** `src/storage/sqlite/open.ts` exports `openDatabase`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 - migration report

**Requires:** none.

**Input:** `src/storage/sqlite/migrate.ts` + `migrate.test.ts` (EPIC 001).

**Action - RED:** extend the existing tests: (a) `migrate` returns
`{ version, applied }` with one `{ version, name }` entry per newly
applied migration, in order; (b) an idempotent re-run returns the same
`version` and `applied: []`; (c) when migration N fails, migrations before
N in the same run remain applied and the thrown error identifies N (the
EPIC 001 rollback test asserts only N's changes are gone). Existing
assertions updated to the new return shape.

**Action - GREEN:** change `migrate` to collect and return the applied
list alongside the final version. Mechanism (per-migration transaction,
`user_version` bump, rollback on throw, sequence validation) unchanged.

**Action - REFACTOR:** none.

**Output:** `migrate(db, migrations): MigrationReport` where
`MigrationReport = { version: number, applied: Array<{ version: number,
name: string }> }` (exported type).

**Verify:** `npm test` green (all EPIC 001 runner behaviors still pass
plus the new assertions); `npm run typecheck` exit 0.

### Task T3 - db use cases + ports

**Requires:** S001-T2 (`MigrationReport` shape).

**Input:** `src/storage/port.ts` (extend), `src/app/db/migrate-db.ts`
(new), `src/app/db/get-db-status.ts` (new) + co-located tests (new);
`src/app/status/get-status.ts` + test (deleted).

**Action - RED:** hermetic tests with hand-written fakes: (a)
`MigrateDb.execute()` returns the `MigrationReport` produced by a fake
`Migrator`; (b) `GetDbStatus.execute()` returns `{ dbPath, schemaVersion,
journalMode, tables }` from a fake `StatusStore` where `tables` is
`Array<{ name: string, rows: number }>`. Fails today: modules do not
exist.

**Action - GREEN:** in `storage/port.ts` add `Migrator { migrate():
MigrationReport }` and rework `StatusStore` to `{ path, schemaVersion(),
journalMode(), tables(): Array<{ name, rows }> }`; implement the two use
cases (one class, one `execute()`, constructor injection, `import type`).
Delete `app/status/` (replaced).

**Action - REFACTOR:** none.

**Output:** `src/storage/port.ts` exports `Migrator`, `MigrationReport`,
the reworked `StatusStore`; `src/app/db/` exports `MigrateDb`,
`GetDbStatus`.

**Verify:** `npm test` green; `npm run typecheck` exit 0; `npm run lint`
shows no boundary violation.

### Task T4 - sqlite adapters

**Requires:** S001-T1, S001-T3.

**Input:** `src/storage/sqlite/sqlite-migrator.ts` (new),
`src/storage/sqlite/sqlite-status-store.ts` (rework) + co-located tests;
consumes `openDatabase`, `migrate`, `MIGRATIONS`.

**Action - RED:** tests on temp DB files (deterministic cleanup): (a)
`SqliteMigrator(db, migrations).migrate()` applies toy migrations and
returns the report; re-run returns `applied: []`; (b) reworked
`SqliteStatusStore(db, path)` — no migrate-on-open — reports
`schemaVersion() === 0` on a fresh DB, `journalMode() === 'wal'`, and
after applying toy migrations, `tables()` lists each user table with its
row count, alphabetical. Fails today: adapters don't match.

**Action - GREEN:** implement both; `tables()` reads `sqlite_master`
(`type='table'`, name not like `sqlite_%`) `ORDER BY name` and counts
rows per table. The migration list is injected so tests pass their own;
main.ts passes `MIGRATIONS`.

**Action - REFACTOR:** drop the obsolete `taskCount()`/migrate-on-open
code paths and their tests.

**Output:** `SqliteMigrator` and reworked `SqliteStatusStore`, both
constructed with an already-open `DatabaseSync`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T5 - CLI + composition

**Requires:** S001-T3, S001-T4.

**Input:** the EPIC 001 CLI command-table file under `src/apps/cli/`,
`src/apps/cli/db.ts` (new) + test, `src/main.ts`.

**Action - RED:** tests call the handlers with injected fakes: (a)
`runDbMigrate` formats one `applied: <version> <name>` line per entry, or
`up to date`; exit 0; a throwing migrator → the already-applied lines plus
the locked `error:` line and exit 1; (b) `runDbStatus` formats the locked
output. Fails today: module does not exist.

**Action - GREEN:** implement the handlers; register `db migrate` and
`db status` in the command table; remove `status`. `main.ts`: open via
`openDatabase(KANTHORD_DB || '.data/kanthord.db')` once, construct
`SqliteMigrator` + `SqliteStatusStore`, wire use cases → handlers; no
migration at bootstrap.

**Action - REFACTOR:** none.

**Output:** `db migrate` and `db status` run end to end per the
Acceptance Criteria; `status` is gone.

**Verify:** `npm test` green; `npm run typecheck` exit 0; manual run of
the epic Proof block against a temp `KANTHORD_DB` prints the locked
output (final record via story 007).
