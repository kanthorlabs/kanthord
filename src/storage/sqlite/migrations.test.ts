import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./open.ts";
import { migrate, type MigrationReport } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  return row.user_version;
}

function userTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

function columnNames(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`pragma table_info(${table})`).all() as {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

function insertChain(db: DatabaseSync): {
  projectId: string;
  objectiveId: string;
  taskId: string;
} {
  db.exec(`
    INSERT INTO projects(id, name) VALUES ('proj-1', 'P');
    INSERT INTO initiatives(id, projectId, name) VALUES ('init-1', 'proj-1', 'I');
    INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-1', 'init-1', 'O');
    INSERT INTO tasks(id, objectiveId, title, status) VALUES ('task-1', 'obj-1', 'T', 'pending');
  `);
  return { projectId: "proj-1", objectiveId: "obj-1", taskId: "task-1" };
}

function withMigratedDb(run: (db: DatabaseSync) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-schema-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS);
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── (a) version + tables ─────────────────────────────────────────────────────

test("migrates to version 2 and creates exactly the eight core tables", () => {
  withMigratedDb((db) => {
    assert.equal(userVersion(db), 2);
    assert.deepEqual(userTables(db), [
      "events",
      "initiatives",
      "jobs",
      "objectives",
      "projects",
      "resources",
      "task_dependencies",
      "tasks",
    ]);
  });
});

// ── (b) columns per table ────────────────────────────────────────────────────

test("schema columns match locked DDL for all eight tables", () => {
  withMigratedDb((db) => {
    assert.deepEqual(columnNames(db, "projects"), ["id", "name"]);
    assert.deepEqual(columnNames(db, "resources"), [
      "id",
      "projectId",
      "type",
      "name",
      "attributes",
    ]);
    assert.deepEqual(columnNames(db, "initiatives"), [
      "id",
      "projectId",
      "name",
    ]);
    assert.deepEqual(columnNames(db, "objectives"), [
      "id",
      "initiativeId",
      "name",
    ]);
    assert.deepEqual(columnNames(db, "tasks"), [
      "id",
      "objectiveId",
      "title",
      "status",
    ]);
    assert.deepEqual(columnNames(db, "task_dependencies"), [
      "taskId",
      "dependency",
      "position",
    ]);
    assert.deepEqual(columnNames(db, "jobs"), ["id", "taskId", "status"]);
    assert.deepEqual(columnNames(db, "events"), ["id", "type", "taskId"]);
  });
});

// ── (c) FK enforcement ───────────────────────────────────────────────────────

test("foreign key constraint rejects task with unknown objectiveId", () => {
  withMigratedDb((db) => {
    assert.throws(() => {
      db.prepare(
        "INSERT INTO tasks(id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
      ).run("t1", "nonexistent", "title", "pending");
    });
  });
});

// ── (d) CHECK constraints ────────────────────────────────────────────────────

test("CHECK constraints reject invalid status and type values", () => {
  withMigratedDb((db) => {
    const { projectId, objectiveId, taskId } = insertChain(db);

    // tasks.status CHECK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO tasks(id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
      ).run("t2", objectiveId, "T2", "invalid");
    }, "tasks.status CHECK should reject invalid value");

    // resources.type CHECK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO resources(id, projectId, type, name) VALUES (?, ?, ?, ?)",
      ).run("r1", projectId, "invalid_type", "R");
    }, "resources.type CHECK should reject invalid value");

    // events.type CHECK
    assert.throws(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "e1",
        "invalid.type",
        taskId,
      );
    }, "events.type CHECK should reject invalid value");

    // jobs.status CHECK
    assert.throws(() => {
      db.prepare("INSERT INTO jobs(id, taskId, status) VALUES (?, ?, ?)").run(
        "j1",
        taskId,
        "invalid",
      );
    }, "jobs.status CHECK should reject invalid value");
  });
});

// ── (e) partial unique index ─────────────────────────────────────────────────

test("partial unique index rejects two queued jobs for the same taskId; queued plus running coexist", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);

    db.prepare("INSERT INTO jobs(id, taskId, status) VALUES (?, ?, ?)").run(
      "j1",
      taskId,
      "queued",
    );

    // second queued job for same taskId → rejected by partial unique index
    assert.throws(() => {
      db.prepare("INSERT INTO jobs(id, taskId, status) VALUES (?, ?, ?)").run(
        "j2",
        taskId,
        "queued",
      );
    });

    // queued + running for same taskId must coexist (running is not covered by the partial index)
    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO jobs(id, taskId, status) VALUES (?, ?, ?)").run(
        "j3",
        taskId,
        "running",
      );
    });
  });
});

// ── (f) composite PK ─────────────────────────────────────────────────────────

test("composite primary key rejects duplicate task_dependencies row", () => {
  withMigratedDb((db) => {
    const { objectiveId, taskId } = insertChain(db);

    // insert a second task as the dependency target
    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
    ).run("task-2", objectiveId, "T2", "pending");

    db.prepare(
      "INSERT INTO task_dependencies(taskId, dependency, position) VALUES (?, ?, ?)",
    ).run(taskId, "task-2", 0);

    // duplicate (taskId, dependency) → rejected by composite PK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO task_dependencies(taskId, dependency, position) VALUES (?, ?, ?)",
      ).run(taskId, "task-2", 1);
    });
  });
});

// ── (g) idempotency ──────────────────────────────────────────────────────────

test("re-run of MIGRATIONS returns applied empty (idempotent)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-schema-idem-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS);
    const second: MigrationReport = migrate(db, MIGRATIONS);
    assert.equal(second.version, 2);
    assert.deepEqual(second.applied, []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
