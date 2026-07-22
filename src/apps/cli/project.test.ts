import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCreateProject, runRenameProject } from "./project.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Project } from "../../domain/project.ts";
import { CreateProject } from "../../app/project/create-project.ts";
import { RenameProject } from "../../app/project/rename-project.ts";

// --- Minimal fake ProjectRepository that returns a fixed id on save ---
class MockProjectRepository implements ProjectRepository {
  readonly #projects: Map<string, Project> = new Map();
  readonly #fixedId: string;

  constructor(fixedId: string) {
    this.#fixedId = fixedId;
  }

  save(project: Project): void {
    this.#projects.set(project.id, { ...project });
  }

  get(id: string): Project | undefined {
    return this.#projects.get(id);
  }

  addResource(): void {}

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

  getFixedId(): string {
    return this.#fixedId;
  }
}

describe("runCreateProject handler", () => {
  test("runCreateProject returns exitCode 0, stdout [id], stderr [created msg] on success", async () => {
    const repo = new MockProjectRepository("unused");
    const result = await runCreateProject(
      { name: "demo" },
      new CreateProject(repo),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the id)",
    );
    assert.match(result.stdout[0]!, /^[0-9A-Z]{26}$/, "id is a ULID");
    assert.ok(result.stderr.length === 1);
    // 007.9 Story 03 item B: every `create` handler emits the same
    // `<kind> created: <id>` shape on stderr (id, not name — consistent
    // across all create* handlers so scripts can rely on one format).
    assert.equal(
      result.stderr[0],
      `project created: ${result.stdout[0]}`,
      "stderr must be the consistent '<kind> created: <id>' line",
    );
  });

  test("runCreateProject returns exitCode 1 with error line on DuplicateNameError", async () => {
    const repo = new MockProjectRepository("unused");
    const uc = new CreateProject(repo);
    // create once first
    await runCreateProject({ name: "clash" }, uc);
    // second call should get a duplicate
    const result = await runCreateProject({ name: "clash" }, uc);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(result.stderr.length === 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

describe("runRenameProject handler", () => {
  test("runRenameProject returns exitCode 0 on success", async () => {
    const repo = new MockProjectRepository("unused");
    // create a project first
    const createResult = await runCreateProject(
      { name: "original" },
      new CreateProject(repo),
    );
    const id = createResult.stdout[0]!;
    const result = await runRenameProject(
      { id, name: "renamed" },
      new RenameProject(repo),
    );
    assert.equal(result.exitCode, 0);
  });

  test("runRenameProject returns exitCode 1 with error line for unknown id", async () => {
    const repo = new MockProjectRepository("unused");
    const result = await runRenameProject(
      { id: "no-such-id", name: "whatever" },
      new RenameProject(repo),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});
