import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqliteProjectRepository } from "./sqlite-project-repository.ts";
import { newId } from "../../domain/entity.ts";
import type { Project } from "../../domain/project.ts";
import type {
  Repository,
  Credential,
  Notification,
  AIProvider,
  Filesystem,
} from "../../domain/resource.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-proj-repo-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

test("SqliteProjectRepository save then get round-trips the project", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "My Project" };
  repo.save(project);
  const loaded = repo.get(project.id);
  assert.deepEqual(loaded, project);
});

test("SqliteProjectRepository get returns undefined for unknown id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  assert.equal(repo.get("nonexistent-id"), undefined);
});

test("SqliteProjectRepository duplicate save throws", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "Dupe Project" };
  repo.save(project);
  assert.throws(() => repo.save(project));
});

test("SqliteProjectRepository addResource + listResources round-trips repository variant", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P1" };
  repo.save(project);

  const resource: Repository = {
    id: newId(),
    type: "repository",
    name: "my-repo",
    organization: "acme",
    branch: "main",
    path: "/workspace/my-repo",
  };
  repo.addResource(project.id, resource);

  const resources = repo.listResources(project.id);
  assert.equal(resources.length, 1);
  assert.deepEqual(resources[0], resource);
});

test("SqliteProjectRepository addResource + listResources round-trips credential variant", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P2" };
  repo.save(project);

  const resource: Credential = {
    id: newId(),
    type: "credential",
    name: "my-cred",
    provider: "github",
    value: "secret-token",
  };
  repo.addResource(project.id, resource);

  const resources = repo.listResources(project.id);
  assert.equal(resources.length, 1);
  assert.deepEqual(resources[0], resource);
});

test("SqliteProjectRepository addResource + listResources round-trips notification variant", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P3" };
  repo.save(project);

  const resource: Notification = {
    id: newId(),
    type: "notification",
    name: "my-notif",
    provider: "slack",
    destination: "#alerts",
  };
  repo.addResource(project.id, resource);

  const resources = repo.listResources(project.id);
  assert.equal(resources.length, 1);
  assert.deepEqual(resources[0], resource);
});

test("SqliteProjectRepository addResource + listResources round-trips ai_provider variant", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P4" };
  repo.save(project);

  const resource: AIProvider = {
    id: newId(),
    type: "ai_provider",
    name: "claude",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
  };
  repo.addResource(project.id, resource);

  const resources = repo.listResources(project.id);
  assert.equal(resources.length, 1);
  assert.deepEqual(resources[0], resource);
});

test("SqliteProjectRepository addResource + listResources round-trips filesystem variant", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P5" };
  repo.save(project);

  const resource: Filesystem = {
    id: newId(),
    type: "filesystem",
    name: "local-fs",
    path: "/data/workspace",
  };
  repo.addResource(project.id, resource);

  const resources = repo.listResources(project.id);
  assert.equal(resources.length, 1);
  assert.deepEqual(resources[0], resource);
});

test("SqliteProjectRepository addResource with unknown projectId throws", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const resource: Repository = {
    id: newId(),
    type: "repository",
    name: "orphan-repo",
    organization: "acme",
    branch: "main",
    path: "/workspace/orphan",
  };
  assert.throws(() => repo.addResource("nonexistent-project-id", resource));
});
