import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

/**
 * Regression test for the confirmed cause of the intermittent
 * "exact race: exactly one child claims, one sees empty" failure
 * (src/queue/sqlite.test.ts): `busy_timeout` used to be set AFTER
 * `journal_mode=WAL`, so the WAL switch ran with SQLite's default busy timeout
 * of 0 and died instantly with SQLITE_BUSY whenever another connection held a
 * lock at that moment. The observed failure named open.ts's `journal_mode` line
 * directly.
 *
 * Deterministic by construction: a child process holds a RESERVED lock for
 * `HOLD_MS`, and the parent starts its open while that lock is held. With
 * `busy_timeout` set first the open waits and succeeds; with it set last the
 * open throws "database is locked" immediately. No reliance on winning a race.
 */
test("open waits for a contended lock instead of failing instantly", async () => {
  const base = tmpDir();
  const HOLD_MS = 400;
  const dbPath = join(base, "contended.db");
  const holderPath = fileURLToPath(
    new URL("./lock-holder.test-helper.ts", import.meta.url),
  );

  const child = spawn(
    "node",
    [holderPath, "--db", dbPath, "--hold-ms", String(HOLD_MS)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let childStderr = "";
  child.stderr.on("data", (c: Buffer) => {
    childStderr += c.toString();
  });

  try {
    // Wait for the child to report that it holds the lock.
    await new Promise<void>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (c: Buffer) => {
        out += c.toString();
        if (out.includes("locked")) resolve();
      });
      child.on("close", (code) =>
        reject(
          new Error(
            `lock holder exited (${code}) before signalling; stderr: ${childStderr.trim() || "(empty)"}`,
          ),
        ),
      );
      child.on("error", reject);
    });

    // The lock is held right now. This open must survive it.
    const started = Date.now();
    const db = openDatabase(dbPath);
    const waited = Date.now() - started;

    assert.equal(pragma(db, "journal_mode"), "wal");
    assert.ok(
      waited >= 1,
      `expected the open to have waited on the lock, but it returned in ${waited}ms`,
    );
    db.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    rmSync(base, { recursive: true, force: true });
  }
});
