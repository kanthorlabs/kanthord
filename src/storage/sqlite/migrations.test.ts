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

test("migrates to version 6 and creates exactly eleven core tables", () => {
  withMigratedDb((db) => {
    assert.equal(userVersion(db), 6);
    assert.deepEqual(userTables(db), [
      "events",
      "graph_import_map",
      "initiatives",
      "jobs",
      "objectives",
      "projects",
      "resources",
      "task_context",
      "task_dependencies",
      "task_results",
      "tasks",
    ]);
  });
});

// ── (b) columns per table ────────────────────────────────────────────────────

test("schema columns match locked DDL for all eleven tables", () => {
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
      "paused",
      "sha256",
    ]);
    assert.deepEqual(columnNames(db, "objectives"), [
      "id",
      "initiativeId",
      "name",
      "sha256",
    ]);
    assert.deepEqual(columnNames(db, "tasks"), [
      "id",
      "objectiveId",
      "title",
      "status",
      "agent",
      "instructions",
      "ac",
      "verification",
      "sha256",
    ]);
    assert.deepEqual(columnNames(db, "task_dependencies"), [
      "taskId",
      "dependency",
      "position",
    ]);
    assert.deepEqual(columnNames(db, "jobs"), ["id", "taskId", "status"]);
    assert.deepEqual(columnNames(db, "events"), [
      "id",
      "type",
      "taskId",
      "payload",
    ]);
    assert.deepEqual(columnNames(db, "task_context"), [
      "task_id",
      "type",
      "resource_id",
    ]);
    assert.deepEqual(columnNames(db, "task_results"), [
      "task_id",
      "workspace",
      "branch",
      "base_commit",
      "proposal_commit",
      "commit_sha",
      "summary",
      "reason",
      "rejection_resolution",
      "rejection_reason",
      "evidence",
    ]);
    assert.deepEqual(columnNames(db, "graph_import_map"), [
      "package_id",
      "kind",
      "ref",
      "objective_id",
      "task_id",
      "creation_sha",
    ]);
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
    assert.equal(second.version, 6);
    assert.deepEqual(second.applied, []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (h) migration 4 — paused CHECK constraint ────────────────────────────────

test("initiatives.paused CHECK constraint rejects value 2", () => {
  withMigratedDb((db) => {
    db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
      "proj-p",
      "P",
    );

    // paused = 0 must be accepted
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO initiatives(id, projectId, name, paused) VALUES (?, ?, ?, ?)",
      ).run("init-ok", "proj-p", "I", 0);
    }, "paused = 0 should be accepted");

    // paused = 1 must be accepted
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO initiatives(id, projectId, name, paused) VALUES (?, ?, ?, ?)",
      ).run("init-ok2", "proj-p", "I2", 1);
    }, "paused = 1 should be accepted");

    // paused = 2 must be rejected
    assert.throws(() => {
      db.prepare(
        "INSERT INTO initiatives(id, projectId, name, paused) VALUES (?, ?, ?, ?)",
      ).run("init-bad", "proj-p", "I3", 2);
    }, "paused = 2 should be rejected by CHECK constraint");
  });
});

// ── (i) migration 5 — new task statuses ─────────────────────────────────────

test("migration 5 allows awaiting_confirmation and discarded as task statuses", () => {
  withMigratedDb((db) => {
    const { objectiveId } = insertChain(db);

    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO tasks(id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
      ).run("t-awc", objectiveId, "T-AWC", "awaiting_confirmation");
    }, "awaiting_confirmation must be a valid status after migration 5");

    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO tasks(id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
      ).run("t-disc", objectiveId, "T-DISC", "discarded");
    }, "discarded must be a valid status after migration 5");
  });
});

// ── (j) migration 5 — pre-existing row defaults ──────────────────────────────

test("migration 5 pre-existing task row reads back with agent generic@1, instructions empty, ac empty array, verification null", () => {
  withMigratedDb((db) => {
    const { objectiveId } = insertChain(db);

    // insert a task using only the pre-migration-5 columns (no agent/instructions/ac/verification supplied)
    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, status) VALUES (?, ?, ?, ?)",
    ).run("task-pre5", objectiveId, "Old task", "pending");

    type Pre5Row = {
      agent: string;
      instructions: string;
      ac: string;
      verification: string | null;
    };
    const row = db
      .prepare(
        "SELECT agent, instructions, ac, verification FROM tasks WHERE id = ?",
      )
      .get("task-pre5") as Pre5Row;

    assert.equal(row.agent, "generic@1");
    assert.equal(row.instructions, "");
    assert.equal(row.ac, "[]");
    assert.equal(row.verification, null);
  });
});

// ── (k) migration 6 — graph_import_map exactly-one CHECK ────────────────────

test("migration 6 graph_import_map accepts a valid task row and rejects both-ids or neither-ids (exactly-one CHECK)", () => {
  withMigratedDb((db) => {
    const { objectiveId, taskId } = insertChain(db);
    // a valid row (task_id only) must succeed — proves the table exists
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, task_id, creation_sha) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("pkg-a", "task", "my-task", null, taskId, "sha-ok");
    }, "a valid task row should be accepted");
    // a valid row (objective_id only) must succeed
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, task_id, creation_sha) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("pkg-a", "objective", "my-obj", objectiveId, null, "sha-ok2");
    }, "a valid objective row should be accepted");
    // inserting both foreign keys must fail the exactly-one CHECK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, task_id, creation_sha) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("pkg-b", "objective", "backend", objectiveId, taskId, "sha-x");
    }, "inserting both objective_id and task_id should be rejected by exactly-one CHECK");
    // inserting neither foreign key must fail the exactly-one CHECK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, task_id, creation_sha) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("pkg-c", "objective", "backend2", null, null, "sha-y");
    }, "inserting neither objective_id nor task_id should be rejected by exactly-one CHECK");
  });
});

test("migration 6 graph_import_map UNIQUE(package_id, kind, ref) rejects duplicate", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    db.prepare(
      "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, task_id, creation_sha) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("pkg-1", "task", "my-task", null, taskId, "sha-1");
    assert.throws(() => {
      db.prepare(
        "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, task_id, creation_sha) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("pkg-1", "task", "my-task", null, taskId, "sha-2");
    }, "duplicate (package_id, kind, ref) should be rejected by UNIQUE constraint");
  });
});

test("migration 6 deleting a task cascades its graph_import_map row", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    db.prepare(
      "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, task_id, creation_sha) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("pkg-1", "task", "my-task", null, taskId, "sha-1");

    // verify the row exists before deletion
    const before = db
      .prepare("SELECT COUNT(*) as cnt FROM graph_import_map WHERE task_id = ?")
      .get(taskId) as { cnt: number };
    assert.equal(before.cnt, 1, "row should exist before task deletion");

    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);

    const after = db
      .prepare("SELECT COUNT(*) as cnt FROM graph_import_map WHERE task_id = ?")
      .get(taskId) as { cnt: number };
    assert.equal(
      after.cnt,
      0,
      "row should be deleted by CASCADE after task deletion",
    );
  });
});
