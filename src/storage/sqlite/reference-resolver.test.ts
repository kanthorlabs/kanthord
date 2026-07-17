import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqliteReferenceResolver } from "./reference-resolver.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-ref-resolver-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

test("SqliteReferenceResolver resolveKind returns 'project' for a project id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectId = "01HQZRX000000000000000PROJ";
  db.exec(
    `INSERT INTO projects (id, name) VALUES ('${projectId}', 'My Project')`,
  );

  const resolver = new SqliteReferenceResolver(db);
  assert.equal(resolver.resolveKind(projectId), "project");
});

test("SqliteReferenceResolver resolveKind returns 'resource' for a resource id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectId = "01HQZRX000000000000000PROJ";
  const resourceId = "01HQZRX000000000000000RSRC";
  db.exec(
    `INSERT INTO projects (id, name) VALUES ('${projectId}', 'My Project')`,
  );
  db.exec(
    `INSERT INTO resources (id, projectId, type, name, attributes) VALUES ('${resourceId}', '${projectId}', 'repository', 'backend', '{}')`,
  );

  const resolver = new SqliteReferenceResolver(db);
  assert.equal(resolver.resolveKind(resourceId), "resource");
});

test("SqliteReferenceResolver resolveKind returns 'initiative' for an initiative id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectId = "01HQZRX000000000000000PROJ";
  const initiativeId = "01HQZRX000000000000000INIT";
  db.exec(
    `INSERT INTO projects (id, name) VALUES ('${projectId}', 'My Project')`,
  );
  db.exec(
    `INSERT INTO initiatives (id, projectId, name) VALUES ('${initiativeId}', '${projectId}', 'oauth')`,
  );

  const resolver = new SqliteReferenceResolver(db);
  assert.equal(resolver.resolveKind(initiativeId), "initiative");
});

test("SqliteReferenceResolver resolveKind returns 'objective' for an objective id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectId = "01HQZRX000000000000000PROJ";
  const initiativeId = "01HQZRX000000000000000INIT";
  const objectiveId = "01HQZRX000000000000000OBJV";
  db.exec(
    `INSERT INTO projects (id, name) VALUES ('${projectId}', 'My Project')`,
  );
  db.exec(
    `INSERT INTO initiatives (id, projectId, name) VALUES ('${initiativeId}', '${projectId}', 'oauth')`,
  );
  db.exec(
    `INSERT INTO objectives (id, initiativeId, name) VALUES ('${objectiveId}', '${initiativeId}', 'backend')`,
  );

  const resolver = new SqliteReferenceResolver(db);
  assert.equal(resolver.resolveKind(objectiveId), "objective");
});

test("SqliteReferenceResolver resolveKind returns 'task' for a task id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const projectId = "01HQZRX000000000000000PROJ";
  const initiativeId = "01HQZRX000000000000000INIT";
  const objectiveId = "01HQZRX000000000000000OBJV";
  const taskId = "01HQZRX000000000000000TASK";
  db.exec(
    `INSERT INTO projects (id, name) VALUES ('${projectId}', 'My Project')`,
  );
  db.exec(
    `INSERT INTO initiatives (id, projectId, name) VALUES ('${initiativeId}', '${projectId}', 'oauth')`,
  );
  db.exec(
    `INSERT INTO objectives (id, initiativeId, name) VALUES ('${objectiveId}', '${initiativeId}', 'backend')`,
  );
  db.exec(
    `INSERT INTO tasks (id, objectiveId, title, status) VALUES ('${taskId}', '${objectiveId}', 'implement api', 'pending')`,
  );

  const resolver = new SqliteReferenceResolver(db);
  assert.equal(resolver.resolveKind(taskId), "task");
});

test("SqliteReferenceResolver resolveKind returns undefined for an unknown id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const resolver = new SqliteReferenceResolver(db);
  assert.equal(resolver.resolveKind("01HQZRX000000000000UNKNOWN"), undefined);
});
