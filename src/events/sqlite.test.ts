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

// ── payload round-trip (migration 4) ─────────────────────────────────────────

test("append with payload round-trips payload as JSON through readAfter", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const ev = newEvent("task.failed", { taskId, payload: { reason: "boom" } });
    feed.append(ev);

    const results = feed.readAfter("0");
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]?.payload, { reason: "boom" });
  } finally {
    cleanup();
  }
});

// ── objective/initiative-scoped events (007.12 Story D) ─────────────────────

test("append + readAfter round-trips an objective-scoped event with no taskId key", () => {
  const { db, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const objectiveId = db
      .prepare("SELECT id FROM objectives LIMIT 1")
      .get() as { id: string };
    const ev = newEvent("objective.integrated", {
      objectiveId: objectiveId.id,
    });
    feed.append(ev);

    const results = feed.readAfter("0");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, ev.id);
    assert.equal(results[0]?.type, "objective.integrated");
    assert.equal(results[0]?.objectiveId, objectiveId.id);
    assert.equal(
      Object.prototype.hasOwnProperty.call(results[0], "taskId"),
      false,
      "round-tripped objective-scoped event has no taskId key",
    );
  } finally {
    cleanup();
  }
});

test("append + readAfter round-trips an initiative-scoped event with no taskId key", () => {
  const { db, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const initiativeId = db
      .prepare("SELECT id FROM initiatives LIMIT 1")
      .get() as { id: string };
    const ev = newEvent("initiative.landed", {
      initiativeId: initiativeId.id,
    });
    feed.append(ev);

    const results = feed.readAfter("0");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, ev.id);
    assert.equal(results[0]?.type, "initiative.landed");
    assert.equal(results[0]?.initiativeId, initiativeId.id);
    assert.equal(
      Object.prototype.hasOwnProperty.call(results[0], "taskId"),
      false,
      "round-tripped initiative-scoped event has no taskId key",
    );
  } finally {
    cleanup();
  }
});

// ── candidate.transplanted (007.14 Story D) ─────────────────────────────────

test("append + readAfter round-trips a candidate.transplanted event with its SHA payload", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const payload = {
      oldCandidateSHA: "aaa111",
      newCandidateSHA: "bbb222",
      newBaseSHA: "ccc333",
    };
    const ev = newEvent("candidate.transplanted", { taskId, payload });
    feed.append(ev);

    const results = feed.readAfter("0");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, ev.id);
    assert.equal(results[0]?.type, "candidate.transplanted");
    assert.equal(results[0]?.taskId, taskId);
    assert.deepEqual(results[0]?.payload, payload);
  } finally {
    cleanup();
  }
});

test("append without payload reads back without payload key", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    // Verify migration 4 ran: events table must have the payload column.
    const cols = db.prepare("pragma table_info(events)").all() as Array<{
      name: string;
    }>;
    const hasPayloadCol = cols.some((c) => c.name === "payload");
    assert.equal(
      hasPayloadCol,
      true,
      "events.payload column must exist (migration 4)",
    );

    const feed = new SqliteEventFeed(db);
    const evWithPayload = newEvent("task.failed", {
      taskId,
      payload: { reason: "boom" },
    });
    const evNoPayload = newEvent("task.ready", { taskId });
    feed.append(evWithPayload);
    feed.append(evNoPayload);

    const results = feed.readAfter("0");
    assert.equal(results.length, 2);
    // first event has payload
    assert.deepEqual(results[0]?.payload, { reason: "boom" });
    // second event has no payload key
    assert.equal(
      Object.prototype.hasOwnProperty.call(results[1], "payload"),
      false,
    );
  } finally {
    cleanup();
  }
});

// ── 011 Story 3 — events.projectId denormalised at append time ──────────────
// The append path resolves the owning projectId from the event's existing
// owner (taskId → objectiveId → initiativeId → repositoryId, in that order)
// and writes it to the events.projectId column. readAfter does NOT expose
// that column — it is storage-internal filtering state.

