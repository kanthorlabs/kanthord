import { test } from "node:test";
import assert from "node:assert/strict";
import type { MigrationReport } from "../../storage/sqlite/migrate.ts";
import type { Migrator } from "../../storage/port.ts";
import { MigrateDb } from "./migrate-db.ts";

const report: MigrationReport = {
  version: 2,
  applied: [
    { version: 1, name: "create_projects" },
    { version: 2, name: "create_tasks" },
  ],
};

class FakeMigrator implements Migrator {
  migrate(): MigrationReport {
    return report;
  }
}

test("MigrateDb.execute() returns the MigrationReport from the Migrator", async () => {
  const uc = new MigrateDb(new FakeMigrator());
  const result = await uc.execute();
  assert.deepEqual(result, report);
});

test("MigrateDb.execute() returns applied:[] when nothing to apply", async () => {
  const emptyReport: MigrationReport = { version: 3, applied: [] };
  class FakeUpToDateMigrator implements Migrator {
    migrate(): MigrationReport {
      return emptyReport;
    }
  }
  const uc = new MigrateDb(new FakeUpToDateMigrator());
  const result = await uc.execute();
  assert.deepEqual(result, emptyReport);
});
