import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CreateProject } from "./create-project.ts";
import { RenameProject } from "./rename-project.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import { DuplicateNameError, UnknownReferenceError } from "../errors.ts";
import type { Project } from "../../domain/project.ts";

// --- Minimal fake ProjectRepository ---
class FakeProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project> = new Map();

  save(project: Project): void {
    this.#projects.set(project.id, { ...project });
  }

  get(id: string): Project | undefined {
    return this.#projects.get(id);
  }

  addResource(): void {
    // not needed for these tests
  }

  listResources() {
    return [];
  }

  resolveProjectByName(name: string): string[] {
    const ids: string[] = [];
    for (const p of this.#projects.values()) {
      if (p.name === name) ids.push(p.id);
    }
    return ids;
  }

  getResource(_id: string): undefined {
    return undefined;
  }

  resolveResourceByName(_projectId: string, _name: string): string[] {
    return [];
  }

  listProjects() {
    return [...this.#projects.values()];
  }
}

describe("CreateProject", () => {
  test("create project returns a ULID and persists", async () => {
    const repo = new FakeProjectRepository();
    const uc = new CreateProject(repo);
    const id = await uc.execute({ name: "my-project" });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty id",
    );
    const saved = repo.get(id);
    assert.ok(saved !== undefined, "project was persisted");
    assert.equal(saved.name, "my-project");
  });

  test("create project with duplicate name throws DuplicateNameError", async () => {
    const repo = new FakeProjectRepository();
    const uc = new CreateProject(repo);
    await uc.execute({ name: "clash" });
    await assert.rejects(
      () => uc.execute({ name: "clash" }),
      (err: unknown) => {
        assert.ok(err instanceof DuplicateNameError);
        assert.equal(err.errorName, "clash");
        return true;
      },
    );
  });
});

describe("RenameProject", () => {
  test("rename project changes the name", async () => {
    const repo = new FakeProjectRepository();
    const createUc = new CreateProject(repo);
    const id = await createUc.execute({ name: "old-name" });
    const renameUc = new RenameProject(repo);
    await renameUc.execute({ id, name: "new-name" });
    const saved = repo.get(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.name, "new-name");
  });

  test("rename project with unknown id throws UnknownReferenceError", async () => {
    const repo = new FakeProjectRepository();
    const uc = new RenameProject(repo);
    await assert.rejects(
      () => uc.execute({ id: "nonexistent-id", name: "whatever" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "project");
        assert.equal(err.id, "nonexistent-id");
        return true;
      },
    );
  });
});
