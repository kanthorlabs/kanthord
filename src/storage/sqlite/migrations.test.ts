import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "./open.ts";
import { migrate, type MigrationReport } from "./migrate.ts";
import {
  MIGRATIONS,
  canonicalTaskV20,
  canonicalTaskV21,
} from "./migrations.ts";
import { EVENT_TYPES } from "../../domain/event.ts";
import { canonicalTask, sha256Hex } from "../../domain/sha.ts";

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

test("migrates to version 31 and creates all tables including ai_providers, edge tables, project_ai_providers, daemon_heartbeats, and project_acks", () => {
  withMigratedDb((db) => {
    assert.equal(userVersion(db), 31);
    assert.deepEqual(userTables(db), [
      "ai_provider_default",
      "ai_providers",
      "daemon_heartbeats",
      "events",
      "graph_import_map",
      "initiative_dependencies",
      "initiatives",
      "jobs",
      "landing_candidates",
      "landing_integrations",
      "objective_dependencies",
      "objectives",
      "observability_refs",
      "project_acks",
      "project_ai_providers",
      "projects",
      "publications",
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

test("schema columns match locked DDL for all tables", () => {
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
      "status",
      "workspace",
    ]);
    assert.deepEqual(columnNames(db, "objectives"), [
      "id",
      "initiativeId",
      "name",
      "sha256",
      "status",
      "commitOid",
      "parentOid",
      "note",
      "conflictCause",
      "observedTipOid",
      "conflictReason",
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
    assert.deepEqual(columnNames(db, "jobs"), [
      "id",
      "taskId",
      "status",
      "revoked",
      "revokeReason",
    ]);
    assert.deepEqual(columnNames(db, "events"), [
      "id",
      "type",
      "taskId",
      "payload",
      "objectiveId",
      "initiativeId",
      "repositoryId",
      "projectId",
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
    assert.deepEqual(columnNames(db, "initiative_dependencies"), [
      "initiativeId",
      "dependency",
    ]);
    assert.deepEqual(columnNames(db, "objective_dependencies"), [
      "objectiveId",
      "dependency",
    ]);
    assert.deepEqual(columnNames(db, "ai_providers"), [
      "id",
      "name",
      "provider",
      "model",
      "baseUrl",
      "effort",
      "value",
      "state",
      "credentialVersion",
      "api",
      "contextWindow",
      "maxTokens",
    ]);
    assert.deepEqual(columnNames(db, "ai_provider_default"), [
      "id",
      "providerId",
    ]);
    assert.deepEqual(columnNames(db, "project_ai_providers"), [
      "projectId",
      "providerId",
      "rank",
    ]);
    assert.deepEqual(columnNames(db, "project_acks"), ["projectId", "cursor"]);
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

test("foreign key constraint rejects initiative_dependencies row with unknown dependency", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-fk', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-fk', 'proj-fk', 'I');
    `);
    assert.throws(() => {
      db.prepare(
        "INSERT INTO initiative_dependencies(initiativeId, dependency) VALUES (?, ?)",
      ).run("init-fk", "nonexistent-init");
    });
  });
});

test("foreign key constraint rejects objective_dependencies row with unknown objectiveId", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-fk-obj', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-fk-obj', 'proj-fk-obj', 'I');
    `);
    assert.throws(() => {
      db.prepare(
        "INSERT INTO objective_dependencies(objectiveId, dependency) VALUES (?, ?)",
      ).run("nonexistent-obj", "nonexistent-dep");
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

    // ai_providers.state CHECK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO ai_providers(id,name,provider,model,value,state) VALUES (?,?,?,?,?,?)",
      ).run("a", "n", "p", "m", "v", "bogus");
    }, "ai_providers.state CHECK should reject invalid value");
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

test("composite primary key rejects duplicate initiative_dependencies row", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-pk', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-a', 'proj-pk', 'A');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-b', 'proj-pk', 'B');
    `);

    db.prepare(
      "INSERT INTO initiative_dependencies(initiativeId, dependency) VALUES (?, ?)",
    ).run("init-b", "init-a");

    // duplicate (initiativeId, dependency) → rejected by composite PK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO initiative_dependencies(initiativeId, dependency) VALUES (?, ?)",
      ).run("init-b", "init-a");
    });
  });
});

test("composite primary key rejects duplicate objective_dependencies row", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-pk-obj', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-pk-obj', 'proj-pk-obj', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-a', 'init-pk-obj', 'A');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-b', 'init-pk-obj', 'B');
    `);

    db.prepare(
      "INSERT INTO objective_dependencies(objectiveId, dependency) VALUES (?, ?)",
    ).run("obj-b", "obj-a");

    // duplicate (objectiveId, dependency) → rejected by composite PK
    assert.throws(() => {
      db.prepare(
        "INSERT INTO objective_dependencies(objectiveId, dependency) VALUES (?, ?)",
      ).run("obj-b", "obj-a");
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
    assert.equal(second.version, 31);
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

test("S2: all 28 EVENT_TYPES members are accepted by the migrated events table", () => {
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
    // Apply all migrations including the new migration 8 (and 9, 10).
    migrate(db, MIGRATIONS);
    // (a) Schema must now be at the latest version.
    // EPIC 013 Story 5 bumped the count from 27 to 28 (migration 28 widened
    // the events CHECK to add `task.abandoned`). The characterization shape
    // is unchanged: bring up to the second-to-last rebuild boundary, seed
    // event rows, run the full migration set, expect the latest version and
    // every seeded row preserved verbatim.
    assert.equal(
      userVersion(db),
      31,
      "schema version must be 31 after all migrations",
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

// ── (q) migration 11 — initiative/objective status column ───────────────────

test("migration 11 adds status column to initiatives and objectives, defaulting existing rows to building", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m11-status-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 10 only (pre-status-column state), then seed rows
    // using only the pre-migration-11 columns.
    migrate(db, MIGRATIONS.slice(0, 10));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m11', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m11', 'proj-m11', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m11', 'init-m11', 'O');
    `);

    migrate(db, MIGRATIONS);

    type StatusRow = { status: string };
    const initRow = db
      .prepare("SELECT status FROM initiatives WHERE id = ?")
      .get("init-m11") as StatusRow | undefined;
    assert.equal(
      initRow?.status,
      "building",
      "pre-existing initiative row must default status to building",
    );
    const objRow = db
      .prepare("SELECT status FROM objectives WHERE id = ?")
      .get("obj-m11") as StatusRow | undefined;
    assert.equal(
      objRow?.status,
      "building",
      "pre-existing objective row must default status to building",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 17 initiatives.status CHECK accepts building|landed and rejects other values (including the removed awaiting_pr/delivered)", () => {
  withMigratedDb((db) => {
    db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
      "proj-m11-check",
      "P",
    );
    for (const status of ["building", "landed"]) {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO initiatives(id, projectId, name, status) VALUES (?, ?, ?, ?)",
        ).run(`init-${status}`, "proj-m11-check", "I", status);
      }, `initiatives.status = ${status} must be accepted`);
    }
    for (const status of ["awaiting_pr", "delivered", "invalid"]) {
      assert.throws(() => {
        db.prepare(
          "INSERT INTO initiatives(id, projectId, name, status) VALUES (?, ?, ?, ?)",
        ).run(`init-bad-${status}`, "proj-m11-check", "I", status);
      }, `initiatives.status CHECK should reject '${status}'`);
    }
  });
});

test("migration 11 objectives.status CHECK accepts building|awaiting_confirmation|conflict|integrated and rejects other values", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m11-obj-check', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m11-obj-check', 'proj-m11-obj-check', 'I');
    `);
    for (const status of [
      "building",
      "awaiting_confirmation",
      "conflict",
      "integrated",
    ]) {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO objectives(id, initiativeId, name, status) VALUES (?, ?, ?, ?)",
        ).run(`obj-${status}`, "init-m11-obj-check", "O", status);
      }, `objectives.status = ${status} must be accepted`);
    }
    assert.throws(() => {
      db.prepare(
        "INSERT INTO objectives(id, initiativeId, name, status) VALUES (?, ?, ?, ?)",
      ).run("obj-bad-status", "init-m11-obj-check", "O", "invalid");
    }, "objectives.status CHECK should reject invalid value");
  });
});

// ── (r) migration 12 — objective/initiative-scoped events ───────────────────

test("migration 12 adds objectiveId and initiativeId columns to events and makes taskId nullable", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m12-events-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 11 only (pre-scoped-event state) and seed a
    // task-scoped event using only the pre-migration-12 columns.
    migrate(db, MIGRATIONS.slice(0, 11));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m12', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m12', 'proj-m12', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m12', 'init-m12', 'O');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES ('task-m12', 'obj-m12', 'T', 'pending');
      INSERT INTO events(id, type, taskId) VALUES ('ev-m12-task', 'task.created', 'task-m12');
    `);

    migrate(db, MIGRATIONS);
    assert.equal(userVersion(db), 31);
    assert.deepEqual(columnNames(db, "events"), [
      "id",
      "type",
      "taskId",
      "payload",
      "objectiveId",
      "initiativeId",
      "repositoryId",
      "projectId",
    ]);

    const taskRow = db
      .prepare(
        "SELECT taskId, objectiveId, initiativeId FROM events WHERE id = ?",
      )
      .get("ev-m12-task") as {
      taskId: string;
      objectiveId: string | null;
      initiativeId: string | null;
    };
    assert.equal(
      taskRow.taskId,
      "task-m12",
      "pre-existing task-scoped event row survives the rebuild",
    );
    assert.equal(taskRow.objectiveId, null);
    assert.equal(taskRow.initiativeId, null);

    // taskId is now nullable: an objective-scoped event with no taskId inserts.
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO events(id, type, objectiveId) VALUES (?, ?, ?)",
      ).run("ev-m12-obj", "objective.integrated", "obj-m12");
    }, "events.taskId must be nullable after migration 12");
    const objRow = db
      .prepare("SELECT taskId, objectiveId FROM events WHERE id = ?")
      .get("ev-m12-obj") as { taskId: string | null; objectiveId: string };
    assert.equal(objRow.taskId, null);
    assert.equal(objRow.objectiveId, "obj-m12");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 17 events.type CHECK accepts the objective/initiative event types plus initiative.landed and repository.published, and rejects the removed initiative.awaiting_pr/initiative.delivered", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m12-types', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m12-types', 'proj-m12-types', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m12-types', 'init-m12-types', 'O');
    `);
    for (const type of [
      "objective.building",
      "objective.awaiting_confirmation",
      "objective.integrated",
      "objective.conflict",
    ]) {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO events(id, type, objectiveId) VALUES (?, ?, ?)",
        ).run(`ev-${type}`, type, "obj-m12-types");
      }, `event type '${type}' must be accepted by the events CHECK constraint`);
    }
    for (const type of ["initiative.landed", "repository.published"]) {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO events(id, type, initiativeId) VALUES (?, ?, ?)",
        ).run(`ev-${type}`, type, "init-m12-types");
      }, `event type '${type}' must be accepted by the events CHECK constraint`);
    }
    for (const type of ["initiative.awaiting_pr", "initiative.delivered"]) {
      assert.throws(() => {
        db.prepare(
          "INSERT INTO events(id, type, initiativeId) VALUES (?, ?, ?)",
        ).run(`ev-bad-${type}`, type, "init-m12-types");
      }, `event type '${type}' must now be rejected by the events CHECK constraint`);
    }
    assert.ok(
      (EVENT_TYPES as readonly string[]).includes("repository.published"),
      "repository.published must be in EVENT_TYPES",
    );
  });
});

