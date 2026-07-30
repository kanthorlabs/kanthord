import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ListProjects } from "./list-projects.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Project } from "../../domain/project.ts";

/**
 * Minimal fake ProjectRepository that records `listProjects()` calls and
 * returns whatever the test installed. Mirrors the shape used in
 * `create-project.test.ts` but exposes only the surface this use case touches.
 */
class FakeProjectRepository implements ProjectRepository {
  #projects: Project[] = [];
  #listProjectsCalls = 0;
  #lastListProjectsArg: unknown[] = [];

  seed(projects: Project[]): void {
    this.#projects = projects;
  }

  listProjects(...args: unknown[]): Project[] {
    this.#listProjectsCalls += 1;
    this.#lastListProjectsArg = args;
    return this.#projects;
  }

  // Unused surface — satisfies the structural type.
  save(): void {}
  get(): Project | undefined {
    return undefined;
  }
  addResource(): void {}
  getResource(): undefined {
    return undefined;
  }
  listResources(): never[] {
    return [];
  }
  listResourcesByProject(): never[] {
    return [];
  }
  resolveProjectByName(): never[] {
    return [];
  }
  resolveResourceByName(): never[] {
    return [];
  }

  get listProjectsCalls(): number {
    return this.#listProjectsCalls;
  }
  get lastListProjectsArg(): unknown[] {
    return this.#lastListProjectsArg;
  }
}

describe("ListProjects", () => {
  test("empty repository returns an empty array", () => {
    const repo = new FakeProjectRepository();
    const uc = new ListProjects(repo);
    const result = uc.execute();
    assert.deepEqual(result, []);
  });

  test("returns the repository rows unchanged (no in-memory re-sort)", () => {
    const repo = new FakeProjectRepository();
    repo.seed([
      { id: "p2", name: "b" },
      { id: "p1", name: "a" },
    ]);
    const uc = new ListProjects(repo);
    const result = uc.execute();
    assert.deepEqual(result, [
      { id: "p2", name: "b" },
      { id: "p1", name: "a" },
    ]);
  });

  test("execute() calls listProjects() exactly once with no arguments", () => {
    const repo = new FakeProjectRepository();
    repo.seed([{ id: "p1", name: "alpha" }]);
    const uc = new ListProjects(repo);
    uc.execute();
    assert.equal(repo.listProjectsCalls, 1);
    assert.deepEqual(repo.lastListProjectsArg, []);
  });

  test("execute({ name: 'alpha' }) returns only the exact match", () => {
    const repo = new FakeProjectRepository();
    repo.seed([
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
    const uc = new ListProjects(repo);
    const result = uc.execute({ name: "alpha" });
    assert.deepEqual(result, [{ id: "p1", name: "alpha" }]);
    assert.deepEqual(repo.lastListProjectsArg, []);
  });

  test("execute({ name: 'ALPHA' }) returns [] — exact match only, no case folding", () => {
    const repo = new FakeProjectRepository();
    repo.seed([{ id: "p1", name: "alpha" }]);
    const uc = new ListProjects(repo);
    assert.deepEqual(uc.execute({ name: "ALPHA" }), []);
  });

  test("execute({ name: 'alph' }) returns [] — exact match only, no substring", () => {
    const repo = new FakeProjectRepository();
    repo.seed([{ id: "p1", name: "alpha" }]);
    const uc = new ListProjects(repo);
    assert.deepEqual(uc.execute({ name: "alph" }), []);
  });

  test("execute({}) with no name returns all rows", () => {
    const repo = new FakeProjectRepository();
    repo.seed([
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
    const uc = new ListProjects(repo);
    assert.deepEqual(uc.execute({}), [
      { id: "p1", name: "alpha" },
      { id: "p2", name: "beta" },
    ]);
  });
});