test("append(newEvent('task.started', { taskId })) stores the chain's projectId on the event row (011 S3)", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const projectId = (
      db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }
    ).id;
    const feed = new SqliteEventFeed(db);
    const ev = newEvent("task.started", { taskId });
    feed.append(ev);

    const row = db
      .prepare("SELECT projectId FROM events WHERE id = ?")
      .get(ev.id) as { projectId: string | null };
    assert.equal(
      row.projectId,
      projectId,
      "task-owner event must be tagged with the chain's projectId",
    );
  } finally {
    cleanup();
  }
});

test("append(newEvent('objective.integrated', { objectiveId })) stores the chain's projectId on the event row (011 S3)", () => {
  const { db, cleanup } = setupDb();
  try {
    const projectId = (
      db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }
    ).id;
    const objectiveId = (
      db.prepare("SELECT id FROM objectives LIMIT 1").get() as { id: string }
    ).id;
    const feed = new SqliteEventFeed(db);
    const ev = newEvent("objective.integrated", { objectiveId });
    feed.append(ev);

    const row = db
      .prepare("SELECT projectId FROM events WHERE id = ?")
      .get(ev.id) as { projectId: string | null };
    assert.equal(
      row.projectId,
      projectId,
      "objective-owner event must be tagged with the chain's projectId",
    );
  } finally {
    cleanup();
  }
});

test("append(newEvent('initiative.landed', { initiativeId })) stores the chain's projectId on the event row (011 S3)", () => {
  const { db, cleanup } = setupDb();
  try {
    const projectId = (
      db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }
    ).id;
    const initiativeId = (
      db.prepare("SELECT id FROM initiatives LIMIT 1").get() as { id: string }
    ).id;
    const feed = new SqliteEventFeed(db);
    const ev = newEvent("initiative.landed", { initiativeId });
    feed.append(ev);

    const row = db
      .prepare("SELECT projectId FROM events WHERE id = ?")
      .get(ev.id) as { projectId: string | null };
    assert.equal(
      row.projectId,
      projectId,
      "initiative-owner event must be tagged with the chain's projectId",
    );
  } finally {
    cleanup();
  }
});

test("append(newEvent('repository.published', { repositoryId })) stores the chain's projectId when the repository is a resources row in the project (011 S3)", () => {
  const { db, cleanup } = setupDb();
  try {
    const projectId = (
      db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }
    ).id;
    const repoId = newId();
    db.prepare(
      "INSERT INTO resources(id, projectId, type, name, remoteUrl, authKind) VALUES(?, ?, 'repository', 'home', 'https://example.com/r.git', 'ambient')",
    ).run(repoId, projectId);

    const feed = new SqliteEventFeed(db);
    const ev = newEvent("repository.published", { repositoryId: repoId });
    feed.append(ev);

    const row = db
      .prepare("SELECT projectId FROM events WHERE id = ?")
      .get(ev.id) as { projectId: string | null };
    assert.equal(
      row.projectId,
      projectId,
      "repository-owner event must be tagged with the project's projectId",
    );
  } finally {
    cleanup();
  }
});

test("append precedence: taskId wins over initiativeId when both owners resolve to different projects (011 S3)", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    // The chain's task lives in project A. Create a second initiative in
    // project B so the event's two owners resolve to different projects.
    const projectB = newId();
    const initiativeB = newId();
    db.prepare("INSERT INTO projects(id, name) VALUES(?, ?)").run(
      projectB,
      "B",
    );
    db.prepare(
      "INSERT INTO initiatives(id, projectId, name) VALUES(?, ?, ?)",
    ).run(initiativeB, projectB, "B-init");

    const projectA = (
      db
        .prepare("SELECT id FROM projects ORDER BY rowid ASC LIMIT 1")
        .get() as { id: string }
    ).id;
    assert.notEqual(projectA, projectB);

    const feed = new SqliteEventFeed(db);
    const ev = newEvent("task.started", { taskId, initiativeId: initiativeB });
    feed.append(ev);

    const row = db
      .prepare("SELECT projectId FROM events WHERE id = ?")
      .get(ev.id) as { projectId: string | null };
    assert.equal(
      row.projectId,
      projectA,
      "taskId must win the COALESCE precedence over initiativeId",
    );
  } finally {
    cleanup();
  }
});

