import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AddResource } from "./add-resource.ts";
import type {
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import {
  DuplicateNameError,
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../errors.ts";
import type { Resource } from "../../domain/resource.ts";
import type { Project } from "../../domain/project.ts";

// --- Fake ProjectRepository ---
class FakeProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project> = new Map();
  readonly #resources: Map<string, { projectId: string; resource: Resource }> =
    new Map();

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

  listProjects() {
    return [...this.#projects.values()];
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

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZPA";
const INITIATIVE_ID = "01HZZZZZZZZZZZZZZZZZZZZZIN";

describe("AddResource", () => {
  test("AddResource repository variant returns ULID and persists", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver);
    const id = await uc.execute({
      type: "repository",
      projectId: PROJECT_ID,
      name: "backend",
      organization: "acme",
      branch: "main",
      path: "",
    });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty id",
    );
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined, "resource was persisted");
    assert.equal(saved.type, "repository");
    assert.equal(saved.name, "backend");
  });

  test("AddResource credential variant returns ULID and persists", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver);
    const id = await uc.execute({
      type: "credential",
      projectId: PROJECT_ID,
      name: "my-token",
      provider: "github",
      value: "secret",
    });
    assert.ok(typeof id === "string" && id.length > 0);
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.type, "credential");
    assert.equal(saved.name, "my-token");
  });

  test("AddResource notification variant returns ULID and persists", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver);
    const id = await uc.execute({
      type: "notification",
      projectId: PROJECT_ID,
      name: "alerts",
      provider: "slack",
      destination: "#eng",
    });
    assert.ok(typeof id === "string" && id.length > 0);
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.type, "notification");
    assert.equal(saved.name, "alerts");
  });

  test("AddResource ai_provider variant returns ULID and persists", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver);
    const id = await uc.execute({
      type: "ai_provider",
      projectId: PROJECT_ID,
      name: "claude",
      provider: "anthropic",
      model: "claude-3",
    });
    assert.ok(typeof id === "string" && id.length > 0);
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.type, "ai_provider");
    assert.equal(saved.name, "claude");
  });

  test("AddResource filesystem variant returns ULID and persists", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver);
    const id = await uc.execute({
      type: "filesystem",
      projectId: PROJECT_ID,
      name: "workspace",
      path: "/work",
    });
    assert.ok(typeof id === "string" && id.length > 0);
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.type, "filesystem");
    assert.equal(saved.name, "workspace");
  });

  test("AddResource with unknown projectId throws UnknownReferenceError", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({});
    const uc = new AddResource(repo, resolver);
    await assert.rejects(
      () =>
        uc.execute({
          type: "filesystem",
          projectId: "no-such-id",
          name: "x",
          path: "/",
        }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "project");
        assert.equal(err.id, "no-such-id");
        return true;
      },
    );
  });

  test("AddResource with wrong-type projectId throws WrongTypeReferenceError", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({
      [INITIATIVE_ID]: "initiative",
    });
    const uc = new AddResource(repo, resolver);
    await assert.rejects(
      () =>
        uc.execute({
          type: "filesystem",
          projectId: INITIATIVE_ID,
          name: "x",
          path: "/",
        }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal(err.expected, "project");
        assert.equal(err.actual, "initiative");
        assert.equal(err.id, INITIATIVE_ID);
        return true;
      },
    );
  });

  test("AddResource with duplicate name in project throws DuplicateNameError", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver);
    await uc.execute({
      type: "filesystem",
      projectId: PROJECT_ID,
      name: "shared-name",
      path: "/a",
    });
    await assert.rejects(
      () =>
        uc.execute({
          type: "filesystem",
          projectId: PROJECT_ID,
          name: "shared-name",
          path: "/b",
        }),
      (err: unknown) => {
        assert.ok(err instanceof DuplicateNameError);
        assert.equal(err.errorName, "shared-name");
        return true;
      },
    );
  });
});
