import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  runCreateRepository,
  runCreateCredential,
  runCreateNotification,
  runCreateAiProvider,
  runCreateFilesystem,
  runGetResource,
} from "./resource.ts";
import type {
  ProjectRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Resource } from "../../domain/resource.ts";
import type { Project } from "../../domain/project.ts";
import { AddResource } from "../../app/resource/add-resource.ts";
import { FakeModelCatalog } from "../../model-catalog/fake.ts";
import { GetResource } from "../../app/resource/get-resource.ts";
import type { ResourceView } from "../../app/resource/get-resource.ts";
import { UnknownReferenceError } from "../../app/errors.ts";

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

function makeAddResource(
  validPairs: Array<{ provider: string; model: string }> = [
    { provider: "anthropic", model: "claude-3" },
  ],
): AddResource {
  return new AddResource(
    new FakeProjectRepository(),
    new FakeReferenceResolver(),
    new FakeModelCatalog(validPairs),
  );
}

describe("runCreateRepository", () => {
  test("runCreateRepository with --remote-url and ambient auth returns exitCode 0 with ULID", async () => {
    const result = await runCreateRepository(
      {
        project: PROJECT_ID,
        name: "backend",
        "remote-url": "https://github.com/o/r.git",
        branch: "main",
        auth: "ambient",
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

  test("runCreateRepository missing --remote-url returns exitCode 1", async () => {
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
      result.stderr[0]!.includes("--remote-url"),
      `expected --remote-url in error, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateRepository with embedded userinfo in --remote-url returns exitCode 1 and mentions remoteUrl", async () => {
    // EmbeddedCredentialError is thrown by domain; toResult must map it to exitCode:1
    const result = await runCreateRepository(
      {
        project: PROJECT_ID,
        name: "backend",
        "remote-url": "https://x-access-token:sk@github.com/o/r.git",
        branch: "main",
        auth: "ambient",
      },
      makeAddResource(),
    );
    assert.equal(
      result.exitCode,
      1,
      `expected exitCode 1 for embedded userinfo, got ${result.exitCode}`,
    );
    assert.ok(
      result.stderr.length > 0 &&
        result.stderr[0]!.toLowerCase().includes("remoteurl"),
      `expected 'remoteUrl' in error message, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateRepository with --organization only (no --remote-url) returns exitCode 1", async () => {
    // --organization is no longer a valid flag; --remote-url is required
    const result = await runCreateRepository(
      {
        project: PROJECT_ID,
        name: "backend",
        organization: "acme",
        branch: "main",
      },
      makeAddResource(),
    );
    assert.equal(result.exitCode, 1);
  });
});

describe("runCreateCredential", () => {
  // T3 — migrated: old fixture used --value; now uses --value-file (lane: TE owns test files)
  test("runCreateCredential with --value-file reads value from file: exitCode 0 + ULID + value absent from output", async () => {
    const tmpFile = join(tmpdir(), `cred-test-${Date.now()}.txt`);
    await writeFile(tmpFile, "sk-ok\n");
    try {
      const result = await runCreateCredential(
        {
          project: PROJECT_ID,
          name: "my-token",
          provider: "github",
          "value-file": tmpFile,
        },
        makeAddResource(),
        { timeoutMs: 5000 },
      );
      assert.equal(
        result.exitCode,
        0,
        `expected exitCode 0 with --value-file, got ${result.exitCode}: ${result.stderr.join(" ")}`,
      );
      assert.ok(
        result.stdout.length === 1,
        "stdout has exactly one entry (the ULID)",
      );
      assert.ok(
        !result.stdout.join("").includes("sk-ok"),
        "value must not appear in stdout (D4 canary)",
      );
      assert.ok(
        !result.stderr.join("").includes("sk-ok"),
        "value must not appear in stderr (D4 canary)",
      );
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  // T3 — migrated: old test checked for missing --value; now checks for missing --value-file
  test("runCreateCredential missing --value-file and no TTY returns exitCode 1 mentioning value-file", async () => {
    const result = await runCreateCredential(
      { project: PROJECT_ID, name: "my-token", provider: "github" },
      makeAddResource(),
      { timeoutMs: 5000 },
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
    assert.ok(
      result.stderr[0]!.includes("value-file"),
      `expected 'value-file' in error, got: ${result.stderr[0]}`,
    );
  });

  // T3 RED — (a): --value (old flag) must be rejected now that the flag is removed
  test("runCreateCredential with --value (old flag) returns exitCode 1: flag removed", async () => {
    const result = await runCreateCredential(
      {
        project: PROJECT_ID,
        name: "my-token",
        provider: "github",
        value: "sk-plaintext",
      },
      makeAddResource(),
      { timeoutMs: 5000 },
    );
    assert.equal(
      result.exitCode,
      1,
      `expected exitCode 1 (--value removed), got ${result.exitCode}`,
    );
  });

  // T3 RED — (e): --value-file - with never-emitting stdin + timeout 50ms returns exitCode 1 with "timeout"
  test("runCreateCredential with --value-file - and never-emitting stdin + value-timeout 50ms returns exitCode 1 with timeout", async () => {
    const neverEmit = new PassThrough();
    const result = await runCreateCredential(
      {
        project: PROJECT_ID,
        name: "my-token",
        provider: "github",
        "value-file": "-",
        "value-timeout": "50ms",
      },
      makeAddResource(),
      { timeoutMs: 10_000, stdin: neverEmit },
    );
    assert.equal(
      result.exitCode,
      1,
      `expected exitCode 1 on timeout, got ${result.exitCode}`,
    );
    assert.ok(
      result.stderr.join("").toLowerCase().includes("timeout"),
      `expected "timeout" in stderr, got: ${result.stderr.join("")}`,
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

// ---------------------------------------------------------------------------
// runGetResource — T2
// ---------------------------------------------------------------------------

// Mock GetResource backed by a FakeProjectRepository with canned fixtures.
const CANARY_T2 = "CANARY_SECRET_VALUE";

const mockGetResource = (() => {
  const fakeRepo = new FakeProjectRepository();
  // Credential with canary value — toResourceView will omit the value field.
  fakeRepo.addResource("proj-t2", {
    id: "cred-t2",
    projectId: "proj-t2",
    type: "credential",
    name: "k1",
    provider: "anthropic",
    value: CANARY_T2,
  });
  // Repository fixture for remoteUrl plain-text assertion.
  fakeRepo.addResource("proj-t2", {
    id: "repo-t2",
    projectId: "proj-t2",
    type: "repository",
    name: "home",
    remoteUrl: "https://github.com/acme/api.git",
    branch: "main",
    path: "/tmp/repos/home",
    auth: { kind: "ambient" },
  });
  // AIProvider fixture for --json test.
  fakeRepo.addResource("proj-t2", {
    id: "aip-t2",
    projectId: "proj-t2",
    type: "ai_provider",
    name: "gpt",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
  });
  return new GetResource(fakeRepo);
})();

describe("runGetResource", () => {
  test("runGetResource credential: CANARY_SECRET_VALUE absent from stdout (canary)", async () => {
    const result = await runGetResource({ id: "cred-t2" }, mockGetResource);
    assert.equal(result.exitCode, 0);
    const out = result.stdout.join("");
    assert.equal(
      out.includes(CANARY_T2),
      false,
      `CANARY_SECRET_VALUE must not appear in runGetResource stdout — got: ${out}`,
    );
  });

  test("runGetResource repository plain-text: stdout includes remoteUrl", async () => {
    const result = await runGetResource({ id: "repo-t2" }, mockGetResource);
    assert.equal(result.exitCode, 0);
    const out = result.stdout.join("");
    assert.ok(
      out.includes("remoteUrl"),
      `plain-text output must include 'remoteUrl' key — got: ${out}`,
    );
  });

  test("runGetResource ai_provider --json: valid JSON with type ai_provider and no value key", async () => {
    const result = await runGetResource(
      { id: "aip-t2", json: true },
      mockGetResource,
    );
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout.join("")) as ResourceView;
    assert.equal(parsed.type, "ai_provider");
    assert.equal(
      "value" in parsed,
      false,
      "--json output must not contain a value key",
    );
  });

  test("runGetResource unknown id: exitCode 1", async () => {
    const result = await runGetResource(
      { id: "does-not-exist" },
      mockGetResource,
    );
    assert.equal(result.exitCode, 1);
  });
});