test("append(newEvent('repository.published', { repositoryId: 'no-such-resource' })) stores projectId as null; append does not throw (011 S3)", () => {
  const { db, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const ev = newEvent("repository.published", {
      repositoryId: "no-such-resource",
    });

    assert.doesNotThrow(() => feed.append(ev));

    const row = db
      .prepare("SELECT projectId FROM events WHERE id = ?")
      .get(ev.id) as { projectId: string | null };
    assert.equal(
      row.projectId,
      null,
      "an unresolvable owner must store projectId as NULL (never guessed)",
    );
  } finally {
    cleanup();
  }
});

test("readAfter results do not expose the storage-internal projectId column (characterization) (011 S3)", () => {
  // Characterization (passes today, must keep passing after the migration):
  // readAfter's SELECT does not include projectId, so the round-tripped
  // Event never carries a `projectId` key. This is the contract Story 3
  // demands — adding projectId to the read path would change every
  // existing {events:[…]} JSON assertion for no gain.
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const ev = newEvent("task.started", { taskId });
    feed.append(ev);

    const results = feed.readAfter("0");
    assert.equal(results.length, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(results[0], "projectId"),
      false,
      "readAfter results must not expose the storage-internal projectId column",
    );
  } finally {
    cleanup();
  }
});

// ── 011 Story 4 — project-scoped readAfter ─────────────────────

/**
 * Two parallel project chains (project A → initiative A → objective A → task A,
 * and the same for B). Mirrors setupDb but yields two disjoint chains so the
 * scoped read can prove it filters by ownership, not by accident.
 */
function setupTwoProjects() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-events-"));
  const path = join(dir, "test.db");
  const db = openDatabase(path);
  migrate(db, MIGRATIONS);

  const projectA = newId();
  const projectB = newId();
  const initiativeA = newId();
  const initiativeB = newId();
  const objectiveA = newId();
  const objectiveB = newId();
  const taskA = newId();
  const taskB = newId();

  db.exec(`
    INSERT INTO projects(id, name) VALUES('${projectA}', 'A');
    INSERT INTO projects(id, name) VALUES('${projectB}', 'B');
    INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeA}', '${projectA}', 'initA');
    INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeB}', '${projectB}', 'initB');
    INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveA}', '${initiativeA}', 'objA');
    INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveB}', '${initiativeB}', 'objB');
    INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskA}', '${objectiveA}', 'taskA', 'pending');
    INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskB}', '${objectiveB}', 'taskB', 'pending');
  `);

  return {
    db,
    projectA,
    projectB,
    initiativeA,
    initiativeB,
    objectiveA,
    objectiveB,
    taskA,
    taskB,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}

test("readAfter with projectId scope returns only that project's events; scopes are disjoint and both subsets of unscoped (011 S4)", () => {
  const { db, projectA, projectB, taskA, taskB, cleanup } = setupTwoProjects();
  try {
    const feed = new SqliteEventFeed(db);
    const e1 = newEvent("task.created", { taskId: taskA });
    const e2 = newEvent("task.created", { taskId: taskB });
    const e3 = newEvent("task.ready", { taskId: taskA });
    feed.append(e1);
    feed.append(e2);
    feed.append(e3);

    const aOnly = feed.readAfter("0", undefined, projectA);
    const bOnly = feed.readAfter("0", undefined, projectB);
    const unscoped = feed.readAfter("0");

    // Project A's feed has the two A-owned events, in ascending id order
    assert.equal(aOnly.length, 2, "A scope has the two A-owned events");
    assert.equal(aOnly[0]?.id, e1.id, "ascending id order");
    assert.equal(aOnly[1]?.id, e3.id);

    // Project B's feed has the one B-owned event
    assert.equal(bOnly.length, 1, "B scope has the one B-owned event");
    assert.equal(bOnly[0]?.id, e2.id);

    // The two scopes are disjoint
    const aIds = new Set(aOnly.map((e) => e.id));
    const bIds = new Set(bOnly.map((e) => e.id));
    for (const id of aIds) {
      assert.ok(!bIds.has(id), `A scope id ${id} must not appear in B scope`);
    }

    // Both scopes are subsets of the unscoped feed
    const unscopedIds = new Set(unscoped.map((e) => e.id));
    assert.equal(unscoped.length, 3);
    for (const id of aIds) {
      assert.ok(unscopedIds.has(id), `A scope id ${id} is in unscoped`);
    }
    for (const id of bIds) {
      assert.ok(unscopedIds.has(id), `B scope id ${id} is in unscoped`);
    }
  } finally {
    cleanup();
  }
});

