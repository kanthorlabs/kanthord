import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./open.ts";
import { SqliteStatusStore } from "./sqlite-status-store.ts";
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
  const dir = mkdtempSync(join(tmpdir(), "kanthord-store-"));
  try {
    run(join(dir, "kanthord.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("SqliteStatusStore schemaVersion() is 0 on a fresh DB", () => {
  withTempDb((dbPath) => {
    const db = openDatabase(dbPath);
    try {
      const store = new SqliteStatusStore(db, dbPath);
      assert.equal(store.path, dbPath);
      assert.equal(store.schemaVersion(), 0);
    } finally {
      db.close();
    }
  });
});

test("SqliteStatusStore journalMode() is wal", () => {
  withTempDb((dbPath) => {
    const db = openDatabase(dbPath);
    try {
      const store = new SqliteStatusStore(db, dbPath);
      assert.equal(store.journalMode(), "wal");
    } finally {
      db.close();
    }
  });
});

test("SqliteStatusStore tables() lists user tables with row count, alphabetical", () => {
  withTempDb((dbPath) => {
    const db = openDatabase(dbPath);
    try {
      new SqliteMigrator(db, TOY_MIGRATIONS).migrate();
      // Insert one row into alpha, none into beta.
      db.exec("INSERT INTO alpha(id) VALUES ('a1')");
      const store = new SqliteStatusStore(db, dbPath);
      const tables = store.tables();
      assert.equal(tables.length, 2);
      assert.deepEqual(tables[0], { name: "alpha", rows: 1 });
      assert.deepEqual(tables[1], { name: "beta", rows: 0 });
    } finally {
      db.close();
    }
  });
});

test("SqliteStatusStore tables() returns [] on unmigrated DB", () => {
  withTempDb((dbPath) => {
    const db = openDatabase(dbPath);
    try {
      const store = new SqliteStatusStore(db, dbPath);
      assert.deepEqual(store.tables(), []);
    } finally {
      db.close();
    }
  });
});

test("close() releases the handle", () => {
  withTempDb((dbPath) => {
    const db = openDatabase(dbPath);
    const store = new SqliteStatusStore(db, dbPath);
    store.close();
    assert.throws(() => store.schemaVersion());
  });
});
