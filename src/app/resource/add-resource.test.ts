import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AddResource } from "./add-resource.ts";
import type { AddResourceInput } from "./add-resource.ts";
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
import { FakeModelCatalog } from "../../model-catalog/fake.ts";
import { UnknownModelError } from "../../model-catalog/port.ts";

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
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
    const id = await uc.execute({
      type: "repository",
      projectId: PROJECT_ID,
      name: "backend",
      remoteUrl: "https://github.com/acme/backend.git",
      branch: "main",
      path: "",
      auth: { kind: "ambient" },
    });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty id",
    );
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined, "resource was persisted");
    assert.equal(saved.type, "repository");
    assert.equal(saved.name, "backend");
    if (saved.type === "repository") {
      assert.equal(
        saved.remoteUrl,
        "https://github.com/acme/backend.git",
        "stored remoteUrl matches input",
      );
    }
  });

  test("AddResource repository with empty path defaults to an absolute path", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
    const id = await uc.execute({
      type: "repository",
      projectId: PROJECT_ID,
      name: "sandbox",
      remoteUrl: "https://github.com/kanthorlabs/sandbox.git",
      branch: "main",
      path: "",
      auth: { kind: "ambient" },
    });
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.type, "repository");
    if (saved.type === "repository") {
      assert.ok(
        saved.path.startsWith("/"),
        `expected absolute path, got: ${saved.path}`,
      );
      assert.equal(
        saved.remoteUrl,
        "https://github.com/kanthorlabs/sandbox.git",
        "stored remoteUrl matches input",
      );
    }
  });

  test("AddResource repository with relative path expands to absolute", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
    const id = await uc.execute({
      type: "repository",
      projectId: PROJECT_ID,
      name: "myrepo",
      remoteUrl: "https://github.com/acme/myrepo.git",
      branch: "main",
      path: "./x",
      auth: { kind: "ambient" },
    });
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.type, "repository");
    if (saved.type === "repository") {
      assert.ok(
        saved.path.startsWith("/"),
        `expected absolute path, got: ${saved.path}`,
      );
      assert.equal(
        saved.remoteUrl,
        "https://github.com/acme/myrepo.git",
        "stored remoteUrl matches input",
      );
    }
  });

  // --- T2 RED tests ---

  test("AddResource repository: remoteUrl and auth input stores resource with correct remoteUrl", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
    const id = await uc.execute({
      type: "repository",
      projectId: PROJECT_ID,
      name: "r",
      remoteUrl: "https://github.com/o/r.git",
      branch: "main",
      path: "",
      auth: { kind: "ambient" },
    });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty id",
    );
    const saved = repo.getResource(id);
    assert.ok(saved !== undefined, "resource was persisted");
    assert.equal(saved.type, "repository");
    if (saved.type === "repository") {
      assert.equal(
        saved.remoteUrl,
        "https://github.com/o/r.git",
        "stored remoteUrl must be the input remoteUrl, not a derived URL",
      );
      assert.deepEqual(
        saved.auth,
        { kind: "ambient" },
        "stored auth must match input",
      );
    }
  });

  test("AddResource repository: organization key is not a valid input field (compile guard)", () => {
    // TypeScript reports TS2353 (excess property) at the PROPERTY line, not the
    // declaration line, so @ts-expect-error must be placed directly before the
    // offending property. Required fields are supplied so the declaration line has
    // no errors; if anyone re-adds 'organization' to AddResourceInput the directive
    // becomes unused (TS2578) and typecheck turns red — keeping the guard live.
    const _guard: AddResourceInput = {
      type: "repository",
      projectId: PROJECT_ID,
      name: "guard",
      remoteUrl: "https://github.com/o/r.git",
      // @ts-expect-error — organization is not a valid property of AddResourceInput.repository (T2)
      organization: "old-org",
      branch: "main",
      path: "",
      auth: { kind: "ambient" },
    };
    void _guard;
  });

  test("AddResource credential variant returns ULID and persists", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
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
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
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
    const uc = new AddResource(
      repo,
      resolver,
      new FakeModelCatalog([{ provider: "anthropic", model: "claude-3" }]),
    );
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
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
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
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
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
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
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
    const uc = new AddResource(repo, resolver, new FakeModelCatalog());
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

  // --- Story 04 T2 D3 — ModelCatalog validation at create ---

  test("AddResource ai_provider: valid pair with accepting catalog returns id", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const catalog = new FakeModelCatalog([
      { provider: "openai-codex", model: "gpt-5.6-terra" },
    ]);
    const uc = new AddResource(repo, resolver, catalog);
    const id = await uc.execute({
      type: "ai_provider",
      projectId: PROJECT_ID,
      name: "gpt",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
    });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty id for a valid (provider, model) pair",
    );
  });

  test("AddResource ai_provider: unknown pair with rejecting catalog throws UnknownModelError", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    const catalog = new FakeModelCatalog(); // no args = reject all
    const uc = new AddResource(repo, resolver, catalog);
    await assert.rejects(
      () =>
        uc.execute({
          type: "ai_provider",
          projectId: PROJECT_ID,
          name: "bad",
          provider: "openai-codex",
          model: "no-such-model",
        }),
      (err: unknown) => {
        assert.ok(
          err instanceof UnknownModelError,
          `expected UnknownModelError, got ${String(err)}`,
        );
        assert.equal(err.provider, "openai-codex", "provider field must match");
        assert.equal(err.model, "no-such-model", "model field must match");
        assert.ok(
          err.message.includes("list model"),
          `message must contain 'list model', got: ${err.message}`,
        );
        return true;
      },
    );
  });

  test("AddResource credential: modelCatalog is not consulted for non-ai_provider types", async () => {
    const repo = new FakeProjectRepository();
    const resolver = new FakeReferenceResolver({ [PROJECT_ID]: "project" });
    // reject-all catalog — must NOT be consulted for credential
    const catalog = new FakeModelCatalog();
    const uc = new AddResource(repo, resolver, catalog);
    const id = await uc.execute({
      type: "credential",
      projectId: PROJECT_ID,
      name: "cred-d3",
      provider: "anthropic",
      value: "sk-test",
    });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "credential must succeed even with a reject-all ModelCatalog",
    );
  });
});
