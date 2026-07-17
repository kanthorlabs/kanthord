import { test } from "node:test";
import assert from "node:assert/strict";

import { MigrateDb } from "../../app/db/migrate-db.ts";
import { GetDbStatus } from "../../app/db/get-db-status.ts";
import type {
  MigrationReport,
  Migrator,
  StatusStore,
} from "../../storage/port.ts";

import { runDbMigrate, runDbStatus } from "./db.ts";

// ---------------------------------------------------------------------------
// Fake Migrator helpers
// ---------------------------------------------------------------------------

class OkMigrator implements Migrator {
  readonly #report: MigrationReport;
  constructor(report: MigrationReport) {
    this.#report = report;
  }
  migrate(): MigrationReport {
    return this.#report;
  }
}

class ThrowingMigrator implements Migrator {
  readonly #applied: Array<{ version: number; name: string }>;
  readonly #failedVersion: number;
  readonly #failedName: string;
  readonly #message: string;
  constructor(
    applied: Array<{ version: number; name: string }>,
    failedVersion: number,
    failedName: string,
    message: string,
  ) {
    this.#applied = applied;
    this.#failedVersion = failedVersion;
    this.#failedName = failedName;
    this.#message = message;
  }
  migrate(): MigrationReport {
    throw Object.assign(new Error(this.#message), {
      applied: this.#applied,
      failedVersion: this.#failedVersion,
      failedName: this.#failedName,
    });
  }
}

// ---------------------------------------------------------------------------
// Fake StatusStore helper
// ---------------------------------------------------------------------------

class FakeStatusStore implements StatusStore {
  readonly path: string;
  readonly #schema: number;
  readonly #mode: string;
  readonly #tables: Array<{ name: string; rows: number }>;
  constructor(
    path: string,
    schema: number,
    mode: string,
    tables: Array<{ name: string; rows: number }>,
  ) {
    this.path = path;
    this.#schema = schema;
    this.#mode = mode;
    this.#tables = tables;
  }
  schemaVersion(): number {
    return this.#schema;
  }
  journalMode(): string {
    return this.#mode;
  }
  tables(): Array<{ name: string; rows: number }> {
    return this.#tables;
  }
  close(): void {}
}

// ---------------------------------------------------------------------------
// runDbMigrate tests
// ---------------------------------------------------------------------------

test("runDbMigrate formats one 'applied: V name' line per entry and exits 0", async () => {
  const report: MigrationReport = {
    version: 2,
    applied: [
      { version: 1, name: "create-projects" },
      { version: 2, name: "create-tasks" },
    ],
  };
  const result = await runDbMigrate(new MigrateDb(new OkMigrator(report)));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, [
    "applied: 1 create-projects",
    "applied: 2 create-tasks",
  ]);
  assert.deepEqual(result.stderr, []);
});

test("runDbMigrate prints 'up to date' when applied is empty and exits 0", async () => {
  const report: MigrationReport = { version: 3, applied: [] };
  const result = await runDbMigrate(new MigrateDb(new OkMigrator(report)));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, ["up to date"]);
  assert.deepEqual(result.stderr, []);
});

test("runDbMigrate on throwing migrator outputs applied lines then error line and exits 1", async () => {
  const result = await runDbMigrate(
    new MigrateDb(
      new ThrowingMigrator(
        [{ version: 1, name: "create-projects" }],
        2,
        "create-tasks",
        "table already exists",
      ),
    ),
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, ["applied: 1 create-projects"]);
  assert.deepEqual(result.stderr, [
    "error: migration 2 create-tasks failed: table already exists",
  ]);
});

// ---------------------------------------------------------------------------
// runDbStatus tests
// ---------------------------------------------------------------------------

test("runDbStatus formats db path, schema, journal_mode, and table rows", async () => {
  const store = new FakeStatusStore("/tmp/test.db", 3, "wal", [
    { name: "events", rows: 5 },
    { name: "tasks", rows: 12 },
  ]);
  const result = await runDbStatus(new GetDbStatus(store));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, [
    "db: /tmp/test.db",
    "schema: 3",
    "journal_mode: wal",
    "events: 5",
    "tasks: 12",
  ]);
  assert.deepEqual(result.stderr, []);
});

test("runDbStatus on unmigrated DB prints only the first three lines", async () => {
  const store = new FakeStatusStore("/tmp/empty.db", 0, "wal", []);
  const result = await runDbStatus(new GetDbStatus(store));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, [
    "db: /tmp/empty.db",
    "schema: 0",
    "journal_mode: wal",
  ]);
  assert.deepEqual(result.stderr, []);
});