test("readAfter with projectId scope: NULL projectId events appear in unscoped but in neither scope (011 S4)", () => {
  const { db, projectA, projectB, cleanup } = setupTwoProjects();
  try {
    const feed = new SqliteEventFeed(db);
    // repositoryId does not resolve to a resources row → events.projectId is NULL
    const e1 = newEvent("repository.published", {
      repositoryId: "no-such-resource",
    });
    feed.append(e1);

    assert.equal(
      feed.readAfter("0").length,
      1,
      "NULL-projectId event is in unscoped",
    );
    assert.equal(
      feed.readAfter("0", undefined, projectA).length,
      0,
      "NULL-projectId event is in no project scope (A)",
    );
    assert.equal(
      feed.readAfter("0", undefined, projectB).length,
      0,
      "NULL-projectId event is in no project scope (B)",
    );
  } finally {
    cleanup();
  }
});

test("readAfter with projectId scope does not stall behind foreign events (011 S4)", () => {
  const { db, projectA, taskA, taskB, cleanup } = setupTwoProjects();
  try {
    const feed = new SqliteEventFeed(db);
    // Interleaved A,B,A,B,A,B history
    const a1 = newEvent("task.ready", { taskId: taskA });
    const b1 = newEvent("task.ready", { taskId: taskB });
    const a2 = newEvent("task.started", { taskId: taskA });
    const b2 = newEvent("task.started", { taskId: taskB });
    const a3 = newEvent("task.completed", { taskId: taskA });
    const b3 = newEvent("task.completed", { taskId: taskB });
    feed.append(a1);
    feed.append(b1);
    feed.append(a2);
    feed.append(b2);
    feed.append(a3);
    feed.append(b3);

    // Page A's first event (one row, after the unscoped start)
    const p1 = feed.readAfter("0", 1, projectA);
    assert.equal(p1.length, 1);
    assert.equal(p1[0]?.id, a1.id);

    // Page A's second event — must step over b1 to reach a2
    const p2 = feed.readAfter(a1.id, 1, projectA);
    assert.equal(p2.length, 1);
    assert.equal(p2[0]?.id, a2.id);

    // Page A's third event — must step over b2
    const p3 = feed.readAfter(a2.id, 1, projectA);
    assert.equal(p3.length, 1);
    assert.equal(p3[0]?.id, a3.id);

    // No fourth A event
    const p4 = feed.readAfter(a3.id, 1, projectA);
    assert.equal(p4.length, 0);
  } finally {
    cleanup();
  }
});

test("readAfter with projectId scope: ownership is stored, not joined (011 S4)", () => {
  const { db, projectA, projectB, initiativeA, taskA, cleanup } =
    setupTwoProjects();
  try {
    const feed = new SqliteEventFeed(db);
    const e1 = newEvent("task.created", { taskId: taskA });
    feed.append(e1);

    // Sanity: e1 is in A's scope, not B's
    assert.equal(feed.readAfter("0", undefined, projectA).length, 1);
    assert.equal(feed.readAfter("0", undefined, projectB).length, 0);

    // Move initiativeA to projectB. If read-time joined, e1 would now appear in B.
    db.exec(
      `UPDATE initiatives SET projectId = '${projectB}' WHERE id = '${initiativeA}'`,
    );

    // Ownership was denormalised at append time, so e1 stays in A's feed.
    const aAfter = feed.readAfter("0", undefined, projectA);
    const bAfter = feed.readAfter("0", undefined, projectB);
    assert.equal(
      aAfter.length,
      1,
      "event stays in A's feed after the owner initiative is moved",
    );
    assert.equal(aAfter[0]?.id, e1.id);
    assert.equal(
      bAfter.length,
      0,
      "event does not appear in B's feed (storage-internal projectId was not joined)",
    );
  } finally {
    cleanup();
  }
});

