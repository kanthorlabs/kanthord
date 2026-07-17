import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./open.ts";
import { SqliteUnitOfWork } from "./sqlite-unit-of-work.ts";

function makeDb(): { db: DatabaseSync; cleanup: () => void } {
  const tmp = mkdtempSync("/tmp/uow-test-");
  const db = openDatabase(join(tmp, "test.db"));
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT NOT NULL)");
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(tmp, { recursive: true });
    },
  };
}

test("SqliteUnitOfWork — two inserts inside transaction both persist", () => {
  const { db, cleanup } = makeDb();
  try {
    const uow = new SqliteUnitOfWork(db);
    uow.transaction(() => {
      db.exec("INSERT INTO items VALUES (1, 'a')");
      db.exec("INSERT INTO items VALUES (2, 'b')");
    });
    const rows = db.prepare("SELECT * FROM items ORDER BY id").all();
    assert.equal(rows.length, 2);
  } finally {
    cleanup();
  }
});

test("SqliteUnitOfWork — fn throw rolls back all writes and propagates error", () => {
  const { db, cleanup } = makeDb();
  try {
    const uow = new SqliteUnitOfWork(db);
    assert.throws(
      () =>
        uow.transaction(() => {
          db.exec("INSERT INTO items VALUES (1, 'a')");
          throw new Error("boom");
        }),
      /boom/,
    );
    const rows = db.prepare("SELECT * FROM items").all();
    assert.equal(rows.length, 0);
  } finally {
    cleanup();
  }
});

test("SqliteUnitOfWork — nested transaction call throws", () => {
  const { db, cleanup } = makeDb();
  try {
    const uow = new SqliteUnitOfWork(db);
    assert.throws(
      () =>
        uow.transaction(() => {
          uow.transaction(() => {
            /* noop */
          });
        }),
      /nested/i,
    );
  } finally {
    cleanup();
  }
});

test("SqliteUnitOfWork — connection is reusable after a rollback", () => {
  const { db, cleanup } = makeDb();
  try {
    const uow = new SqliteUnitOfWork(db);
    // first: rolls back
    assert.throws(() =>
      uow.transaction(() => {
        db.exec("INSERT INTO items VALUES (1, 'x')");
        throw new Error("fail");
      }),
    );
    // second: should commit cleanly
    uow.transaction(() => {
      db.exec("INSERT INTO items VALUES (2, 'y')");
    });
    const rows = db.prepare("SELECT * FROM items ORDER BY id").all();
    assert.equal(rows.length, 1);
    assert.deepEqual((rows[0] as { id: number; val: string }).val, "y");
  } finally {
    cleanup();
  }
});
