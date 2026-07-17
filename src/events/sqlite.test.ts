import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../storage/sqlite/open.ts";
import { migrate } from "../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../storage/sqlite/migrations.ts";
import { newEvent } from "../domain/event.ts";
import { newId } from "../domain/entity.ts";
import { SqliteEventFeed } from "./sqlite.ts";

/**
 * Creates a temp DB with all migrations applied and one task row seeded
 * (project → initiative → objective → task) so FK constraints on events.taskId
 * are satisfied. Returns { db, taskId, cleanup }.
 */
function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-events-"));
  const path = join(dir, "test.db");
  const db = openDatabase(path);
  migrate(db, MIGRATIONS);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();
  const taskId = newId();

  db.exec(`
    INSERT INTO projects(id, name) VALUES('${projectId}', 'proj');
    INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeId}', '${projectId}', 'init');
    INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveId}', '${initiativeId}', 'obj');
    INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskId}', '${objectiveId}', 'task1', 'pending');
  `);

  return {
    db,
    taskId,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}

test("readAfter('0') returns all three events in id order", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const e1 = newEvent("task.created", { taskId });
    const e2 = newEvent("task.ready", { taskId });
    const e3 = newEvent("task.started", { taskId });
    feed.append(e1);
    feed.append(e2);
    feed.append(e3);

    const results = feed.readAfter("0");
    assert.equal(results.length, 3);
    assert.equal(results[0]?.id, e1.id);
    assert.equal(results[1]?.id, e2.id);
    assert.equal(results[2]?.id, e3.id);
  } finally {
    cleanup();
  }
});

test("readAfter with cursor returns only new events", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const e1 = newEvent("task.created", { taskId });
    const e2 = newEvent("task.ready", { taskId });
    const e3 = newEvent("task.started", { taskId });
    feed.append(e1);
    feed.append(e2);
    feed.append(e3);

    const cursor = e3.id;
    const e4 = newEvent("task.completed", { taskId });
    const e5 = newEvent("task.failed", { taskId });
    feed.append(e4);
    feed.append(e5);

    const results = feed.readAfter(cursor);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.id, e4.id);
    assert.equal(results[1]?.id, e5.id);
  } finally {
    cleanup();
  }
});

test("readAfter latest id returns []", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const e1 = newEvent("task.created", { taskId });
    feed.append(e1);

    const results = feed.readAfter(e1.id);
    assert.equal(results.length, 0);
  } finally {
    cleanup();
  }
});

test("paging with interleaved append yields each event exactly once", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    // Append 3 events initially
    const e1 = newEvent("task.created", { taskId });
    const e2 = newEvent("task.ready", { taskId });
    const e3 = newEvent("task.started", { taskId });
    feed.append(e1);
    feed.append(e2);
    feed.append(e3);

    // Poll 1: page size 2 — should get e1, e2
    let cursor = "0";
    const page1 = feed.readAfter(cursor, 2);
    assert.equal(page1.length, 2);
    assert.equal(page1[0]?.id, e1.id);
    assert.equal(page1[1]?.id, e2.id);
    cursor = page1[1]!.id;

    // Interleaved append: e4 and e5 added between polls
    const e4 = newEvent("task.completed", { taskId });
    const e5 = newEvent("task.failed", { taskId });
    feed.append(e4);
    feed.append(e5);

    // Poll 2: page size 2 — should get e3, e4
    const page2 = feed.readAfter(cursor, 2);
    assert.equal(page2.length, 2);
    assert.equal(page2[0]?.id, e3.id);
    assert.equal(page2[1]?.id, e4.id);
    cursor = page2[1]!.id;

    // Poll 3: page size 2 — should get e5 only
    const page3 = feed.readAfter(cursor, 2);
    assert.equal(page3.length, 1);
    assert.equal(page3[0]?.id, e5.id);
    cursor = page3[0]!.id;

    // Poll 4: nothing left
    const page4 = feed.readAfter(cursor, 2);
    assert.equal(page4.length, 0);

    // Verify union is exactly all 5 events, no duplicates
    const seen = [
      ...page1.map((e) => e.id),
      ...page2.map((e) => e.id),
      ...page3.map((e) => e.id),
    ];
    assert.equal(seen.length, 5);
    assert.deepEqual(new Set(seen).size, 5);
  } finally {
    cleanup();
  }
});

test("limit 0 throws RangeError", () => {
  const { db, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    assert.throws(() => feed.readAfter("0", 0), RangeError);
  } finally {
    cleanup();
  }
});

test("limit -1 throws RangeError", () => {
  const { db, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    assert.throws(() => feed.readAfter("0", -1), RangeError);
  } finally {
    cleanup();
  }
});

test("limit 1.5 throws RangeError", () => {
  const { db, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    assert.throws(() => feed.readAfter("0", 1.5), RangeError);
  } finally {
    cleanup();
  }
});
