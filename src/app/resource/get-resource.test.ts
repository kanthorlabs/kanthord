import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GetResource, toResourceView } from "./get-resource.ts";
import type { ResourceView } from "./get-resource.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type {
  Resource,
  Repository,
  Credential,
} from "../../domain/resource.ts";
import { UnknownReferenceError } from "../errors.ts";

// ---------------------------------------------------------------------------
// Minimal fake ProjectRepository
// ---------------------------------------------------------------------------
function makeFakeRepo(resources: Resource[]): ProjectRepository {
  return {
    save() {},
    get() {
      return undefined;
    },
    addResource() {},
    getResource(id: string) {
      return resources.find((r) => r.id === id);
    },
    listResources() {
      return resources;
    },
    listProjects() {
      return [];
    },
    resolveProjectByName() {
      return [];
    },
    resolveResourceByName() {
      return [];
    },
  } as unknown as ProjectRepository;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CANARY = "CANARY_SECRET_VALUE";

const cred: Credential = {
  id: "cred-1",
  projectId: "proj-1",
  type: "credential",
  name: "k1",
  provider: "anthropic",
  value: CANARY,
};

const repo: Repository = {
  id: "repo-1",
  projectId: "proj-1",
  type: "repository",
  name: "home",
  remoteUrl: "https://github.com/acme/api.git",
  branch: "main",
  path: "/tmp/repos/home",
  auth: { kind: "ambient" },
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("src/app/resource/get-resource.ts", () => {
  describe("toResourceView — structural omission of credential value", () => {
    test("toResourceView credential: value key is structurally absent from the view", () => {
      const view = toResourceView(cred);
      assert.equal(
        "value" in view,
        false,
        "credential view must not have a 'value' key (structural omission)",
      );
    });

    test("toResourceView credential: CANARY_SECRET_VALUE absent from JSON.stringify output", () => {
      const view = toResourceView(cred);
      const json = JSON.stringify(view);
      assert.equal(
        json.includes(CANARY),
        false,
        "CANARY_SECRET_VALUE must not appear in serialized credential view",
      );
    });

    test("toResourceView credential: view carries type, id, projectId, name, provider", () => {
      const view = toResourceView(cred) as Extract<
        ResourceView,
        { type: "credential" }
      >;
      assert.equal(view.type, "credential");
      assert.equal(view.id, "cred-1");
      assert.equal(view.projectId, "proj-1");
      assert.equal(view.name, "k1");
      assert.equal(view.provider, "anthropic");
    });
  });

  describe("toResourceView — repository shape", () => {
    test("toResourceView repository: view has remoteUrl and auth, no organization", () => {
      const view = toResourceView(repo) as Extract<
        ResourceView,
        { type: "repository" }
      >;
      assert.equal(view.remoteUrl, "https://github.com/acme/api.git");
      assert.deepEqual(view.auth, { kind: "ambient" });
      assert.equal(
        "organization" in view,
        false,
        "repository view must not have an 'organization' key",
      );
    });
  });

  describe("GetResource", () => {
    test("GetResource.execute returns toResourceView result for known id", () => {
      const projectRepo = makeFakeRepo([cred, repo]);
      const uc = new GetResource(projectRepo);
      const view = uc.execute("cred-1");
      assert.equal(view.type, "credential");
      assert.equal(view.id, "cred-1");
      assert.equal(
        "value" in view,
        false,
        "value must be absent from the returned view",
      );
    });

    test("GetResource.execute with repository id returns correct remoteUrl", () => {
      const projectRepo = makeFakeRepo([cred, repo]);
      const uc = new GetResource(projectRepo);
      const view = uc.execute("repo-1") as Extract<
        ResourceView,
        { type: "repository" }
      >;
      assert.equal(view.remoteUrl, "https://github.com/acme/api.git");
    });

    test("GetResource.execute throws UnknownReferenceError for unknown id", () => {
      const projectRepo = makeFakeRepo([]);
      const uc = new GetResource(projectRepo);
      assert.throws(
        () => uc.execute("does-not-exist"),
        (err: unknown) => {
          assert.ok(
            err instanceof UnknownReferenceError,
            "should be UnknownReferenceError",
          );
          return true;
        },
      );
    });
  });
});