// ── (t) migration 18 — repositoryId subject column on events (007.16 S4) ────

test("migration 18 adds a repositoryId column to events and preserves a pre-existing event row", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m18-events-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 17 only (pre-repositoryId state) and seed one
    // existing event row using only the pre-migration-18 columns.
    migrate(db, MIGRATIONS.slice(0, 17));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m18', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m18', 'proj-m18', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m18', 'init-m18', 'O');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES ('task-m18', 'obj-m18', 'T', 'pending');
      INSERT INTO events(id, type, taskId) VALUES ('ev-m18', 'task.created', 'task-m18');
    `);

    migrate(db, MIGRATIONS);
    assert.equal(userVersion(db), 31);
    assert.ok(
      columnNames(db, "events").includes("repositoryId"),
      "events table must gain a repositoryId column after migration 18",
    );

    const row = db
      .prepare("SELECT taskId, repositoryId FROM events WHERE id = ?")
      .get("ev-m18") as { taskId: string; repositoryId: string | null };
    assert.equal(
      row.taskId,
      "task-m18",
      "pre-existing event row survives the migration-18 rebuild",
    );
    assert.equal(row.repositoryId, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (u) migration 19 — widen objectives/initiatives status CHECK to allow
//        'discarded' (007.16 S5) ───────────────────────────────────────────

test("migration 19: a fresh migrated DB accepts UPDATE objectives SET status='discarded' without a CHECK violation", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m19-obj', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m19-obj', 'proj-m19-obj', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m19', 'init-m19-obj', 'O');
    `);
    assert.doesNotThrow(() => {
      db.prepare("UPDATE objectives SET status = 'discarded' WHERE id = ?").run(
        "obj-m19",
      );
    }, "objectives.status = 'discarded' must be accepted after migration 19");
    assert.throws(() => {
      db.prepare(
        "INSERT INTO objectives(id, initiativeId, name, status) VALUES (?, ?, ?, ?)",
      ).run("obj-m19-bad", "init-m19-obj", "O", "abandoned");
    }, "objectives.status CHECK should still reject an unknown value");
  });
});

