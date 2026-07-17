import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GetProject } from "./get-project.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Project } from "../../domain/project.ts";
import type { Resource } from "../../domain/resource.ts";

const KNOWN_ID = "01JWZYQR00000000000000000P";
const UNKNOWN_ID = "01JWZYQR00000000000000000X";

class FakeProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project>;

  constructor(projects: Map<string, Project>) {
    this.#projects = projects;
  }

  save(project: Project): void {
    this.#projects.set(project.id, { ...project });
  }

  get(id: string): Project | undefined {
    return this.#projects.get(id);
  }

  addResource(_projectId: string, _resource: Resource): void {}

  getResource(_id: string): Resource | undefined {
    return undefined;
  }

  listResources(_projectId: string): Resource[] {
    return [];
  }

  listProjects(): Project[] {
    return [...this.#projects.values()];
  }

  resolveProjectByName(_name: string): string[] {
    return [];
  }

  resolveResourceByName(_projectId: string, _name: string): string[] {
    return [];
  }
}

describe("GetProject", () => {
  test("returns the project for a known id", async () => {
    const project: Project = { id: KNOWN_ID, name: "my-project" };
    const repo = new FakeProjectRepository(new Map([[KNOWN_ID, project]]));
    const uc = new GetProject(repo);
    const result = await uc.execute({ id: KNOWN_ID });
    assert.equal(result.id, KNOWN_ID);
    assert.equal(result.name, "my-project");
  });

  test("throws UnknownReferenceError for an unknown id", async () => {
    const repo = new FakeProjectRepository(new Map());
    const uc = new GetProject(repo);
    await assert.rejects(
      () => uc.execute({ id: UNKNOWN_ID }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "project");
        assert.equal(err.id, UNKNOWN_ID);
        return true;
      },
    );
  });
});
