# Story 3 — Walking skeleton + migration runner

**Acceptance:** `main.ts` → `apps/cli/` `status` → `app/status/get-status.ts` →
`storage/port.ts` → `storage/sqlite/` on `node:sqlite`, wired end to end; the
migration runner (infrastructure) applies migration 1 at bootstrap; the epic
Proof runs.

### Task S3-T1 — `GetStatus` use case + `StatusStore` port, test-first (src-in-lane)

**Pre-requirements.** S1-T2 (toolchain proven by the first RED→GREEN); S4-T1
(gotchas read); recommended S2-T2 (write it lint-clean).

**Input.** `AGENTS.md` port/use-case conventions (capability-named port, no `I`
prefix, one use case per file, `import type` for ports).

**Action.** Test-first:
1. Write `src/app/status/get-status.test.ts` first, with a hand-written
   `FakeStatusStore` implementing the port — assert `GetStatus.execute()`
   returns the four fields from the faked port. Run `npm test` → RED.
2. Implement `src/storage/port.ts` — interface `StatusStore`: `path`,
   `schemaVersion()`, `journalMode()`, `taskCount()`, `close()`.
3. Implement `src/app/status/get-status.ts` — class `GetStatus`, constructor
   injection of `StatusStore` (`import type`), `execute()` returning
   `{ dbPath, schemaVersion, journalMode, taskCount }`. Run `npm test` → GREEN.

**Output.** Three new files: `src/storage/port.ts`,
`src/app/status/get-status.ts`, `src/app/status/get-status.test.ts` — the
core→port half of the architecture path, hermetically tested.

**Verify.** `npm test` → green; `npm run typecheck` → exit 0; `npm run lint`
(if S2-T3 done) → no boundary violation (use case imports only the port type).

### Task S3-T2 — Migration runner (the infrastructure), test-first (src-in-lane)

**Pre-requirements.** S1-T2 (toolchain proven); S4-T1 (gotchas read — note the
`node:sqlite` `ExperimentalWarning` entry).

**Input.** The locked mechanism (index.md): `PRAGMA user_version` + ordered
in-code list, idempotent, once at bootstrap; `node:sqlite` `DatabaseSync`.

**Action.** Test-first:
1. Write `src/storage/sqlite/migrate.test.ts` first, against a temp DB with
   **toy migrations defined in the test** (do not depend on the real registry).
   RED tests covering: applies pending migrations in order; **skips
   already-applied on re-run (idempotency)**; rolls back a failing migration
   (no half-applied schema); rejects a bad version sequence (not strictly
   increasing from 1 / gaps / duplicates). Run `npm test` → RED.
2. Implement `src/storage/sqlite/migrate.ts`:
   - `Migration` interface: `version: number`, `name: string`,
     `up(db: DatabaseSync): void`.
   - `migrate(db, migrations): number` — reads `user_version`, validates the
     sequence, applies each migration with `version > current` in order,
     **each in its own transaction** (bump `user_version` inside it; rollback
     on throw), returns the final version.
   Run `npm test` → GREEN.

**Output.** `src/storage/sqlite/migrate.ts` + `migrate.test.ts` — the reusable
migration infrastructure every later epic registers into.

**Verify.** `npm test` → all four behaviors green (in-order, idempotent,
rollback, bad-sequence rejection); `npm run typecheck` → exit 0.

### Task S3-T3 — Migration registry + SQLite adapter, test-first (src-in-lane)

**Pre-requirements.** S3-T1 (the `StatusStore` port exists); S3-T2 (the runner
exists).

**Input.** `src/storage/port.ts`; `src/storage/sqlite/migrate.ts`; locked
decision: migration 1 = `CREATE TABLE tasks(id TEXT PRIMARY KEY)` (plain
`CREATE TABLE`, not `IF NOT EXISTS` — the `user_version` guard is the
idempotency mechanism; a plain create fails loud on unexpected state).

**Action.** Test-first:
1. Write `src/storage/sqlite/sqlite-status-store.test.ts` first, against a temp
   DB file with deterministic cleanup (`finally`/teardown removes it). RED
   asserts: `journalMode()` === `"wal"`; `schemaVersion()` === 1 after open;
   `taskCount()` === 0; `close()` releases the handle; re-open of the same file
   is a no-op (idempotent bootstrap). Run `npm test` → RED.
2. Implement `src/storage/sqlite/migrations.ts` — `MIGRATIONS: readonly
   Migration[]` with migration 1 `create tasks table`. Later epics append here.
3. Implement `src/storage/sqlite/sqlite-status-store.ts` — `SqliteStatusStore`
   implements `StatusStore`: opens/creates the DB file, sets
   `PRAGMA journal_mode=WAL`, runs `migrate(db, migrations)` on open,
   `schemaVersion()` reads `user_version`, `taskCount()` reads
   `SELECT count(*) FROM tasks`, `close()` closes the handle. The migration
   list is **injected** (constructor parameter) so tests can pass their own.
   Run `npm test` → GREEN.

**Output.** `src/storage/sqlite/migrations.ts` (the registry, seeded with
migration 1) + `src/storage/sqlite/sqlite-status-store.ts` + its co-located
test — the adapter half of the architecture path.

**Verify.** `npm test` → green including cleanup; `npm run typecheck` → exit 0.

### Task S3-T4 — Composition root + CLI (src-in-lane; proven by Proof)

**Pre-requirements.** S3-T1 (use case); S3-T3 (adapter + registry).

**Input.** `GetStatus`, `SqliteStatusStore`, `MIGRATIONS`; locked output
contract (index.md): four `key: value` lines `db:` / `schema:` /
`journal_mode:` / `tasks:`; env var `KANTHORD_DB` with `.data/kanthord.db`
default.

**Action.**
1. Implement `src/apps/cli/` — parse argv, map `status` → `GetStatus`, format
   the four locked output lines. Thin: parse input, call use case, format
   output — nothing else.
2. Implement `src/main.ts` — read `KANTHORD_DB` (default `.data/kanthord.db`);
   **`mkdirSync(dirname(dbPath), { recursive: true })`** so a clean checkout
   without `.data/` does not fail `SQLITE_CANTOPEN`; construct
   `SqliteStatusStore` with `MIGRATIONS` (migration runs at this bootstrap);
   wire `GetStatus` → CLI; close the store after the command; exit 0.
   `main.ts` is the only file importing concrete adapters.

**Output.** `src/apps/cli/` + `src/main.ts` — the full architecture path
CLI → use case → port → adapter → SQLite, runnable end to end. No unit test;
the epic Proof (S5-T1) is the test.

**Verify.** Run the exact Proof block in
[Story 5 · S5-T1](05-verify-bundle.md) — both runs (fresh temp DB and default
path) print the locked output and exit 0.
