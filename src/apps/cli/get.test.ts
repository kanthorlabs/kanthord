import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGetProject } from "./get.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type { Project } from "../../domain/project.ts";
import type { Resource } from "../../domain/resource.ts";
import { GetProject } from "../../app/project/get-project.ts";

const UNKNOWN_ID = "01JWZYQR00000000000000000X";

class FakeProjectRepository implements ProjectRepository {
  save(_project: Project): void {}
  get(_id: string): Project | undefined {
    return undefined;
  }
  addResource(_projectId: string, _resource: Resource): void {}
  getResource(_id: string): Resource | undefined {
    return undefined;
  }
  listResources(_projectId: string): Resource[] {
    return [];
  }
  listProjects(): Project[] {
    return [];
  }
  resolveProjectByName(_name: string): string[] {
    return [];
  }
  resolveResourceByName(_projectId: string, _name: string): string[] {
    return [];
  }
}

describe("runGetProject", () => {
  test("unknown id returns exit 1 with one-line error on stderr", async () => {
    const args: Record<string, unknown> = { id: UNKNOWN_ID };
    const result = await runGetProject(
      args,
      new GetProject(new FakeProjectRepository()),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1, "stderr must have exactly one line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `stderr line must start with "error:": ${result.stderr[0]}`,
    );
    assert.deepEqual(result.stdout, [], "stdout must be empty on error");
  });
});
