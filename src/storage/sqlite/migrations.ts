import type { Migration } from "./migrate.ts";

/**
 * The ordered migration registry. Later epics append their migrations here —
 * the runner (`migrate.ts`) is not touched again. Plain `CREATE TABLE` (not
 * `IF NOT EXISTS`): the `user_version` guard is the idempotency mechanism, so a
 * create on unexpected state must fail loud.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create tasks table",
    up: (db) => db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY)"),
  },
];
