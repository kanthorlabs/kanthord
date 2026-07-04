# SQLite / DDL gotchas (read before any schema or migration DDL)

Living checklist. Append a dated bullet when a new pitfall bites.

Engine is **`node:sqlite`** (`DatabaseSync`) — not Postgres. The idempotency
rules below are SQLite's, which differ from Postgres in one important place.

- **Make DDL idempotent with SQLite's own `IF NOT EXISTS` / `IF EXISTS` clause —
  do NOT wrap DDL in `try/catch` to swallow an expected "already exists" / "no
  such" error.** A try/catch that eats the re-run error also eats a real failure
  (typo, locked db, corruption). Reserve `try/catch` for genuinely
  *unanticipated* errors, never as a substitute for a declarative guard.
  SQLite supports the clause on:
  - `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
    `CREATE VIEW IF NOT EXISTS`, `CREATE TRIGGER IF NOT EXISTS`
  - `DROP TABLE IF EXISTS`, `DROP INDEX IF EXISTS`, `DROP VIEW IF EXISTS`,
    `DROP TRIGGER IF EXISTS`
- **Caveat — SQLite `ALTER TABLE ... ADD COLUMN` has NO `IF NOT EXISTS`.** That
  clause is PostgreSQL-only (see the PG `ALTER TABLE` docs); in `node:sqlite` the
  same SQL is a syntax error. To add a column idempotently, guard with a column
  existence check, then run a plain `ADD COLUMN` only when the column is absent —
  not a `try/catch` that swallows the `duplicate column name` error:

  ```ts
  const cols = store.all(`PRAGMA table_info(scheduler_task)`) as { name: string }[];
  if (!cols.some((c) => c.name === "blocked_on")) {
    store.run("ALTER TABLE scheduler_task ADD COLUMN blocked_on TEXT");
  }
  ```

  SQLite `ALTER TABLE` likewise has no `IF EXISTS` for `DROP COLUMN` / `RENAME` —
  guard those with the same `PRAGMA table_info` check.
