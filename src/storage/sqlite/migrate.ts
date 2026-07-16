import type { DatabaseSync } from "node:sqlite";

/** One schema migration. `up` runs inside its own transaction. */
export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

/**
 * Apply every migration with `version > user_version`, in order, each in its
 * own transaction (the `user_version` bump is inside the transaction, so a
 * throw rolls back both schema and version). Idempotent: nothing pending →
 * nothing runs. Returns the final `user_version`.
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[]): number {
  validateSequence(migrations);
  let current = userVersion(db);
  for (const m of migrations) {
    if (m.version <= current) continue;
    applyOne(db, m);
    current = m.version;
  }
  return current;
}

/** Versions must be exactly 1..n contiguous (catches gaps, dupes, not-from-1). */
function validateSequence(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `invalid migration sequence: expected version ${i + 1} at index ${i}, got ${m.version}`,
      );
    }
  });
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

function applyOne(db: DatabaseSync, m: Migration): void {
  db.exec("BEGIN");
  try {
    m.up(db);
    db.exec(`PRAGMA user_version = ${m.version}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