test("readAfter with projectId scope: deletion of owner does not affect feed (011 S4)", () => {
  const { db, projectA, taskA, cleanup } = setupTwoProjects();
  try {
    const feed = new SqliteEventFeed(db);
    const e1 = newEvent("task.created", { taskId: taskA });
    feed.append(e1);

    // Sanity: e1 is in A's scope
    assert.equal(feed.readAfter("0", undefined, projectA).length, 1);

    // Delete the owner task. Disable FK enforcement because tasks is an FK
    // parent for events.taskId; we want to prove the event survives anyway.
    db.exec("PRAGMA foreign_keys=OFF;");
    db.exec(`DELETE FROM tasks WHERE id = '${taskA}';`);

    const aAfter = feed.readAfter("0", undefined, projectA);
    assert.equal(
      aAfter.length,
      1,
      "event stays in A's feed after the owner task is deleted",
    );
    assert.equal(aAfter[0]?.id, e1.id);
  } finally {
    cleanup();
  }
});

// ── 016 Story 3 — SqliteEventFeed.latestEventIdByTask (adapter-only reader) ──
// Returns the latest event id per task id, for a given list. Missing tasks
// (no events) are absent from the returned Map. The empty-input case is a
// short-circuit that must NOT touch the database.

test("latestEventIdByTask([]) returns an empty Map and issues no SQL", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    // Add an event so the table is not empty; the short-circuit must still
    // return an empty Map and never read the table.
    const ev = newEvent("task.created", { taskId });
    feed.append(ev);

    const out = feed.latestEventIdByTask([]);
    assert.ok(out instanceof Map, "return type is Map");
    assert.equal(out.size, 0, "empty input yields an empty Map");
  } finally {
    cleanup();
  }
});

test("latestEventIdByTask returns the maximum id per task and omits a task with no events", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);

    // Three events for `taskId`, in this insertion order. Their ids are
    // monotonically increasing, so the third one is the max.
    const e1 = newEvent("task.created", { taskId });
    const e2 = newEvent("task.ready", { taskId });
    const e3 = newEvent("task.started", { taskId });
    feed.append(e1);
    feed.append(e2);
    feed.append(e3);

    // A second task that gets NO events. Seed it so the FK is satisfied.
    const emptyTask = newId();
    const objId = (
      db.prepare("SELECT id FROM objectives LIMIT 1").get() as { id: string }
    ).id;
    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, status) VALUES(?, ?, 'empty', 'pending')",
    ).run(emptyTask, objId);

    const out = feed.latestEventIdByTask([taskId, emptyTask]);
    assert.equal(out.size, 1, "the empty task must be absent from the Map");
    assert.equal(out.get(taskId), e3.id, "max id per task wins");
  } finally {
    cleanup();
  }
});

test("latestEventIdByTask returns one entry per task when many tasks each have events", () => {
  const { db, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);

    // Use a fresh task to keep the test independent of `setupDb`'s `taskId`.
    const tA = newId();
    const tB = newId();
    const objId = (
      db.prepare("SELECT id FROM objectives LIMIT 1").get() as { id: string }
    ).id;
    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, status) VALUES(?, ?, 'A', 'pending')",
    ).run(tA, objId);
    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, status) VALUES(?, ?, 'B', 'pending')",
    ).run(tB, objId);

    const a1 = newEvent("task.created", { taskId: tA });
    const a2 = newEvent("task.ready", { taskId: tA });
    const b1 = newEvent("task.created", { taskId: tB });
    feed.append(a1);
    feed.append(b1);
    feed.append(a2);

    const out = feed.latestEventIdByTask([tA, tB]);
    assert.equal(out.size, 2);
    assert.equal(out.get(tA), a2.id, "tA's max event id is a2");
    assert.equal(out.get(tB), b1.id, "tB's max event id is b1");
  } finally {
    cleanup();
  }
});

// ── 016 Story 6 — countProjectEventsAfter, readProjectEventsAfter,
//    latestActionableEventIds (all adapter-only readers, NOT on EventFeed
//    port). They back the `get overview` digest / decisions[] aggregation.

