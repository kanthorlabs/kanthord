import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteStatusStore } from "./sqlite-status-store.ts";
import type { Migration } from "./migrate.ts";

// Toy registry: proves the migration list is injected. `tasks` must exist for
// taskCount() to work, so the toy migration creates it (mirrors migration 1).
const TOY_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create tasks table",
    up: (d) => d.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY)"),
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

test("SqliteStatusStore opens in WAL at schema 1 with zero tasks", () => {
  withTempDb((dbPath) => {
    const store = new SqliteStatusStore(dbPath, TOY_MIGRATIONS);
    try {
      assert.equal(store.path, dbPath);
      assert.equal(store.journalMode(), "wal");
      assert.equal(store.schemaVersion(), 1);
      assert.equal(store.taskCount(), 0);
    } finally {
      store.close();
    }
  });
});

test("close() releases the handle", () => {
  withTempDb((dbPath) => {
    const store = new SqliteStatusStore(dbPath, TOY_MIGRATIONS);
    store.close();
    assert.throws(() => store.schemaVersion());
  });
});

test("re-opening the same file is an idempotent no-op", () => {
  withTempDb((dbPath) => {
    new SqliteStatusStore(dbPath, TOY_MIGRATIONS).close();
    const store = new SqliteStatusStore(dbPath, TOY_MIGRATIONS);
    try {
      assert.equal(store.schemaVersion(), 1);
      assert.equal(store.taskCount(), 0);
    } finally {
      store.close();
    }
  });
});
