// src/storage/sqlite/project-ack.test.ts — SqliteProjectAckRepository
// (016 Story 5: per-project last-acknowledged event cursor).
//
// Pure hermetic tests against a temp SQLite database migrated from the full
// `MIGRATIONS` set. The cursor is a ULID; `latestProjectEventId` is the
// "ahead of the feed" oracle for `AckProject` and must ignore other
// projects' events.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqliteProjectAckRepository } from "./project-ack.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-project-ack-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir, repo: new SqliteProjectAckRepository(db) };
}

test("SqliteProjectAckRepository: getAck on an unknown project returns undefined", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(
    repo.getAck("proj-missing"),
    undefined,
    "a project with no row in project_acks must return undefined",
  );
});

test("SqliteProjectAckRepository: setAck then getAck round-trips the cursor", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Real ULIDs (Crockford base32, 26 chars).
  const cursorA = "01H1234567890ABCDEFGHJKMNP";
  const cursorB = "01JZZZZZZZZZZZZZZZZZZZZZZZ";

  db.exec(`INSERT INTO projects(id, name) VALUES ('proj-1', 'P')`);

  repo.setAck("proj-1", cursorA);
  assert.equal(
    repo.getAck("proj-1"),
    cursorA,
    "getAck must return the value just stored",
  );

  repo.setAck("proj-1", cursorB);
  assert.equal(
    repo.getAck("proj-1"),
    cursorB,
    "setAck must overwrite the prior value for the same project",
  );
});

test("SqliteProjectAckRepository: setAck twice for the same project overwrites (one row, latest value)", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  db.exec(`INSERT INTO projects(id, name) VALUES ('proj-1', 'P')`);

  repo.setAck("proj-1", "01H1234567890ABCDEFGHJKMNP");
  repo.setAck("proj-1", "01HZZZZZZZZZZZZZZZZZZZZZZZ");

  // The PRIMARY KEY is projectId, so the table holds exactly one row.
  const rows = db
    .prepare("SELECT cursor FROM project_acks WHERE projectId = ?")
    .all("proj-1") as { cursor: string }[];
  assert.equal(rows.length, 1, "exactly one row per project (PK constraint)");
  assert.equal(rows[0]!.cursor, "01HZZZZZZZZZZZZZZZZZZZZZZZ");
});

test("SqliteProjectAckRepository: getAck is per-project (no cross-project leak)", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  db.exec(`
    INSERT INTO projects(id, name) VALUES ('proj-1', 'P1');
    INSERT INTO projects(id, name) VALUES ('proj-2', 'P2');
  `);

  repo.setAck("proj-1", "01H11111111111111111111111");
  repo.setAck("proj-2", "01H22222222222222222222222");

  assert.equal(repo.getAck("proj-1"), "01H11111111111111111111111");
  assert.equal(repo.getAck("proj-2"), "01H22222222222222222222222");
  assert.equal(
    repo.getAck("proj-3"),
    undefined,
    "an unknown project returns undefined",
  );
});

test("SqliteProjectAckRepository: latestProjectEventId returns undefined for a project with no events", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  db.exec(`INSERT INTO projects(id, name) VALUES ('proj-1', 'P')`);

  assert.equal(
    repo.latestProjectEventId("proj-1"),
    undefined,
    "a project with zero events must return undefined",
  );
});

test("SqliteProjectAckRepository: latestProjectEventId returns the maximum id per project, ignoring another project's higher id", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  db.exec(`
    INSERT INTO projects(id, name) VALUES ('proj-1', 'P1');
    INSERT INTO projects(id, name) VALUES ('proj-2', 'P2');
  `);

  // proj-1: three events, ascending ids.
  db.prepare("INSERT INTO events(id, type, projectId) VALUES (?, ?, ?)").run(
    "01H00000000000000000000001",
    "task.created",
    "proj-1",
  );
  db.prepare("INSERT INTO events(id, type, projectId) VALUES (?, ?, ?)").run(
    "01H00000000000000000000002",
    "task.completed",
    "proj-1",
  );
  db.prepare("INSERT INTO events(id, type, projectId) VALUES (?, ?, ?)").run(
    "01H00000000000000000000003",
    "task.failed",
    "proj-1",
  );

  // proj-2: one event whose ULID is HIGHER than proj-1's max — must NOT
  // leak into the proj-1 lookup.
  db.prepare("INSERT INTO events(id, type, projectId) VALUES (?, ?, ?)").run(
    "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    "task.created",
    "proj-2",
  );

  assert.equal(
    repo.latestProjectEventId("proj-1"),
    "01H00000000000000000000003",
    "max(id) for proj-1 only — the higher proj-2 id must be ignored",
  );
  assert.equal(
    repo.latestProjectEventId("proj-2"),
    "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    "max(id) for proj-2 is its sole event",
  );
});

test("SqliteProjectAckRepository: latestProjectEventId on an unknown project returns undefined", () => {
  const { db, dir, repo } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(
    repo.latestProjectEventId("proj-missing"),
    undefined,
    "a project that has no row in events must return undefined",
  );
});
