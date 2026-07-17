import type { DatabaseSync } from "node:sqlite";

import type { MigrationReport, Migrator } from "../port.ts";
import { migrate, type Migration } from "./migrate.ts";

/** `node:sqlite` adapter for the `Migrator` port. */
export class SqliteMigrator implements Migrator {
  readonly #db: DatabaseSync;
  readonly #migrations: readonly Migration[];

  constructor(db: DatabaseSync, migrations: readonly Migration[]) {
    this.#db = db;
    this.#migrations = migrations;
  }

  migrate(): MigrationReport {
    return migrate(this.#db, this.#migrations);
  }
}
