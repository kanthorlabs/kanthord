import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

/**
 * Minimal typed execution seam over a DatabaseSync connection.
 * Later Epics inject this interface in their constructors/factories so tests
 * can run against a temp-file DB (PROFILE.md DI style).
 */
export interface Store {
  get<T>(sql: string, ...params: unknown[]): T | undefined;
  run(sql: string, ...params: unknown[]): void;
  all<T>(sql: string, ...params: unknown[]): T[];
  close(): void;
}

type Migration = {
  readonly version: number;
  readonly sql: string;
};

/**
 * Migration list — versioned, forward-only (PRD §6.1).
 * Version 1: throwaway round-trip table used by T2; no product/domain tables
 * belong here (Epic non-goals).
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: "CREATE TABLE IF NOT EXISTS _roundtrip (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
  },
];

class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as SQLInputValue[])) as
      | T
      | undefined;
  }

  run(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...(params as SQLInputValue[]));
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Opens (or creates) a SQLite database at `path`, configures WAL mode and a
 * busy timeout, applies any pending versioned migrations, and returns a typed
 * execution seam.
 *
 * WAL + busy_timeout are applied first because the daemon and broker both
 * touch the DB (PRD §6.1).
 *
 * SU2 confirmed API: `new DatabaseSync(path)`, `db.exec(...)`,
 * `db.prepare(...).get()/.run()/.all()`, `db.close()`.
 */
export function openStore(path: string, opts: { busyTimeout: number }): Store {
  const db = new DatabaseSync(path);

  // WAL mode sticks across connections; set unconditionally (idempotent).
  db.exec("PRAGMA journal_mode = wal");
  // busy_timeout: SU2 confirmed read-back key is `timeout`, value is the ms int.
  db.exec(`PRAGMA busy_timeout = ${opts.busyTimeout}`);

  // Schema-version metadata table — holds a single row with the current version.
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
  );

  // Determine the highest migration already applied (0 = fresh database).
  const versionRow = db
    .prepare("SELECT version FROM schema_version")
    .get() as { version: number } | undefined;
  const currentVersion = versionRow !== undefined ? versionRow.version : 0;

  // Collect and sort pending migrations by version.
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  // Apply each pending migration and track the highest version reached.
  let latestVersion = currentVersion;
  for (const migration of pending) {
    db.exec(migration.sql);
    latestVersion = migration.version;
  }

  // Persist the new schema version when at least one migration ran.
  if (latestVersion > currentVersion) {
    db.exec("DELETE FROM schema_version");
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      latestVersion,
    );
  }

  return new SqliteStore(db);
}
