import { DatabaseSync } from "node:sqlite";

import type { StatusStore } from "../port.ts";
import { migrate, type Migration } from "./migrate.ts";

/** `node:sqlite` adapter for `StatusStore`. Opens WAL and migrates on open. */
export class SqliteStatusStore implements StatusStore {
  readonly path: string;
  readonly #db: DatabaseSync;

  constructor(path: string, migrations: readonly Migration[]) {
    this.path = path;
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    migrate(this.#db, migrations);
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

  taskCount(): number {
    const row = this.#db.prepare("SELECT count(*) AS n FROM tasks").get() as {
      n: number;
    };
    return row.n;
  }

  close(): void {
    this.#db.close();
  }
}