test("migration 19: a fresh migrated DB accepts UPDATE initiatives SET status='discarded' without a CHECK violation", () => {
  withMigratedDb((db) => {
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m19-init', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m19', 'proj-m19-init', 'I');
    `);
    assert.doesNotThrow(() => {
      db.prepare(
        "UPDATE initiatives SET status = 'discarded' WHERE id = ?",
      ).run("init-m19");
    }, "initiatives.status = 'discarded' must be accepted after migration 19");
    assert.throws(() => {
      db.prepare(
        "INSERT INTO initiatives(id, projectId, name, status) VALUES (?, ?, ?, ?)",
      ).run("init-m19-bad", "proj-m19-init", "I", "abandoned");
    }, "initiatives.status CHECK should still reject an unknown value");
  });
});

// ── (s) migration 13 — initiative workspace (clone dir) column ──────────────

test("migration 13 adds a nullable workspace column to initiatives, defaulting existing rows to null", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m13-workspace-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 12 only (pre-workspace-column state), then seed a
    // row using only the pre-migration-13 columns.
    migrate(db, MIGRATIONS.slice(0, 12));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m13', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m13', 'proj-m13', 'I');
    `);

    migrate(db, MIGRATIONS);
    assert.equal(userVersion(db), 31);

    type WorkspaceRow = { workspace: string | null };
    const row = db
      .prepare("SELECT workspace FROM initiatives WHERE id = ?")
      .get("init-m13") as WorkspaceRow | undefined;
    assert.equal(
      row?.workspace,
      null,
      "pre-existing initiative row must default workspace to null",
    );

    // The column accepts a clone-dir path once the daemon provisions one.
    assert.doesNotThrow(() => {
      db.prepare("UPDATE initiatives SET workspace = ? WHERE id = ?").run(
        "/tmp/kanthord/init/init-m13",
        "init-m13",
      );
    }, "workspace column must accept a clone-dir path string");
    const updated = db
      .prepare("SELECT workspace FROM initiatives WHERE id = ?")
      .get("init-m13") as WorkspaceRow | undefined;
    assert.equal(updated?.workspace, "/tmp/kanthord/init/init-m13");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (t) migration 15 — publications table (007.13 Story C) ──────────────────

test("migration 15 creates publications table keyed by (repo_id, branch) with a state CHECK", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m15-publications-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    const report = migrate(db, MIGRATIONS);
    assert.equal(report.version, 31);
    assert.ok(
      userTables(db).includes("publications"),
      "publications table must exist after migration 15",
    );
    assert.deepEqual(
      columnNames(db, "publications").sort(),
      ["branch", "remote_oid", "repo_id", "state"].sort(),
    );

    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO publications(repo_id, branch, state, remote_oid) VALUES (?, ?, ?, ?)",
      ).run("repo-m15", "main", "published", "deadbeef");
    }, "a 'published' row with a remote_oid must be accepted");

    assert.throws(() => {
      db.prepare(
        "INSERT INTO publications(repo_id, branch, state, remote_oid) VALUES (?, ?, ?, ?)",
      ).run("repo-m15", "other", "bogus-state", null);
    }, /CHECK/i);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (u) migration 21 — EPIC 007.18 Story 2: re-stamp both sha stores ────────

const S218_FIXTURE = {
  title: "Implement API",
  instructions: "do it",
  ac: ["returns 200"],
  agent: "generic@1",
  verification: undefined as string[] | undefined,
  dependencies: [] as string[],
  objectiveId: "OBJ1",
};

test("canonicalTaskV21 is byte-identical to the live canonicalTask for a status-free fixture", () => {
  assert.equal(canonicalTaskV21(S218_FIXTURE), canonicalTask(S218_FIXTURE));
});

test("canonicalTaskV20 pins the frozen status-bearing form", () => {
  assert.equal(
    canonicalTaskV20({ ...S218_FIXTURE, status: "pending" }),
    '{"title":"Implement API","instructions":"do it","ac":["returns 200"],"agent":"generic@1","verification":null,"dependencies":[],"objectiveId":"OBJ1","status":"pending"}',
  );
});

