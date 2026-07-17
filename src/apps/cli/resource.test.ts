import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runCreateRepository,
  runCreateCredential,
  runCreateNotification,
  runCreateAiProvider,
  runCreateFilesystem,
} from "./resource.ts";
import type {
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Resource } from "../../domain/resource.ts";
import type { Project } from "../../domain/project.ts";
import { AddResource } from "../../app/resource/add-resource.ts";

// --- Fake ProjectRepository ---
class FakeProjectRepository implements ProjectRepository {
  readonly #resources: Map<string, Resource> = new Map();

  save(_project: Project): void {}
  get(_id: string): Project | undefined {
    return undefined;
  }
  addResource(_projectId: string, resource: Resource): void {
    this.#resources.set(resource.id, resource);
  }
  getResource(id: string): Resource | undefined {
    return this.#resources.get(id);
  }
  listResources(_projectId: string): Resource[] {
    return [];
  }
  resolveProjectByName(_name: string): string[] {
    return [];
  }
  resolveResourceByName(_projectId: string, _name: string): string[] {
    return [];
  }

  listProjects() {
    return [];
  }
}

// --- Fake ReferenceResolver: always returns 'project' ---
class FakeReferenceResolver implements ReferenceResolver {
  resolveKind(
    _id: string,
  ): "project" | "resource" | "initiative" | "objective" | "task" | undefined {
    return "project";
  }
}

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZPA";

function makeAddResource(): AddResource {
  return new AddResource(
    new FakeProjectRepository(),
    new FakeReferenceResolver(),
  );
}

describe("runCreateRepository", () => {
  test("runCreateRepository valid flags returns exitCode 0 with ULID in stdout", async () => {
    const result = await runCreateRepository(
      {
        project: PROJECT_ID,
        name: "backend",
        organization: "acme",
        branch: "main",
      },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the ULID)",
    );
    assert.match(result.stdout[0]!, /^[0-9A-Z]{26}$/, "id is a ULID");
  });

  test("runCreateRepository missing --organization returns exit 1 with missing flag error", async () => {
    const result = await runCreateRepository(
      { project: PROJECT_ID, name: "backend", branch: "main" },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes("--organization"),
      `expected --organization in error, got: ${result.stderr[0]}`,
    );
  });
});

describe("runCreateCredential", () => {
  test("runCreateCredential valid flags returns exitCode 0 with ULID in stdout", async () => {
    const result = await runCreateCredential(
      {
        project: PROJECT_ID,
        name: "my-token",
        provider: "github",
        value: "secret",
      },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the ULID)",
    );
  });

  test("runCreateCredential missing --value returns exit 1 with missing flag error", async () => {
    const result = await runCreateCredential(
      { project: PROJECT_ID, name: "my-token", provider: "github" },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes("--value"),
      `expected --value in error, got: ${result.stderr[0]}`,
    );
  });
});

describe("runCreateNotification", () => {
  test("runCreateNotification valid flags returns exitCode 0 with ULID in stdout", async () => {
    const result = await runCreateNotification(
      {
        project: PROJECT_ID,
        name: "alerts",
        provider: "slack",
        destination: "#eng",
      },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the ULID)",
    );
  });

  test("runCreateNotification missing --destination returns exit 1 with missing flag error", async () => {
    const result = await runCreateNotification(
      { project: PROJECT_ID, name: "alerts", provider: "slack" },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes("--destination"),
      `expected --destination in error, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateNotification invalid provider value returns exit 1 with one-line error", async () => {
    const result = await runCreateNotification(
      {
        project: PROJECT_ID,
        name: "alerts",
        provider: "discord",
        destination: "#eng",
      },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.length === 1, "exactly one error line");
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

describe("runCreateAiProvider", () => {
  test("runCreateAiProvider valid flags returns exitCode 0 with ULID in stdout", async () => {
    const result = await runCreateAiProvider(
      {
        project: PROJECT_ID,
        name: "claude",
        provider: "anthropic",
        model: "claude-3",
      },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the ULID)",
    );
  });

  test("runCreateAiProvider missing --model returns exit 1 with missing flag error", async () => {
    const result = await runCreateAiProvider(
      { project: PROJECT_ID, name: "claude", provider: "anthropic" },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes("--model"),
      `expected --model in error, got: ${result.stderr[0]}`,
    );
  });
});

describe("runCreateFilesystem", () => {
  test("runCreateFilesystem valid flags returns exitCode 0 with ULID in stdout", async () => {
    const result = await runCreateFilesystem(
      { project: PROJECT_ID, name: "workspace", path: "/work" },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the ULID)",
    );
  });

  test("runCreateFilesystem missing --path returns exit 1 with missing flag error", async () => {
    const result = await runCreateFilesystem(
      { project: PROJECT_ID, name: "workspace" },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes("--path"),
      `expected --path in error, got: ${result.stderr[0]}`,
    );
  });
});
