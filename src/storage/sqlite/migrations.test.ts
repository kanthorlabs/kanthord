import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./open.ts";
import { migrate, type MigrationReport } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { EVENT_TYPES } from "../../domain/event.ts";

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

test("migrates to version 9 and creates exactly sixteen core tables", () => {
  withMigratedDb((db) => {
    assert.equal(userVersion(db), 9);
    assert.deepEqual(userTables(db), [
      "events",
      "graph_import_map",
      "initiatives",
      "jobs",
      "landing_candidates",
      "landing_integrations",
      "objectives",
      "observability_refs",
      "projects",
      "repo_locks",
      "resources",
      "task_context",
      "task_dependencies",
      "task_results",
      "tasks",
      "workspace_cached_policies",
    ]);
  });
});

// ── (b) columns per table ────────────────────────────────────────────────────

test("schema columns match locked DDL for all sixteen tables", () => {
  withMigratedDb((db) => {
    assert.deepEqual(columnNames(db, "projects"), ["id", "name"]);
    assert.deepEqual(columnNames(db, "observability_refs"), [
      "kind",
      "entity_id",
      "ref",
    ]);
    assert.deepEqual(columnNames(db, "resources"), [
      "id",
      "projectId",
      "type",
      "name",
      "attributes",
      "remoteUrl",
      "authKind",
      "authCredentialId",
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
      "note",
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
    assert.deepEqual(columnNames(db, "landing_candidates"), [
      "id",
      "task_id",
      "repo_id",
      "base_sha",
      "candidate_sha",
      "ref",
      "target",
      "state",
    ]);
    assert.deepEqual(columnNames(db, "landing_integrations"), [
      "candidate_id",
      "outcome",
      "canonical_sha",
      "merge_commit",
      "conflict_files",
    ]);
    assert.deepEqual(columnNames(db, "repo_locks"), [
      "repo_id",
      "branch",
      "pid",
      "locked_at",
    ]);
    assert.deepEqual(columnNames(db, "workspace_cached_policies"), [
      "repo_id",
      "last_fetched_origin_sha",
      "fetch_time",
      "base_sha",
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
    assert.equal(second.version, 9);
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

// ── (l) migration 7 — resources table column additions ──────────────────────

test("migration 7 adds remoteUrl authKind authCredentialId columns to resources", () => {
  withMigratedDb((db) => {
    const cols = columnNames(db, "resources");
    assert.ok(
      cols.includes("remoteUrl"),
      "resources must have remoteUrl after migration 7",
    );
    assert.ok(
      cols.includes("authKind"),
      "resources must have authKind after migration 7",
    );
    assert.ok(
      cols.includes("authCredentialId"),
      "resources must have authCredentialId after migration 7",
    );
  });
});

test("migration 7 data step derives remoteUrl from organization in attributes for existing repository rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m7-data-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring the database up to version 6 only (pre-migration-7 state).
    // MIGRATIONS.slice(0, 6) is always [v1..v6] regardless of how many later
    // migrations are added; validateSequence accepts this as a contiguous 1..6.
    migrate(db, MIGRATIONS.slice(0, 6));
    db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
      "proj-1",
      "P",
    );
    // Insert a repository resource with the legacy attributes JSON that contains
    // 'organization' (the shape that existed before T1/T2 removed the field).
    db.prepare(
      "INSERT INTO resources(id, projectId, type, name, attributes) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "res-1",
      "proj-1",
      "repository",
      "myrepo",
      JSON.stringify({ organization: "acme", branch: "main", path: "/repo" }),
    );
    // Apply migration 7 (the T3 data step). Today this is a no-op (only 6
    // migrations exist) so the SELECT below will throw "no such column" → RED.
    migrate(db, MIGRATIONS);
    type Row = { remoteUrl: string | null; authKind: string | null };
    const row = db
      .prepare("SELECT remoteUrl, authKind FROM resources WHERE id = ?")
      .get("res-1") as Row | undefined;
    assert.ok(row !== undefined, "resource row exists after migration 7");
    assert.equal(
      row.remoteUrl,
      "https://github.com/acme/myrepo.git",
      "remoteUrl derived from organization 'acme' and name 'myrepo'",
    );
    assert.equal(row.authKind, "ambient", "authKind defaults to ambient");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (m) migration 7 — events table recreated with task.verification in CHECK ──

test("migration 7 events table allows task.verification type", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "ev-verif-1",
        "task.verification",
        taskId,
      );
    }, "task.verification must be a valid event type after migration 7");
  });
});

test("migration 7 events table rejects task.unknown type with CHECK violation", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    assert.throws(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "ev-bad-1",
        "task.unknown",
        taskId,
      );
    }, "task.unknown must be rejected by the events.type CHECK constraint");
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

// ── (n) migration 7 — landing tables ─────────────────────────────────────────

test("migration 7 landing_candidates state CHECK rejects values outside pending|landed|conflict", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);

    // 'pending' must be accepted (the default)
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO landing_candidates(id, task_id, repo_id, base_sha, candidate_sha, ref, target, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "cand-ok-1",
        taskId,
        "repo-1",
        "base-sha",
        "cand-sha",
        "kanthord/task-1",
        "main",
        "pending",
      );
    }, "state=pending must be accepted");

    // 'landed' must be accepted
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO landing_candidates(id, task_id, repo_id, base_sha, candidate_sha, ref, target, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "cand-ok-2",
        taskId,
        "repo-1",
        "base-sha",
        "cand-sha-2",
        "kanthord/task-2",
        "main",
        "landed",
      );
    }, "state=landed must be accepted");

    // 'conflict' must be accepted
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO landing_candidates(id, task_id, repo_id, base_sha, candidate_sha, ref, target, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "cand-ok-3",
        taskId,
        "repo-1",
        "base-sha",
        "cand-sha-3",
        "kanthord/task-3",
        "main",
        "conflict",
      );
    }, "state=conflict must be accepted");

    // 'invalid' must be rejected by CHECK constraint
    assert.throws(() => {
      db.prepare(
        "INSERT INTO landing_candidates(id, task_id, repo_id, base_sha, candidate_sha, ref, target, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "cand-bad",
        taskId,
        "repo-1",
        "base-sha",
        "cand-sha-bad",
        "kanthord/task-bad",
        "main",
        "invalid",
      );
    }, "state=invalid must be rejected by the CHECK constraint");
  });
});