test("migration 21 re-stamps tasks.sha256 and creation_sha in lockstep for a progressed, untouched task", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m21-lockstep-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS.slice(0, 20));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m21a', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m21a', 'proj-m21a', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m21a', 'init-m21a', 'O');
    `);

    const content = { ...S218_FIXTURE, objectiveId: "obj-m21a" };
    const liveSha = sha256Hex(
      canonicalTaskV20({ ...content, status: "completed" }),
    );
    const baselineSha = sha256Hex(
      canonicalTaskV20({ ...content, status: "pending" }),
    );

    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, instructions, ac, agent, status, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "task-m21a",
      "obj-m21a",
      content.title,
      content.instructions,
      JSON.stringify(content.ac),
      content.agent,
      "completed",
      liveSha,
    );
    db.prepare(
      "INSERT INTO graph_import_map(package_id, kind, ref, task_id, creation_sha) VALUES (?, ?, ?, ?, ?)",
    ).run("pkg-m21a", "task", "task-m21a", "task-m21a", baselineSha);

    migrate(db, MIGRATIONS);

    const expected = sha256Hex(canonicalTask(content));
    const taskRow = db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get("task-m21a") as { sha256: string };
    const mapRow = db
      .prepare("SELECT creation_sha FROM graph_import_map WHERE task_id = ?")
      .get("task-m21a") as { creation_sha: string };

    assert.equal(
      taskRow.sha256,
      expected,
      "tasks.sha256 must equal the new status-less digest",
    );
    assert.equal(
      mapRow.creation_sha,
      expected,
      "creation_sha must be re-stamped to the same digest (lockstep)",
    );
    assert.equal(taskRow.sha256, mapRow.creation_sha);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 21 leaves creation_sha alone for a task whose content genuinely drifted before migrating", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m21-realdrift-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS.slice(0, 20));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m21b', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m21b', 'proj-m21b', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m21b', 'init-m21b', 'O');
    `);

    const liveContent = {
      ...S218_FIXTURE,
      objectiveId: "obj-m21b",
      title: "Implement API v2",
    };
    const originalContent = {
      ...S218_FIXTURE,
      objectiveId: "obj-m21b",
      title: "Implement API",
    };
    const liveSha = sha256Hex(
      canonicalTaskV20({ ...liveContent, status: "pending" }),
    );
    const staleBaseline = sha256Hex(
      canonicalTaskV20({ ...originalContent, status: "pending" }),
    );

    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, instructions, ac, agent, status, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "task-m21b",
      "obj-m21b",
      liveContent.title,
      liveContent.instructions,
      JSON.stringify(liveContent.ac),
      liveContent.agent,
      "pending",
      liveSha,
    );
    db.prepare(
      "INSERT INTO graph_import_map(package_id, kind, ref, task_id, creation_sha) VALUES (?, ?, ?, ?, ?)",
    ).run("pkg-m21b", "task", "task-m21b", "task-m21b", staleBaseline);

    migrate(db, MIGRATIONS);

    const expectedLive = sha256Hex(canonicalTask(liveContent));
    const taskRow = db
      .prepare("SELECT sha256 FROM tasks WHERE id = ?")
      .get("task-m21b") as { sha256: string };
    const mapRow = db
      .prepare("SELECT creation_sha FROM graph_import_map WHERE task_id = ?")
      .get("task-m21b") as { creation_sha: string };

    assert.equal(
      taskRow.sha256,
      expectedLive,
      "tasks.sha256 must be re-stamped to the live content's new digest",
    );
    assert.equal(
      mapRow.creation_sha,
      staleBaseline,
      "creation_sha must be byte-identical to its seeded value — real drift must survive",
    );
    assert.notEqual(
      taskRow.sha256,
      mapRow.creation_sha,
      "the row must still classify drifted after migrating",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 21 leaves an objective's graph_import_map baseline (task_id NULL) untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m21-obj-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS.slice(0, 20));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m21c', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m21c', 'proj-m21c', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m21c', 'init-m21c', 'O');
    `);
    db.prepare(
      "INSERT INTO graph_import_map(package_id, kind, ref, objective_id, creation_sha) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "pkg-m21c",
      "objective",
      "obj-m21c",
      "obj-m21c",
      "objective-creation-sha-unchanged",
    );

    migrate(db, MIGRATIONS);

    const mapRow = db
      .prepare(
        "SELECT creation_sha FROM graph_import_map WHERE objective_id = ?",
      )
      .get("obj-m21c") as { creation_sha: string };
    assert.equal(mapRow.creation_sha, "objective-creation-sha-unchanged");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 21 re-stamps only the graph_import_map row matching the undrifted baseline when two packages point to the same task", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m21-multipkg-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS.slice(0, 20));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m21d', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m21d', 'proj-m21d', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m21d', 'init-m21d', 'O');
    `);

    const content = { ...S218_FIXTURE, objectiveId: "obj-m21d" };
    const liveSha = sha256Hex(
      canonicalTaskV20({ ...content, status: "pending" }),
    );
    const matchingBaseline = liveSha; // seeded at pending, never ran → equals live
    const nonMatchingBaseline = "stale-baseline-from-a-different-package";

    db.prepare(
      "INSERT INTO tasks(id, objectiveId, title, instructions, ac, agent, status, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "task-m21d",
      "obj-m21d",
      content.title,
      content.instructions,
      JSON.stringify(content.ac),
      content.agent,
      "pending",
      liveSha,
    );
    db.prepare(
      "INSERT INTO graph_import_map(package_id, kind, ref, task_id, creation_sha) VALUES (?, ?, ?, ?, ?)",
    ).run("pkg-m21d-1", "task", "task-m21d", "task-m21d", matchingBaseline);
    db.prepare(
      "INSERT INTO graph_import_map(package_id, kind, ref, task_id, creation_sha) VALUES (?, ?, ?, ?, ?)",
    ).run("pkg-m21d-2", "task", "task-m21d", "task-m21d", nonMatchingBaseline);

    migrate(db, MIGRATIONS);

    const expected = sha256Hex(canonicalTask(content));
    const rows = db
      .prepare(
        "SELECT package_id, creation_sha FROM graph_import_map WHERE task_id = ? ORDER BY package_id",
      )
      .all("task-m21d") as Array<{ package_id: string; creation_sha: string }>;
    const byPkg = new Map(rows.map((r) => [r.package_id, r.creation_sha]));

    assert.equal(
      byPkg.get("pkg-m21d-1"),
      expected,
      "the matching-baseline row must be re-stamped to the new digest",
    );
    assert.equal(
      byPkg.get("pkg-m21d-2"),
      nonMatchingBaseline,
      "the non-matching-baseline row must be left byte-identical",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 21 migrates cleanly with an empty tasks table", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m21-empty-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS.slice(0, 20));
    assert.doesNotThrow(() => migrate(db, MIGRATIONS));
    assert.equal(userVersion(db), 31);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (w) migration 23 — 008.2 project_ai_providers UNIQUE constraints ─────────

test("migration 23 project_ai_providers UNIQUE(projectId,providerId) rejects duplicate assignment", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m23-uniq-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS);
    assert.equal(userVersion(db), 31);

    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-uniq', 'P');
      INSERT INTO ai_providers(id, name, provider, model, value, state)
        VALUES ('prov-a', 'A', 'o', 'm', 'v', 'active');
      INSERT INTO ai_providers(id, name, provider, model, value, state)
        VALUES ('prov-b', 'B', 'o', 'm', 'v', 'active');
    `);

    // First insert must succeed
    db.prepare(
      "INSERT INTO project_ai_providers(projectId, providerId, rank) VALUES (?, ?, ?)",
    ).run("proj-uniq", "prov-a", 0);

    // Duplicate (projectId, providerId) must be rejected
    assert.throws(() => {
      db.prepare(
        "INSERT INTO project_ai_providers(projectId, providerId, rank) VALUES (?, ?, ?)",
      ).run("proj-uniq", "prov-a", 1);
    }, "UNIQUE(projectId,providerId) must reject duplicate assignment");

    // Same provider under a different project must succeed
    db.exec("INSERT INTO projects(id, name) VALUES ('proj-uniq2', 'Q')");
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO project_ai_providers(projectId, providerId, rank) VALUES (?, ?, ?)",
      ).run("proj-uniq2", "prov-a", 0);
    }, "same provider under different project must be accepted");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 23 project_ai_providers UNIQUE(projectId,rank) rejects two members at same rank", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m23-rank-uniq-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db, MIGRATIONS);
    assert.equal(userVersion(db), 31);

    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-rank', 'P');
      INSERT INTO ai_providers(id, name, provider, model, value, state)
        VALUES ('prov-r1', 'R1', 'o', 'm', 'v', 'active');
      INSERT INTO ai_providers(id, name, provider, model, value, state)
        VALUES ('prov-r2', 'R2', 'o', 'm', 'v', 'active');
    `);

    db.prepare(
      "INSERT INTO project_ai_providers(projectId, providerId, rank) VALUES (?, ?, ?)",
    ).run("proj-rank", "prov-r1", 0);

    // Same rank under same project must be rejected
    assert.throws(() => {
      db.prepare(
        "INSERT INTO project_ai_providers(projectId, providerId, rank) VALUES (?, ?, ?)",
      ).run("proj-rank", "prov-r2", 0);
    }, "UNIQUE(projectId,rank) must reject two assigns at same rank");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (v) migration 23 — custom openai-compatible provider columns ──────────

