import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GetResource } from "./get-resource.ts";
import { toResourceView } from "./resource-view.ts";
import type { ResourceView } from "./resource-view.ts";
import type {
  ProjectRepository,
  PublicationRepository,
  PublicationRecord,
} from "../../storage/port.ts";
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
// Minimal fake PublicationRepository (007.13 Story C)
// ---------------------------------------------------------------------------
function makeFakePublicationRepo(records: Map<string, PublicationRecord>) {
  return {
    getPublication(repoId: string, branch: string) {
      return records.get(`${repoId}:${branch}`);
    },
    setPublication(repoId: string, branch: string, record: PublicationRecord) {
      records.set(`${repoId}:${branch}`, record);
    },
    // 007.12 reconciliation: delivery publishes the initiative branch
    // (kanthord/init/<id>), not the repo's configured branch, so the "what
    // was last published" lookup must scan across branches, most-recent
    // insertion wins (Map preserves insertion order).
    getLatestPublication(repoId: string) {
      let latest: PublicationRecord | undefined;
      for (const [key, record] of records) {
        if (key.startsWith(`${repoId}:`)) latest = record;
      }
      return latest;
    },
  };
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

  describe("GetResource — publication state on the repository view (007.13 Story C)", () => {
    test("GetResource.execute reports publication{state:'published', remoteOID} when a publication record exists", () => {
      const projectRepo = makeFakeRepo([repo]);
      const publicationRepo = makeFakePublicationRepo(
        new Map([
          [
            "repo-1:main",
            { state: "published", remoteOID: "abc123" } as PublicationRecord,
          ],
        ]),
      );
      const uc = new GetResource(projectRepo, publicationRepo);
      const view = uc.execute("repo-1") as Extract<
        ResourceView,
        { type: "repository" }
      >;
      assert.deepEqual(view.publication, {
        state: "published",
        remoteOID: "abc123",
      });
    });

    test("GetResource.execute reports the publication of the most-recently-published branch, not the repo's configured branch (007.12 reconciliation)", () => {
      // repo.branch is "main" (see the `repo` fixture above), but delivery
      // under 007.12 publishes the initiative branch instead — GetResource
      // must NOT key its lookup on view.branch, or it would always miss this.
      const projectRepo = makeFakeRepo([repo]);
      const publicationRepo = makeFakePublicationRepo(
        new Map([
          [
            "repo-1:main",
            { state: "published", remoteOID: "main-oid" } as PublicationRecord,
          ],
          [
            "repo-1:kanthord/init/X",
            {
              state: "published",
              remoteOID: "deadbeef",
            } as PublicationRecord,
          ],
        ]),
      );
      const uc = new GetResource(projectRepo, publicationRepo);
      const view = uc.execute("repo-1") as Extract<
        ResourceView,
        { type: "repository" }
      >;
      assert.deepEqual(
        view.publication,
        { state: "published", remoteOID: "deadbeef" },
        "must report the init-branch publication (getLatestPublication), not the configured-branch one",
      );
    });

    test("GetResource.execute reports publication null when no publication record exists for the repo's branch", () => {
      const projectRepo = makeFakeRepo([repo]);
      const publicationRepo = makeFakePublicationRepo(new Map());
      const uc = new GetResource(projectRepo, publicationRepo);
      const view = uc.execute("repo-1") as Extract<
        ResourceView,
        { type: "repository" }
      >;
      assert.equal(
        view.publication,
        null,
        "no stored publication record must surface as publication: null",
      );
    });
  });
});
