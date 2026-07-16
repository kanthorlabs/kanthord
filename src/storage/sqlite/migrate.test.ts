import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { migrate, type Migration } from "./migrate.ts";

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return row !== undefined;
}

test("applies pending migrations in order and returns the final version", () => {
  const db = new DatabaseSync(":memory:");
  const migrations: Migration[] = [
    { version: 1, name: "a", up: (d) => d.exec("CREATE TABLE a(id)") },
    { version: 2, name: "b", up: (d) => d.exec("CREATE TABLE b(id)") },
  ];
  const final = migrate(db, migrations);
  assert.equal(final, 2);
  assert.equal(userVersion(db), 2);
  assert.ok(tableExists(db, "a"));
  assert.ok(tableExists(db, "b"));
});

test("skips already-applied migrations on re-run (idempotent)", () => {
  const db = new DatabaseSync(":memory:");
  let calls = 0;
  const migrations: Migration[] = [
    { version: 1, name: "a", up: (d) => { calls++; d.exec("CREATE TABLE a(id)"); } },
  ];
  assert.equal(migrate(db, migrations), 1);
  assert.equal(migrate(db, migrations), 1); // second run applies nothing
  assert.equal(calls, 1);
  assert.equal(userVersion(db), 1);
});

test("rolls back a failing migration — no half-applied schema", () => {
  const db = new DatabaseSync(":memory:");
  const migrations: Migration[] = [
    { version: 1, name: "ok", up: (d) => d.exec("CREATE TABLE ok(id)") },
    {
      version: 2,
      name: "boom",
      up: (d) => {
        d.exec("CREATE TABLE boom(id)");
        throw new Error("migration 2 failed");
      },
    },
  ];
  assert.throws(() => migrate(db, migrations), /migration 2 failed/);
  assert.ok(tableExists(db, "ok"), "migration 1 committed");
  assert.equal(tableExists(db, "boom"), false, "migration 2 rolled back");
  assert.equal(userVersion(db), 1, "version stays at last good migration");
});

test("rejects a bad version sequence (gap / not 1..n contiguous)", () => {
  const db = new DatabaseSync(":memory:");
  const migrations: Migration[] = [
    { version: 1, name: "a", up: (d) => d.exec("CREATE TABLE a(id)") },
    { version: 3, name: "c", up: (d) => d.exec("CREATE TABLE c(id)") },
  ];
  assert.throws(() => migrate(db, migrations), /sequence/i);
  assert.equal(userVersion(db), 0, "nothing applied on invalid sequence");
});
