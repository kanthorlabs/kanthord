import type { DatabaseSync } from "node:sqlite";

import type { StatusStore } from "../port.ts";

/** `node:sqlite` adapter for `StatusStore`. Accepts an already-open handle. */
export class SqliteStatusStore implements StatusStore {
  readonly path: string;
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync, path: string) {
    this.#db = db;
    this.path = path;
  }

  schemaVersion(): number {
    const row = this.#db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return row.user_version;
  }

  journalMode(): string {
    const row = this.#db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    return row.journal_mode;
  }

  tables(): Array<{ name: string; rows: number }> {
    const rows = this.#db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => {
      const countRow = this.#db
        .prepare(`SELECT count(*) AS rows FROM "${r.name}"`)
        .get() as { rows: number };
      return { name: r.name, rows: countRow.rows };
    });
  }

  close(): void {
    this.#db.close();
  }
}
