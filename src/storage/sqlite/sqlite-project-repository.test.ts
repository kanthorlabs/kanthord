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

test("SqliteProjectRepository duplicate save (same id + same name) is a no-op upsert", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "Dupe Project" };
  repo.save(project);
  // upsert semantics: re-saving identical data must not throw
  assert.doesNotThrow(() => repo.save(project));
  assert.deepEqual(repo.get(project.id), project);
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
    remoteUrl: "https://github.com/acme/my-repo.git",
    branch: "main",
    path: "/workspace/my-repo",
    auth: { kind: "ambient" },
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
    remoteUrl: "https://github.com/acme/orphan-repo.git",
    branch: "main",
    path: "/workspace/orphan",
    auth: { kind: "ambient" },
  };
  assert.throws(() => repo.addResource("nonexistent-project-id", resource));
});

test("SqliteProjectRepository listResourcesByProject(projectId, type) filters resources by type (007.9 Story 03 item A)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P6" };
  repo.save(project);

  const credA: Credential = {
    id: newId(),
    type: "credential",
    name: "cred-a",
    provider: "github",
    value: "secret-a",
  };
  const credB: Credential = {
    id: newId(),
    type: "credential",
    name: "cred-b",
    provider: "openai",
    value: "secret-b",
  };
  const repoResource: Repository = {
    id: newId(),
    type: "repository",
    name: "my-repo",
    remoteUrl: "https://github.com/acme/my-repo.git",
    branch: "main",
    path: "/workspace/my-repo",
    auth: { kind: "ambient" },
  };
  repo.addResource(project.id, credA);
  repo.addResource(project.id, credB);
  repo.addResource(project.id, repoResource);

  const credentials = repo.listResourcesByProject(project.id, "credential");
  assert.equal(
    credentials.length,
    2,
    `expected 2 credentials, got ${credentials.length}`,
  );
  assert.deepEqual(
    new Set(credentials.map((r) => r.id)),
    new Set([credA.id, credB.id]),
  );

  const repositories = repo.listResourcesByProject(project.id, "repository");
  assert.equal(
    repositories.length,
    1,
    `expected 1 repository, got ${repositories.length}`,
  );
  assert.deepEqual(repositories[0], repoResource);
});

test("SqliteProjectRepository resolveProjectByName returns [id] for a unique name", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project = { id: newId(), name: "unique-project" };
  repo.save(project);
  const ids = repo.resolveProjectByName("unique-project");
  assert.deepEqual(ids, [project.id]);
});

test("SqliteProjectRepository resolveProjectByName returns [] for an unknown name", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const ids = repo.resolveProjectByName("no-such-project");
  assert.deepEqual(ids, []);
});

test("SqliteProjectRepository getResource returns the resource for a known id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P-getResource" };
  repo.save(project);

  const resource: Filesystem = {
    id: newId(),
    type: "filesystem",
    name: "workspace",
    path: "/workspace",
  };
  repo.addResource(project.id, resource);

  const loaded = repo.getResource(resource.id);
  assert.deepEqual(loaded, resource);
});

test("SqliteProjectRepository getResource returns undefined for unknown id", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  assert.equal(repo.getResource("no-such-resource"), undefined);
});

test("SqliteProjectRepository resolveResourceByName returns [id] for matching name in project scope", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P-resolveResource" };
  repo.save(project);

  const resource: Credential = {
    id: newId(),
    type: "credential",
    name: "gh-token",
    provider: "github",
    value: "secret",
  };
  repo.addResource(project.id, resource);

  const ids = repo.resolveResourceByName(project.id, "gh-token");
  assert.deepEqual(ids, [resource.id]);
});

test("SqliteProjectRepository resolveResourceByName returns [] for unknown name", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "P-resolveResourceEmpty" };
  repo.save(project);

  const ids = repo.resolveResourceByName(project.id, "no-such-resource");
  assert.deepEqual(ids, []);
});

test("SqliteProjectRepository listProjects returns all saved projects", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const p1 = { id: newId(), name: "Alpha" };
  const p2 = { id: newId(), name: "Beta" };
  repo.save(p1);
  repo.save(p2);

  const projects = repo.listProjects();
  assert.equal(projects.length, 2);
  const ids = projects.map((p) => p.id).sort();
  assert.deepEqual(ids, [p1.id, p2.id].sort());
});

test("SqliteProjectRepository listProjects returns [] when no projects exist", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  assert.deepEqual(repo.listProjects(), []);
});

// B2 regression: rename must update an existing row, not insert a duplicate
test("SqliteProjectRepository save with same id and new name updates the name (rename)", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const project: Project = { id: newId(), name: "Original Name" };
  repo.save(project);
  repo.save({ id: project.id, name: "Renamed Project" });
  const loaded = repo.get(project.id);
  assert.equal(loaded?.name, "Renamed Project");
});

test("SqliteProjectRepository resolveResourceByName scopes by projectId — same name in two projects returns correct result", () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  const repo = new SqliteProjectRepository(db);
  const p1: Project = { id: newId(), name: "Project-A" };
  const p2: Project = { id: newId(), name: "Project-B" };
  repo.save(p1);
  repo.save(p2);

  const r1: Filesystem = {
    id: newId(),
    type: "filesystem",
    name: "shared-name",
    path: "/workspace/a",
  };
  const r2: Filesystem = {
    id: newId(),
    type: "filesystem",
    name: "shared-name",
    path: "/workspace/b",
  };
  repo.addResource(p1.id, r1);
  repo.addResource(p2.id, r2);

  const idsP1 = repo.resolveResourceByName(p1.id, "shared-name");
  const idsP2 = repo.resolveResourceByName(p2.id, "shared-name");
  assert.deepEqual(idsP1, [r1.id]);
  assert.deepEqual(idsP2, [r2.id]);
});
