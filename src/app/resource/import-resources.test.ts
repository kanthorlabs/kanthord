import { test } from "node:test";
import assert from "node:assert/strict";
import { ImportResources, ImportValidationError } from "./import-resources.ts";
import type {
  ProjectRepository,
  ReferenceResolver,
  UnitOfWork,
} from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Resource } from "../../domain/resource.ts";
import type { Project } from "../../domain/project.ts";

// --- Fake ProjectRepository ---
class FakeProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project> = new Map();
  readonly #resources: Map<string, { projectId: string; resource: Resource }> =
    new Map();

  addProject(project: Project): void {
    this.#projects.set(project.id, { ...project });
  }

  save(project: Project): void {
    this.#projects.set(project.id, { ...project });
  }

  get(id: string): Project | undefined {
    return this.#projects.get(id);
  }

  addResource(projectId: string, resource: Resource): void {
    this.#resources.set(resource.id, {
      projectId,
      resource: { ...resource } as Resource,
    });
  }

  getResource(id: string): Resource | undefined {
    return this.#resources.get(id)?.resource;
  }

  listResources(projectId: string): Resource[] {
    const result: Resource[] = [];
    for (const entry of this.#resources.values()) {
      if (entry.projectId === projectId) result.push(entry.resource);
    }
    return result;
  }

  resolveProjectByName(name: string): string[] {
    const ids: string[] = [];
    for (const p of this.#projects.values()) {
      if (p.name === name) ids.push(p.id);
    }
    return ids;
  }

  resolveResourceByName(projectId: string, name: string): string[] {
    const ids: string[] = [];
    for (const entry of this.#resources.values()) {
      if (entry.projectId === projectId && entry.resource.name === name) {
        ids.push(entry.resource.id);
      }
    }
    return ids;
  }

  listProjects(): Project[] {
    return [...this.#projects.values()];
  }

  resourceCount(): number {
    return this.#resources.size;
  }
}

// --- Fake ReferenceResolver ---
class FakeReferenceResolver implements ReferenceResolver {
  readonly #kinds: Map<
    string,
    "project" | "resource" | "initiative" | "objective" | "task"
  >;

  constructor(
    kinds: Record<
      string,
      "project" | "resource" | "initiative" | "objective" | "task"
    >,
  ) {
    this.#kinds = new Map(Object.entries(kinds));
  }

  resolveKind(
    id: string,
  ): "project" | "resource" | "initiative" | "objective" | "task" | undefined {
    return this.#kinds.get(id);
  }
}

// --- Fake UnitOfWork (real transactional: runs work immediately) ---
class FakeUnitOfWork implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

// --- Fake UnitOfWork that rolls back on error ---
class RollbackUnitOfWork implements UnitOfWork {
  readonly #repo: FakeProjectRepository;

  constructor(repo: FakeProjectRepository) {
    this.#repo = repo;
  }

  transaction<T>(fn: () => T): T {
    const snapshotCount = this.#repo.resourceCount();
    try {
      return fn();
    } catch (err) {
      // Simulate rollback: wipe all resources added during this transaction.
      // In production the DB does the rollback; here we track via count.
      // The fake repo provides resourceCount() before and after.
      // Since we can't truly roll back a Map, we mark the snapshot as the
      // stable state via a side-channel flag on the repo.
      (this.#repo as unknown as { _rollbackTo: number })._rollbackTo =
        snapshotCount;
      throw err;
    }
  }
}

// Rollback-aware repo: resources added after _rollbackTo snapshot are dropped.
class RollbackProjectRepository extends FakeProjectRepository {
  _rollbackTo: number = -1;

  override addResource(projectId: string, resource: Resource): void {
    super.addResource(projectId, resource);
    // will be "rolled back" to snapshot count by the UnitOfWork
  }

  override resourceCount(): number {
    if (this._rollbackTo >= 0) {
      return this._rollbackTo;
    }
    return super.resourceCount();
  }