test("migration 24 ai_providers.api CHECK rejects bogus flavor while accepting valid flavors and null", () => {
  withMigratedDb((db) => {
    // openai-completions must be accepted
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO ai_providers(id, name, provider, model, value, api) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        "cust-v1",
        "Cust-V1",
        "qwen-token-plan",
        "qwen-max",
        "sk-key",
        "openai-completions",
      );
    }, "api='openai-completions' must be accepted by CHECK");

    // openai-responses must be accepted
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO ai_providers(id, name, provider, model, value, api) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        "cust-v2",
        "Cust-V2",
        "qwen-token-plan",
        "qwen-max",
        "sk-key",
        "openai-responses",
      );
    }, "api='openai-responses' must be accepted by CHECK");

    // NULL api must be accepted (builtin provider)
    assert.doesNotThrow(() => {
      db.prepare(
        "INSERT INTO ai_providers(id, name, provider, model, value, api) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("cust-v3", "Cust-V3", "openai-codex", "gpt-5", "sk-key", null);
    }, "api=NULL must be accepted (builtin provider)");

    // bogus flavor must be rejected
    assert.throws(() => {
      db.prepare(
        "INSERT INTO ai_providers(id, name, provider, model, value, api) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        "cust-v4",
        "Cust-V4",
        "qwen-token-plan",
        "qwen-max",
        "sk-key",
        "bogus",
      );
    }, /CHECK/i);
  });
});

// ── (u) migration 25 — 008.3-s-retire-ai-provider-type ──────────────────────