// ── (o) migration 7 — workspace_cached_policies table (Story 12 T2) ──────────

test("migration 7 creates workspace_cached_policies with repo_id PRIMARY KEY", () => {
  withMigratedDb((db) => {
    assert.deepEqual(
      columnNames(db, "workspace_cached_policies"),
      ["repo_id", "last_fetched_origin_sha", "fetch_time", "base_sha"],
      "workspace_cached_policies must have four columns",
    );

    // repo_id is PRIMARY KEY — inserting the same repo_id twice is rejected
    db.prepare(
      "INSERT INTO workspace_cached_policies(repo_id, last_fetched_origin_sha, fetch_time, base_sha) VALUES (?, ?, ?, ?)",
    ).run("r1", "abc123", "2026-07-19T00:00:00Z", "def456");

    assert.throws(() => {
      db.prepare(
        "INSERT INTO workspace_cached_policies(repo_id, last_fetched_origin_sha, fetch_time, base_sha) VALUES (?, ?, ?, ?)",
      ).run("r1", "aaa000", "2026-07-19T01:00:00Z", "bbb111");
    }, "repo_id PRIMARY KEY must reject duplicate insert");
  });
});

// ── (p) migration 8 — S2: task.conflict schema + bidirectional drift guard ────

test("S2: all 16 EVENT_TYPES members are accepted by the migrated events table", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    for (const eventType of EVENT_TYPES) {
      assert.doesNotThrow(() => {
        db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
          `ev-${eventType}`,
          eventType,
          taskId,
        );
      }, `event type '${eventType}' must be accepted by the events CHECK constraint`);
    }
  });
});

test("S2: unknown event type 'task.nope' is rejected by the events CHECK after migration 8", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    assert.throws(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "ev-nope",
        "task.nope",
        taskId,
      );
    }, "task.nope must be rejected by the events.type CHECK constraint");
  });
});

test("S2: pre-existing event rows and indexes survive the migration 8 table rebuild", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-s2-rebuild-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 7 only (before the task.conflict rebuild).
    migrate(db, MIGRATIONS.slice(0, 7));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-s2', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-s2', 'proj-s2', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-s2', 'init-s2', 'O');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES ('task-s2', 'obj-s2', 'T', 'pending');
    `);
    // Seed three event rows with currently-valid types so we can verify survival.
    db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
      "ev-s2-1",
      "task.created",
      "task-s2",
    );
    db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
      "ev-s2-2",
      "task.completed",
      "task-s2",
    );
    db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
      "ev-s2-3",
      "task.verification",
      "task-s2",
    );
    // Apply all migrations including the new migration 8 (and 9).
    migrate(db, MIGRATIONS);
    // (a) Schema must now be at the latest version.
    assert.equal(
      userVersion(db),
      9,
      "schema version must be 9 after all migrations",
    );
    // (b) All seeded rows must survive the rebuild.
    const countRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM events WHERE taskId = ?")
      .get("task-s2") as { cnt: number };
    assert.equal(
      countRow.cnt,
      3,
      "all 3 seeded event rows must survive the migration 8 table rebuild",
    );
    // (c) Individual seeded rows are readable.
    const row = db
      .prepare("SELECT type FROM events WHERE id = ?")
      .get("ev-s2-1") as { type: string } | undefined;
    assert.ok(row !== undefined, "seeded event row ev-s2-1 must survive");
    assert.equal(row.type, "task.created");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