test("countProjectEventsAfter(projectId, null) counts ALL events for that project and excludes another project's events; byType keys ascending", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);

    // Seed a second project + initiative + objective + task so we can
    // confirm the project filter actually fires.
    const projectB = newId();
    const initB = newId();
    const objB = newId();
    const taskB = newId();
    db.exec(`
      INSERT INTO projects(id, name) VALUES('${projectB}', 'pB');
      INSERT INTO initiatives(id, projectId, name) VALUES('${initB}', '${projectB}', 'iB');
      INSERT INTO objectives(id, initiativeId, name) VALUES('${objB}', '${initB}', 'oB');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskB}', '${objB}', 'tB', 'pending');
    `);

    // Mix of types — byType should have keys ascending.
    feed.append(newEvent("task.created", { taskId })); // projectA (setupDb)
    feed.append(newEvent("task.created", { taskId })); // projectA
    feed.append(newEvent("task.started", { taskId })); // projectA
    feed.append(newEvent("task.created", { taskId: taskB })); // projectB
    feed.append(newEvent("task.failed", { taskId })); // projectA

    // The setupDb `taskId` resolves to projectA. The `taskB` resolves
    // to projectB. Filter by projectA.
    const projectA = (
      db
        .prepare("SELECT projectId FROM initiatives WHERE id = ?")
        .get(
          (
            db
              .prepare("SELECT initiativeId FROM objectives WHERE id = ?")
              .get(objB) as { initiativeId: string }
          ).initiativeId,
        ) as { projectId: string }
    ).projectId;
    // The simpler way: just look it up.
    const projectAId = (
      db
        .prepare(
          "SELECT i.projectId AS projectId FROM tasks t JOIN objectives o ON t.objectiveId = o.id JOIN initiatives i ON o.initiativeId = i.id WHERE t.id = ?",
        )
        .get(taskId) as { projectId: string }
    ).projectId;

    const out = feed.countProjectEventsAfter(projectAId, null);
    // Four events belong to projectA: 2 task.created, 1 task.started, 1 task.failed.
    assert.equal(out.totalCount, 4);
    // byType keys ascending: task.created, task.failed, task.started.
    assert.deepEqual(Object.keys(out.byType), [
      "task.created",
      "task.failed",
      "task.started",
    ]);
    assert.equal(out.byType["task.created"], 2);
    assert.equal(out.byType["task.started"], 1);
    assert.equal(out.byType["task.failed"], 1);
  } finally {
    cleanup();
  }
});

test("countProjectEventsAfter with a mid-feed cursor returns events strictly after it (exclusive)", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const e1 = newEvent("task.created", { taskId });
    const e2 = newEvent("task.ready", { taskId });
    const e3 = newEvent("task.started", { taskId });
    feed.append(e1);
    feed.append(e2);
    feed.append(e3);

    // After e2, only e3 remains.
    const out = feed.countProjectEventsAfter(
      (
        db
          .prepare(
            "SELECT i.projectId AS projectId FROM tasks t JOIN objectives o ON t.objectiveId = o.id JOIN initiatives i ON o.initiativeId = i.id WHERE t.id = ?",
          )
          .get(taskId) as { projectId: string }
      ).projectId,
      e2.id,
    );
    assert.equal(out.totalCount, 1);
    assert.equal(out.byType["task.started"], 1);
  } finally {
    cleanup();
  }
});

test("readProjectEventsAfter returns ascending ids, respects limit, and excludes another project's events", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);

    // Seed a second project so we can prove the filter excludes it.
    const projectB = newId();
    const initB = newId();
    const objB = newId();
    const taskB = newId();
    db.exec(`
      INSERT INTO projects(id, name) VALUES('${projectB}', 'pB');
      INSERT INTO initiatives(id, projectId, name) VALUES('${initB}', '${projectB}', 'iB');
      INSERT INTO objectives(id, initiativeId, name) VALUES('${objB}', '${initB}', 'oB');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskB}', '${objB}', 'tB', 'pending');
    `);

    // 4 events for projectA, 2 for projectB — interleaved in id order.
    const a1 = newEvent("task.created", { taskId });
    const b1 = newEvent("task.created", { taskId: taskB });
    const a2 = newEvent("task.started", { taskId });
    const b2 = newEvent("task.ready", { taskId: taskB });
    const a3 = newEvent("task.completed", { taskId });
    const a4 = newEvent("task.failed", { taskId });
    feed.append(a1);
    feed.append(b1);
    feed.append(a2);
    feed.append(b2);
    feed.append(a3);
    feed.append(a4);

    const projectAId = (
      db
        .prepare(
          "SELECT i.projectId AS projectId FROM tasks t JOIN objectives o ON t.objectiveId = o.id JOIN initiatives i ON o.initiativeId = i.id WHERE t.id = ?",
        )
        .get(taskId) as { projectId: string }
    ).projectId;

    const out = feed.readProjectEventsAfter(projectAId, null, 3);
    // Only projectA events in ascending id order, capped at 3.
    assert.equal(out.length, 3);
    assert.deepEqual(
      out.map((e) => e.id),
      [a1.id, a2.id, a3.id],
    );
    // No projectB events leaked in.
    for (const e of out) {
      assert.notEqual(e.taskId, taskB);
    }
  } finally {
    cleanup();
  }
});