test("migration 25 (008.3-s-retire-ai-provider-type): resources CHECK rejects ai_provider; stale rows cleaned", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m25-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 24 only (pre-migration-25 state)
    migrate(db, MIGRATIONS.slice(0, 24));
    assert.equal(userVersion(db), 24);

    // Seed a project, an ai_provider resource, and a task_context row referencing it
    db.exec("INSERT INTO projects(id, name) VALUES ('p-m25', 'P')");
    // Need objectives + tasks for task_context FK
    db.exec(
      "INSERT INTO initiatives(id, projectId, name) VALUES ('init-m25', 'p-m25', 'I')",
    );
    db.exec(
      "INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m25', 'init-m25', 'O')",
    );
    db.exec(
      "INSERT INTO tasks(id, objectiveId, title, status) VALUES ('task-m25', 'obj-m25', 'T', 'pending')",
    );
    db.exec(
      "INSERT INTO resources(id, projectId, type, name) VALUES ('r-ai', 'p-m25', 'ai_provider', 'OldAI')",
    );
    db.exec(
      "INSERT INTO resources(id, projectId, type, name) VALUES ('r-cred', 'p-m25', 'credential', 'OldCred')",
    );
    // task_context row referencing the ai_provider
    db.exec(
      "INSERT INTO task_context(task_id, type, resource_id) VALUES ('task-m25', 'ai_provider', 'r-ai')",
    );
    // task_context row referencing the credential (ai credential path)
    db.exec(
      "INSERT INTO task_context(task_id, type, resource_id) VALUES ('task-m25', 'credential', 'r-cred')",
    );

    // Apply all migrations including 25 (and any later migrations)
    migrate(db, MIGRATIONS);
    assert.equal(userVersion(db), 31);

    // migration-7 columns still present
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

    // credential and repository still accepted
    assert.doesNotThrow(() => {
      db.exec(
        "INSERT INTO resources(id, projectId, type, name) VALUES ('r-ok1', 'p-m25', 'credential', 'Cred1')",
      );
    }, "credential type must still be accepted");
    assert.doesNotThrow(() => {
      db.exec(
        "INSERT INTO resources(id, projectId, type, name) VALUES ('r-ok2', 'p-m25', 'repository', 'Repo1')",
      );
    }, "repository type must still be accepted");

    // ai_provider type must now be rejected by CHECK
    assert.throws(() => {
      db.exec(
        "INSERT INTO resources(id, projectId, type, name) VALUES ('r-bad', 'p-m25', 'ai_provider', 'Bad')",
      );
    }, /CHECK/i);

    // Seeded ai_provider row must be gone
    const aiRow = db
      .prepare("SELECT id FROM resources WHERE id = ?")
      .get("r-ai") as { id: string } | undefined;
    assert.equal(
      aiRow,
      undefined,
      "seeded ai_provider row must be deleted by migration 25",
    );

    // Seeded credential row must survive (credential type kept)
    const credRow = db
      .prepare("SELECT id FROM resources WHERE id = ?")
      .get("r-cred") as { id: string } | undefined;
    assert.ok(
      credRow !== undefined,
      "credential row must survive migration 25 (credential type kept)",
    );

    // task_context rows for the stale ai_provider and credential must be cleaned
    const staleCtxCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM task_context WHERE task_id = ?")
      .get("task-m25") as { cnt: number };
    assert.equal(
      staleCtxCount.cnt,
      0,
      "task_context rows (ai_provider + credential) must be deleted by migration 25",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (v) migration 26 — 008.4-s-provider-failover-event (Story D) ────────────

test("migration 26: events.type CHECK admits 'provider.failover' (008.4 Story D)", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "ev-pf-1",
        "provider.failover",
        taskId,
      );
    }, "'provider.failover' must be a valid event type after migration 26");
    // The row must be readable back through the rebuilt table.
    const row = db
      .prepare("SELECT type FROM events WHERE id = ?")
      .get("ev-pf-1") as { type: string } | undefined;
    assert.ok(row !== undefined, "inserted provider.failover row must survive");
    assert.equal(row.type, "provider.failover");
  });
});

test("migration 26: events.type CHECK still rejects an unknown type (008.4 Story D)", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    assert.throws(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "ev-bad-m26",
        "task.bogus",
        taskId,
      );
    }, "an unknown event type must still be rejected by the events.type CHECK after migration 26");
  });
});

