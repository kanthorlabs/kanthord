// src/storage/sqlite/daemon-heartbeat-repository.test.ts — EPIC 014 Story 3
// Real-SQLite tests for the daemon-heartbeat repository adapter. Mirrors the
// `makeTempDb()` harness of `sqlite-project-repository.test.ts:1-40` so a
// missing adapter or a missing migration is RED for the right reason (the
// test name + the source of the failure both point here).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqliteDaemonHeartbeatRepository } from "./daemon-heartbeat-repository.ts";
import type { DaemonHeartbeatRepository } from "../port.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-hb-repo-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

test("SqliteDaemonHeartbeatRepository list() on a fresh database returns []", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo: DaemonHeartbeatRepository = new SqliteDaemonHeartbeatRepository(
    db,
  );
  assert.deepEqual(repo.list(), []);
});

test("SqliteDaemonHeartbeatRepository one beat then list() returns one row with all four fields", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo: DaemonHeartbeatRepository = new SqliteDaemonHeartbeatRepository(
    db,
  );
  repo.beat({
    instanceId: "4242:1000",
    pid: 4242,
    startedAtMs: 1_000,
    atMs: 2_000,
  });

  const rows = repo.list();
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.instanceId, "4242:1000");
  assert.equal(row.pid, 4242);
  assert.equal(row.startedAtMs, 1_000);
  assert.equal(row.lastBeatMs, 2_000);
});

test("SqliteDaemonHeartbeatRepository a second beat with the same instanceId updates lastBeatMs and keeps list().length === 1 (upsert, not insert)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo: DaemonHeartbeatRepository = new SqliteDaemonHeartbeatRepository(
    db,
  );
  repo.beat({
    instanceId: "4242:1000",
    pid: 4242,
    startedAtMs: 1_000,
    atMs: 2_000,
  });
  repo.beat({
    instanceId: "4242:1000",
    pid: 4242,
    startedAtMs: 1_000,
    atMs: 5_000,
  });

  const rows = repo.list();
  assert.equal(
    rows.length,
    1,
    `a second beat for the same instanceId must upsert, not insert a second row; got ${rows.length} rows`,
  );
  assert.equal(rows[0]!.instanceId, "4242:1000");
  assert.equal(rows[0]!.lastBeatMs, 5_000, "the larger atMs must win");
  // pid + startedAtMs are part of the PRIMARY KEY, so they must NOT be overwritten.
  assert.equal(rows[0]!.pid, 4242);
  assert.equal(rows[0]!.startedAtMs, 1_000);
});

test("SqliteDaemonHeartbeatRepository two beats with different instanceIds give two rows — a second daemon is visible, the first is not overwritten", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo: DaemonHeartbeatRepository = new SqliteDaemonHeartbeatRepository(
    db,
  );
  repo.beat({
    instanceId: "4242:1000",
    pid: 4242,
    startedAtMs: 1_000,
    atMs: 2_000,
  });
  repo.beat({
    instanceId: "5151:3000",
    pid: 5151,
    startedAtMs: 3_000,
    atMs: 4_000,
  });

  const rows = repo.list();
  assert.equal(rows.length, 2);
  const ids = rows.map((r) => r.instanceId).sort();
  assert.deepEqual(ids, ["4242:1000", "5151:3000"]);
});

test("SqliteDaemonHeartbeatRepository list() is ordered by instanceId ascending regardless of insert order", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo: DaemonHeartbeatRepository = new SqliteDaemonHeartbeatRepository(
    db,
  );
  // Insert in non-alphabetical order on purpose.
  repo.beat({
    instanceId: "z:100",
    pid: 9,
    startedAtMs: 100,
    atMs: 200,
  });
  repo.beat({
    instanceId: "a:100",
    pid: 1,
    startedAtMs: 100,
    atMs: 200,
  });
  repo.beat({
    instanceId: "m:100",
    pid: 5,
    startedAtMs: 100,
    atMs: 200,
  });

  const rows = repo.list();
  assert.deepEqual(
    rows.map((r) => r.instanceId),
    ["a:100", "m:100", "z:100"],
    "list() must sort by instanceId ASC",
  );
});
