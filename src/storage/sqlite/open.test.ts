import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kanthord-open-test-"));
}

function pragma(db: ReturnType<typeof openDatabase>, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  // SQLite pragma column names vary (e.g. `busy_timeout` pragma returns column `timeout`),
  // so return the first value of the row.
  const values = Object.values(row);
  return values[0];
}

test("creates missing parent directory", () => {
  const base = tmpDir();
  try {
    const nested = join(base, "sub", "dir", "kanthord.db");
    const db = openDatabase(nested);
    db.close();
    // If we reach here, the parent dir was created and the file opened
    assert.ok(true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("journal_mode is wal", () => {
  const base = tmpDir();
  try {
    const db = openDatabase(join(base, "test.db"));
    assert.equal(pragma(db, "journal_mode"), "wal");
    db.close();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("foreign_keys is on (1)", () => {
  const base = tmpDir();
  try {
    const db = openDatabase(join(base, "test.db"));
    assert.equal(pragma(db, "foreign_keys"), 1);
    db.close();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("busy_timeout is 5000", () => {
  const base = tmpDir();
  try {
    const db = openDatabase(join(base, "test.db"));
    assert.equal(pragma(db, "busy_timeout"), 5000);
    db.close();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("second open of same file succeeds and still reports wal", () => {
  const base = tmpDir();
  try {
    const path = join(base, "test.db");
    const db1 = openDatabase(path);
    db1.close();
    const db2 = openDatabase(path);
    assert.equal(pragma(db2, "journal_mode"), "wal");
    db2.close();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
