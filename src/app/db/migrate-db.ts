import type { MigrationReport, Migrator } from "../../storage/port.ts";

export type { MigrationReport } from "../../storage/port.ts";

/** Apply pending migrations and return the migration report. */
export class MigrateDb {
  readonly #migrator: Migrator;

  constructor(migrator: Migrator) {
    this.#migrator = migrator;
  }

  async execute(): Promise<MigrationReport> {
    return this.#migrator.migrate();
  }
}
