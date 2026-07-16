/** Read-only view of the store's health, owned by the core (no vendor name). */
export interface StatusStore {
  /** Filesystem path of the backing database. */
  readonly path: string;
  /** Current schema version (the migration runner's `user_version`). */
  schemaVersion(): number;
  /** Journal mode the database is running in, e.g. `"wal"`. */
  journalMode(): string;
  /** Number of rows in the `tasks` table. */
  taskCount(): number;
  /** Release the underlying handle. */
  close(): void;
}