test("migration 26: pre-existing event rows survive the table rebuild (008.4 Story D)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m26-rebuild-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 25 only (pre-migration-26 state) and seed event
    // rows that the rebuild must preserve verbatim.
    migrate(db, MIGRATIONS.slice(0, 25));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m26', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m26', 'proj-m26', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m26', 'init-m26', 'O');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES ('task-m26', 'obj-m26', 'T', 'pending');
    `);
    db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
      "ev-m26-1",
      "task.created",
      "task-m26",
    );
    db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
      "ev-m26-2",
      "task.verification",
      "task-m26",
    );

    migrate(db, MIGRATIONS);
    // EPIC 013 Story 5 added migration 28 (`task.abandoned` event type +
    // events_new11 rebuild). The characterization shape is unchanged:
    // bring up to the pre-rebuild boundary, seed event rows, run the full
    // migration set, expect the latest version and every seeded row
    // preserved verbatim.
    assert.equal(
      userVersion(db),
      31,
      "schema version must be 31 after all migrations",
    );
    const countRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM events WHERE taskId = ?")
      .get("task-m26") as { cnt: number };
    assert.equal(
      countRow.cnt,
      2,
      "both seeded event rows must survive the migration 28 table rebuild",
    );
    const row = db
      .prepare("SELECT type FROM events WHERE id = ?")
      .get("ev-m26-1") as { type: string } | undefined;
    assert.ok(row !== undefined, "seeded event row ev-m26-1 must survive");
    assert.equal(row.type, "task.created");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── events schema guard (008.4 Story D + 011 S3) ────────────────────────────
// These two tests assert the events table's END STATE after ALL migrations,
// so they are independent of how the column and index got there. Any future
// rebuild of `events` (the events_newN pattern — SQLite cannot ALTER a CHECK,
// so growing the type list means rebuilding) that forgets `projectId` or
// `events_project_cursor` fails here, before it can silently empty every
// project-scoped feed. EPIC 013 story 5 is the next such rebuild.

test("migration 28: rebuild preserves all 8 events columns, including the projectId that scoped feeds read (008.4 Story D + 011 S3 + 013 S5)", () => {
  withMigratedDb((db) => {
    assert.deepEqual(columnNames(db, "events"), [
      "id",
      "type",
      "taskId",
      "payload",
      "objectiveId",
      "initiativeId",
      "repositoryId",
      "projectId",
    ]);
  });
});

test("migration 28: creates the events_project_cursor index (011 S3 + 013 S5)", () => {
  withMigratedDb((db) => {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='events_project_cursor'",
      )
      .all() as { name: string }[];
    assert.equal(
      rows.length,
      1,
      "events_project_cursor index must exist after all migrations",
    );
    assert.equal(rows[0]?.name, "events_project_cursor");
  });
});

// ── EPIC 013 Story 1 — jobs.revoked / jobs.revokeReason (migration 27) ──────

test("migration 27: jobs has the new revoked + revokeReason columns (013 S1)", () => {
  withMigratedDb((db) => {
    assert.deepEqual(columnNames(db, "jobs"), [
      "id",
      "taskId",
      "status",
      "revoked",
      "revokeReason",
    ]);
  });
});

test("migration 27: a pre-migration-27 jobs row survives and defaults revoked=0, revokeReason=null (013 S1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-s1-job-lease-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 26 only (pre-migration-27 state), then seed a task
    // chain + a jobs row using only the pre-migration-27 columns.
    migrate(db, MIGRATIONS.slice(0, 26));
    const { taskId } = insertChain(db);
    db.prepare("INSERT INTO jobs(id, taskId, status) VALUES (?, ?, ?)").run(
      "job-pre27",
      taskId,
      "queued",
    );

    migrate(db, MIGRATIONS);

    const row = db
      .prepare(
        "SELECT id, taskId, status, revoked, revokeReason FROM jobs WHERE id = ?",
      )
      .get("job-pre27") as
      | {
          id: string;
          taskId: string;
          status: string;
          revoked: number;
          revokeReason: string | null;
        }
      | undefined;
    assert.ok(row !== undefined, "pre-migration-27 jobs row must survive");
    assert.equal(row.id, "job-pre27");
    assert.equal(row.taskId, taskId);
    assert.equal(row.status, "queued");
    assert.equal(
      row.revoked,
      0,
      "a pre-migration-27 jobs row must default revoked to 0",
    );
    assert.equal(
      row.revokeReason,
      null,
      "a pre-migration-27 jobs row must default revokeReason to null",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 27: partial unique index on jobs(taskId) WHERE status='queued' still rejects two queued jobs for one task (013 S1)", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);

    db.prepare("INSERT INTO jobs(id, taskId, status) VALUES (?, ?, ?)").run(
      "j1",
      taskId,
      "queued",
    );

    // second queued job for same taskId → still rejected after migration 27
    assert.throws(() => {
      db.prepare("INSERT INTO jobs(id, taskId, status) VALUES (?, ?, ?)").run(
        "j2",
        taskId,
        "queued",
      );
    }, "the partial unique index must still reject two queued jobs for the same taskId after migration 27");
  });
});

// ── EPIC 013 Story 5 — task.abandoned event type (migration 28) ──────────────
// Story 5 widens the events.type CHECK to admit the new task.abandoned literal
// (the operator's reason for revoking a run's lease). The rebuild uses the
// events_new11 pattern and MUST preserve the projectId column that EPIC 011 S3
// added — the index events_project_cursor is recreated by the migration, but
// the column itself is what every scoped feed reads.

test("EVENT_TYPES has 'task.abandoned' as a 28th member, positioned after 'task.discarded' (013 S5)", () => {
  // The new member must be present, must sit between task.discarded and
  // task.blocked so the task-lifecycle group stays contiguous, and the array
  // must grow from 27 to 28 (the 28th literal in the events.type CHECK list).
  const types = EVENT_TYPES as readonly string[];
  assert.ok(
    types.includes("task.abandoned"),
    "EVENT_TYPES must include 'task.abandoned' after Story 5",
  );
  const discardedIdx = types.indexOf("task.discarded");
  const abandonedIdx = types.indexOf("task.abandoned");
  const blockedIdx = types.indexOf("task.blocked");
  assert.equal(
    abandonedIdx,
    discardedIdx + 1,
    "'task.abandoned' must sit immediately after 'task.discarded'",
  );
  assert.equal(
    blockedIdx,
    abandonedIdx + 1,
    "'task.blocked' must sit immediately after 'task.abandoned'",
  );
  assert.equal(
    types.length,
    28,
    "EVENT_TYPES must have 28 members after Story 5",
  );
});

test("migration 28: events.type CHECK admits 'task.abandoned' (013 S5)", () => {
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "ev-abandoned-1",
        "task.abandoned",
        taskId,
      );
    }, "'task.abandoned' must be a valid event type after migration 28");
    // The inserted row must be readable back through the rebuilt table.
    const row = db
      .prepare("SELECT type FROM events WHERE id = ?")
      .get("ev-abandoned-1") as { type: string } | undefined;
    assert.ok(row !== undefined, "inserted task.abandoned row must survive");
    assert.equal(row.type, "task.abandoned");
  });
});

test("migration 28: events.type CHECK still rejects an unknown type (013 S5)", () => {
  // Regression guard: widening the CHECK to admit task.abandoned must not
  // accidentally turn the constraint into a no-op for every other literal.
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    assert.throws(() => {
      db.prepare("INSERT INTO events(id, type, taskId) VALUES (?, ?, ?)").run(
        "ev-bad-m28",
        "task.bogus",
        taskId,
      );
    }, "an unknown event type must still be rejected by the events.type CHECK after migration 28");
  });
});

test("migration 28: pre-existing event rows survive the table rebuild (013 S5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m28-rebuild-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 27 only (pre-migration-28 state) and seed two event
    // rows that the rebuild must preserve verbatim — including the payload
    // column, which the INSERT…SELECT column list must carry explicitly.
    migrate(db, MIGRATIONS.slice(0, 27));
    db.exec(`
      INSERT INTO projects(id, name) VALUES ('proj-m28', 'P');
      INSERT INTO initiatives(id, projectId, name) VALUES ('init-m28', 'proj-m28', 'I');
      INSERT INTO objectives(id, initiativeId, name) VALUES ('obj-m28', 'init-m28', 'O');
      INSERT INTO tasks(id, objectiveId, title, status) VALUES ('task-m28', 'obj-m28', 'T', 'pending');
    `);
    db.prepare(
      "INSERT INTO events(id, type, taskId, payload) VALUES (?, ?, ?, ?)",
    ).run("ev-m28-1", "task.created", "task-m28", '{"seed":1}');
    db.prepare(
      "INSERT INTO events(id, type, taskId, payload) VALUES (?, ?, ?, ?)",
    ).run("ev-m28-2", "task.verification", "task-m28", '{"seed":2}');

    migrate(db, MIGRATIONS);
    assert.equal(
      userVersion(db),
      31,
      "schema version must be 31 after all migrations",
    );
    const countRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM events WHERE taskId = ?")
      .get("task-m28") as { cnt: number };
    assert.equal(
      countRow.cnt,
      2,
      "both seeded event rows must survive the migration 28 table rebuild",
    );
    const row1 = db
      .prepare("SELECT type, payload FROM events WHERE id = ?")
      .get("ev-m28-1") as { type: string; payload: string } | undefined;
    assert.ok(row1 !== undefined, "seeded event row ev-m28-1 must survive");
    assert.equal(row1.type, "task.created");
    assert.equal(
      row1.payload,
      '{"seed":1}',
      "ev-m28-1 payload must round-trip through the rebuild",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 28: inserting 'task.abandoned' with a 'reason' payload round-trips through SELECT (013 S5)", () => {
  // The new event carries the operator's reason in the payload column. The
  // CHECK only validates the `type` literal; the payload must round-trip as a
  // free-form string and never be silently dropped.
  withMigratedDb((db) => {
    const { taskId } = insertChain(db);
    db.prepare(
      "INSERT INTO events(id, type, taskId, payload) VALUES (?, ?, ?, ?)",
    ).run(
      "ev-abandoned-2",
      "task.abandoned",
      taskId,
      '{"reason":"stuck on a slow tool"}',
    );
    const row = db
      .prepare("SELECT payload FROM events WHERE id = ?")
      .get("ev-abandoned-2") as { payload: string } | undefined;
    assert.ok(row !== undefined, "task.abandoned row must exist after INSERT");
    assert.equal(
      row.payload,
      '{"reason":"stuck on a slow tool"}',
      "task.abandoned payload must round-trip through SELECT verbatim",
    );
  });
});

// ── EPIC 014 Story 3 — daemon_heartbeats (migration 29) ────────────────────
// Observation only — one row per daemon instance (pid + process start time).
// Not a lease; two rows is a reportable state, not an error. PRIMARY KEY is
// `instanceId` so a re-beat upserts in place and a second daemon is visible
// rather than overwriting the first.

test("migration 29: daemon_heartbeats table exists with exactly the four required columns (014 S3)", () => {
  withMigratedDb((db) => {
    assert.ok(
      userTables(db).includes("daemon_heartbeats"),
      "daemon_heartbeats table must exist after migration 29",
    );
    assert.deepEqual(
      columnNames(db, "daemon_heartbeats"),
      ["instanceId", "pid", "startedAtMs", "lastBeatMs"],
      "daemon_heartbeats must have exactly four columns in this order",
    );
  });
});

test("migration 29: daemon_heartbeats.instanceId is the PRIMARY KEY — re-beat upserts in place (014 S3)", () => {
  withMigratedDb((db) => {
    db.prepare(
      "INSERT INTO daemon_heartbeats(instanceId, pid, startedAtMs, lastBeatMs) VALUES (?, ?, ?, ?)",
    ).run("inst-a", 1, 100, 200);

    // second insert with the same instanceId must fail on the PK — a re-beat
    // must use ON CONFLICT(instanceId) DO UPDATE, not a plain INSERT. The
    // repository adapter (`SqliteDaemonHeartbeatRepository.beat`) is the only
    // caller; this assertion verifies the table has the constraint, so the
    // adapter cannot accidentally regress to a plain insert.
    assert.throws(() => {
      db.prepare(
        "INSERT INTO daemon_heartbeats(instanceId, pid, startedAtMs, lastBeatMs) VALUES (?, ?, ?, ?)",
      ).run("inst-a", 1, 100, 300);
    }, "instanceId PRIMARY KEY must reject a plain duplicate insert");
  });
});

// ── EPIC 017 Story 1 — objective decision metadata (migration 31) ──────────
// `note`, `conflictCause`, `observedTipOid`, `conflictReason` on `objectives`.
// Plain ALTER TABLE ADD COLUMN only — objectives was last rebuilt by
// migration 19; a verbatim column copy here would risk dropping another
// epic's column, so this migration must NOT rebuild the table.

test("migration 31 is named 017-objective-decision-metadata (017 S1)", () => {
  const last = MIGRATIONS[MIGRATIONS.length - 1];
  assert.equal(
    last?.name,
    "017-objective-decision-metadata",
    "the final migration must be named 017-objective-decision-metadata",
  );
  assert.equal(
    last?.version,
    31,
    "the final migration's version must be 31 (previous head 30 + 1)",
  );
});

test("migration 31: objectives has note, conflictCause, observedTipOid, conflictReason columns (017 S1)", () => {
  withMigratedDb((db) => {
    assert.deepEqual(columnNames(db, "objectives"), [
      "id",
      "initiativeId",
      "name",
      "sha256",
      "status",
      "commitOid",
      "parentOid",
      "note",
      "conflictCause",
      "observedTipOid",
      "conflictReason",
    ]);
  });
});

test("migration 31: a pre-migration-31 objectives row survives and the four new columns read null (017 S1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-m31-objective-meta-"));
  const dbPath = join(dir, "kanthord.db");
  const db = openDatabase(dbPath);
  try {
    // Bring up to version 30 only (pre-migration-31 state), seed a full
    // chain via insertChain, then migrate the rest of the way.
    migrate(db, MIGRATIONS.slice(0, 30));
    const { objectiveId } = insertChain(db);

    migrate(db, MIGRATIONS);

    const row = db
      .prepare(
        "SELECT id, note, conflictCause, observedTipOid, conflictReason FROM objectives WHERE id = ?",
      )
      .get(objectiveId) as
      | {
          id: string;
          note: string | null;
          conflictCause: string | null;
          observedTipOid: string | null;
          conflictReason: string | null;
        }
      | undefined;
    assert.ok(
      row !== undefined,
      "pre-migration-31 objectives row must survive",
    );
    assert.equal(row.id, objectiveId);
    assert.equal(row.note, null, "note must default to null");
    assert.equal(row.conflictCause, null, "conflictCause must default to null");
    assert.equal(
      row.observedTipOid,
      null,
      "observedTipOid must default to null",
    );
    assert.equal(
      row.conflictReason,
      null,
      "conflictReason must default to null",
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