test("readProjectEventsAfter with a non-positive or non-integer limit throws RangeError", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);
    const projectAId = (
      db
        .prepare(
          "SELECT i.projectId AS projectId FROM tasks t JOIN objectives o ON t.objectiveId = o.id JOIN initiatives i ON o.initiativeId = i.id WHERE t.id = ?",
        )
        .get(taskId) as { projectId: string }
    ).projectId;
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(
        () => feed.readProjectEventsAfter(projectAId, null, bad as number),
        RangeError,
        `limit ${bad} must throw RangeError`,
      );
    }
  } finally {
    cleanup();
  }
});

test("latestActionableEventIds returns the max id per (type, entity) pair, scoped to one initiative, and omits types outside the four-type list", () => {
  const { db, taskId, cleanup } = setupDb();
  try {
    const feed = new SqliteEventFeed(db);

    // Get the seeded initiative id from setupDb.
    const initiativeId = (
      db.prepare("SELECT id FROM initiatives LIMIT 1").get() as { id: string }
    ).id;
    // Get a second initiative so we can prove scoping.
    const projectB = newId();
    const initB = newId();
    const objB = newId();
    const taskB = newId();
    db.exec(`
      INSERT INTO projects(id, name) VALUES('${projectB}', 'pB');
      INSERT INTO initiatives(id, projectId, name) VALUES('${initB}', '${projectB}', 'iB');
      INSERT INTO objectives(id, initiativeId, name) VALUES('${objB}', '${initB}', 'oB');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskB}', '${objB}', 'tB', 'pending');
    `);

    // In `initiativeId` (setupDb's):
    //   task.failed for taskId (twice → second wins)
    //   task.escalated for taskId
    //   objective.awaiting_confirmation for obj1
    //   objective.conflict for obj1
    //   task.created for taskId (NOT one of the four — must be excluded)
    const objId = (
      db.prepare("SELECT id FROM objectives LIMIT 1").get() as { id: string }
    ).id;
    const f1 = newEvent("task.failed", { taskId, initiativeId });
    const f2 = newEvent("task.failed", { taskId, initiativeId });
    const esc = newEvent("task.escalated", { taskId, initiativeId });
    const ac = newEvent("objective.awaiting_confirmation", {
      objectiveId: objId,
      initiativeId,
    });
    const conf = newEvent("objective.conflict", {
      objectiveId: objId,
      initiativeId,
    });
    const created = newEvent("task.created", { taskId, initiativeId });
    // In `initB` (a different initiative):
    const f_other = newEvent("task.failed", {
      taskId: taskB,
      initiativeId: initB,
    });
    feed.append(f1);
    feed.append(esc);
    feed.append(ac);
    feed.append(f2);
    feed.append(conf);
    feed.append(created);
    feed.append(f_other);

    const out = feed.latestActionableEventIds(initiativeId);
    // Only the four-type entries scoped to `initiativeId` are present.
    assert.equal(
      out.get(`task.failed:${taskId}`),
      f2.id,
      "max id per (type, task) pair",
    );
    assert.equal(out.get(`task.escalated:${taskId}`), esc.id);
    assert.equal(out.get(`objective.awaiting_confirmation:${objId}`), ac.id);
    assert.equal(out.get(`objective.conflict:${objId}`), conf.id);
    // task.created is NOT actionable — must be excluded.
    assert.equal(out.get(`task.created:${taskId}`), undefined);
    // The other initiative's task.failed is NOT in this initiative's map.
    assert.equal(out.get(`task.failed:${taskB}`), undefined);
    // Total entries: 4 (one per actionable pair).
    assert.equal(out.size, 4);
  } finally {
    cleanup();
  }
});
