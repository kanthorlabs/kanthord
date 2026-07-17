import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./open.ts";
import { SqliteMigrator } from "./sqlite-migrator.ts";
import type { Migration } from "./migrate.ts";

const TOY_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create alpha table",
    up: (db) => db.exec("CREATE TABLE alpha(id TEXT PRIMARY KEY)"),
  },
  {
    version: 2,
    name: "create beta table",
    up: (db) => db.exec("CREATE TABLE beta(id TEXT PRIMARY KEY)"),
  },
];

function withTempDb(run: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-migrator-"));
  try {
    run(join(dir, "kanthord.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("SqliteMigrator.migrate() applies toy migrations and returns the report", () => {
  withTempDb((dbPath) => {
    const db = openDatabase(dbPath);
    try {
      const migrator = new SqliteMigrator(db, TOY_MIGRATIONS);
      const report = migrator.migrate();
      assert.equal(report.version, 2);
      assert.equal(report.applied.length, 2);
      assert.deepEqual(report.applied[0], {
        version: 1,
        name: "create alpha table",
      });
      assert.deepEqual(report.applied[1], {
        version: 2,
        name: "create beta table",
      });
    } finally {
      db.close();
    }
  });
});

test("SqliteMigrator.migrate() re-run returns applied:[]", () => {
  withTempDb((dbPath) => {
    const db = openDatabase(dbPath);
    try {
      const migrator = new SqliteMigrator(db, TOY_MIGRATIONS);
      migrator.migrate();
      const report = migrator.migrate();
      assert.equal(report.version, 2);
      assert.equal(report.applied.length, 0);
    } finally {
      db.close();
    }
  });
});