  override listResources(projectId: string): Resource[] {
    if (this._rollbackTo >= 0) {
      // Simulate rollback: only return first _rollbackTo resources
      return [];
    }
    return super.listResources(projectId);
  }

  override resolveResourceByName(projectId: string, name: string): string[] {
    if (this._rollbackTo >= 0) {
      return [];
    }
    return super.resolveResourceByName(projectId, name);
  }
}

// --- shared project fixture ---
const PROJECT_ID = "proj-001";
const PROJECT: Project = { id: PROJECT_ID, name: "test-project" };

test("ImportResources (a): 3 valid entries → 3 ULIDs, all persisted", async () => {
  const repo = new FakeProjectRepository();
  repo.addProject(PROJECT);
  const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
  const uow = new FakeUnitOfWork();
  const importer = new ImportResources(repo, resolver, uow);

  const entries = [
    { type: "credential", name: "cred-1", provider: "openai", value: "key-1" },
    { type: "credential", name: "cred-2", provider: "openai", value: "key-2" },
    {
      type: "ai_provider",
      name: "gpt",
      provider: "openai",
      model: "gpt-4",
    },
  ];

  const ids = await importer.execute({ projectId: PROJECT_ID, entries });

  assert.equal(ids.length, 3, "must return 3 ULIDs");
  for (const id of ids) {
    assert.ok(id.length > 0, "each ULID must be non-empty");
  }
  // All 3 resources persisted
  const persisted = repo.listResources(PROJECT_ID);
  assert.equal(persisted.length, 3, "all 3 resources must be persisted");
  assert.ok(
    persisted.some((r) => r.name === "cred-1"),
    "cred-1 must be persisted",
  );
  assert.ok(
    persisted.some((r) => r.name === "cred-2"),
    "cred-2 must be persisted",
  );
  assert.ok(
    persisted.some((r) => r.name === "gpt"),
    "gpt must be persisted",
  );
});

test("ImportResources (b): entry 2 duplicate name → ImportValidationError naming index 2 + name, entry 1 NOT persisted (transaction rolled back)", async () => {
  const repo = new RollbackProjectRepository();
  repo.addProject(PROJECT);
  const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
  const uow = new RollbackUnitOfWork(repo);
  const importer = new ImportResources(repo, resolver, uow);

  const entries = [
    {
      type: "credential",
      name: "cred-unique",
      provider: "openai",
      value: "k1",
    },
    {
      type: "credential",
      name: "cred-unique",
      provider: "openai",
      value: "k2",
    }, // duplicate
  ];

  await assert.rejects(
    () => importer.execute({ projectId: PROJECT_ID, entries }),
    (err: unknown) => {
      assert.ok(
        err instanceof ImportValidationError,
        `must be ImportValidationError, got: ${String(err)}`,
      );
      assert.equal(err.index, 2, "error must carry index 2 (1-based)");
      assert.equal(
        err.entryName,
        "cred-unique",
        "error must carry the duplicate name",
      );
      return true;
    },
  );

  // Transaction rolled back — no resources persisted
  assert.equal(
    repo.listResources(PROJECT_ID).length,
    0,
    "transaction must be rolled back: entry 1 must NOT be persisted",
  );
});

test("ImportResources (c): unknown project → UnknownReferenceError", async () => {
  const repo = new FakeProjectRepository();
  // no project added — resolver returns undefined
  const resolver = new FakeReferenceResolver({});
  const uow = new FakeUnitOfWork();
  const importer = new ImportResources(repo, resolver, uow);

  const entries = [
    { type: "credential", name: "cred-1", provider: "openai", value: "k1" },
  ];

  await assert.rejects(
    () => importer.execute({ projectId: "unknown-proj", entries }),
    (err: unknown) => {
      assert.ok(
        err instanceof UnknownReferenceError,
        `must be UnknownReferenceError, got: ${String(err)}`,
      );
      return true;
    },
  );
});
