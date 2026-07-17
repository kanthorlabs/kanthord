import type { DatabaseSync } from "node:sqlite";

import type { MigrationReport } from "../port.ts";

// Re-export so consumers that previously imported from here continue to work.
export type { MigrationReport } from "../port.ts";

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
 * nothing runs. Returns the final `user_version` and the list of applied migrations.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[],
): MigrationReport {
  validateSequence(migrations);
  let current = userVersion(db);
  const applied: Array<{ version: number; name: string }> = [];
  for (const m of migrations) {
    if (m.version <= current) continue;
    try {
      applyOne(db, m);
    } catch (err) {
      Object.assign(err as object, {
        applied,
        failedVersion: m.version,
        failedName: m.name,
      });
      throw err;
    }
    current = m.version;
    applied.push({ version: m.version, name: m.name });
  }
  return { version: current, applied };
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
  const row = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
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
