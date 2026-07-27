import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ListResources } from "./list-resources.ts";
import type { ProjectRepository } from "../../storage/port.ts";
import type {
  Resource,
  Credential,
  Repository,
} from "../../domain/resource.ts";

// ---------------------------------------------------------------------------
// 007.9 Story 03 item A — ListResources: project-scoped, type-filtered,
// secret-redacted resource query (mirrors GetResource/toResourceView).
// ---------------------------------------------------------------------------

const CANARY = "CANARY_SECRET_VALUE";
const PROJECT_ID = "proj-1";

const credA: Credential = {
  id: "cred-a",
  projectId: PROJECT_ID,
  type: "credential",
  name: "k1",
  provider: "anthropic",
  value: CANARY,
};

const credB: Credential = {
  id: "cred-b",
  projectId: PROJECT_ID,
  type: "credential",
  name: "k2",
  provider: "openai",
  value: "another-secret",
};

const repoResource: Repository = {
  id: "repo-a",
  projectId: PROJECT_ID,
  type: "repository",
  name: "home",
  remoteUrl: "https://github.com/acme/api.git",
  branch: "main",
  path: "/tmp/repos/home",
  auth: { kind: "ambient" },
};

function makeFakeRepo(byTypeCall: {
  received?: { projectId: string; type: string };
  results: Resource[];
}): ProjectRepository {
  return {
    save() {},
    get() {
      return undefined;
    },
    addResource() {},
    getResource() {
      return undefined;
    },
    listResources() {
      return [];
    },
    listResourcesByProject(projectId: string, type: string) {
      byTypeCall.received = { projectId, type };
      return byTypeCall.results;
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

describe("src/app/resource/list-resources.ts", () => {
  test("execute({projectId, type}) forwards to ProjectRepository.listResourcesByProject", () => {
    const call: {
      received?: { projectId: string; type: string };
      results: Resource[];
    } = { results: [credA, credB] };
    const uc = new ListResources(makeFakeRepo(call));
    uc.execute({ projectId: PROJECT_ID, type: "credential" });
    assert.deepEqual(call.received, {
      projectId: PROJECT_ID,
      type: "credential",
    });
  });

  test("execute returns one ResourceView per resource, in order", () => {
    const call: { results: Resource[] } = { results: [credA, credB] };
    const uc = new ListResources(makeFakeRepo(call));
    const views = uc.execute({ projectId: PROJECT_ID, type: "credential" });
    assert.equal(views.length, 2);
    assert.equal(views[0]?.id, "cred-a");
    assert.equal(views[1]?.id, "cred-b");
  });

  test("execute redacts credential secret: CANARY_SECRET_VALUE absent from every view and its JSON serialization", () => {
    const call: { results: Resource[] } = { results: [credA, credB] };
    const uc = new ListResources(makeFakeRepo(call));
    const views = uc.execute({ projectId: PROJECT_ID, type: "credential" });

    for (const view of views) {
      assert.equal(
        "value" in view,
        false,
        "credential view must not have a 'value' key (structural omission)",
      );
    }
    const json = JSON.stringify(views);
    assert.equal(
      json.includes(CANARY),
      false,
      "CANARY_SECRET_VALUE must never appear in the listed views' JSON",
    );
  });

  test("execute for repository type returns a view carrying remoteUrl (no secret to redact)", () => {
    const call: { results: Resource[] } = { results: [repoResource] };
    const uc = new ListResources(makeFakeRepo(call));
    const views = uc.execute({ projectId: PROJECT_ID, type: "repository" });
    assert.equal(views.length, 1);
    assert.equal(
      (views[0] as { remoteUrl?: string }).remoteUrl,
      "https://github.com/acme/api.git",
    );
  });

  // -------------------------------------------------------------------------
  // 011 Story 2 — list notification / list filesystem support (characterization)
  // The use case + toResourceView already cover both types; these tests pin
  // the exact forwarded type and the exact view key set so a future refactor
  // can't silently drop a field or change the contract.
  // -------------------------------------------------------------------------

  test("(011 S2) execute({type: 'notification'}) forwards to listResourcesByProject and returns a view with exactly the notification keys", () => {
    const call: {
      received?: { projectId: string; type: string };
      results: Resource[];
    } = {
      results: [
        {
          type: "notification",
          id: "notif-1",
          projectId: PROJECT_ID,
          name: "ops",
          provider: "slack",
          destination: "#ops",
        },
      ],
    };
    const uc = new ListResources(makeFakeRepo(call));
    const views = uc.execute({ projectId: PROJECT_ID, type: "notification" });

    assert.deepEqual(call.received, {
      projectId: PROJECT_ID,
      type: "notification",
    });
    assert.equal(views.length, 1);
    const v = views[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(v).sort(), [
      "destination",
      "id",
      "name",
      "projectId",
      "provider",
      "type",
    ]);
    assert.equal(v["type"], "notification");
    assert.equal(v["id"], "notif-1");
    assert.equal(v["projectId"], PROJECT_ID);
    assert.equal(v["name"], "ops");
    assert.equal(v["provider"], "slack");
    assert.equal(v["destination"], "#ops");
  });

  test("(011 S2) execute({type: 'filesystem'}) forwards to listResourcesByProject and returns a view with exactly the filesystem keys", () => {
    const call: {
      received?: { projectId: string; type: string };
      results: Resource[];
    } = {
      results: [
        {
          type: "filesystem",
          id: "fs-1",
          projectId: PROJECT_ID,
          name: "scratch",
          path: "/w",
        },
      ],
    };
    const uc = new ListResources(makeFakeRepo(call));
    const views = uc.execute({ projectId: PROJECT_ID, type: "filesystem" });

    assert.deepEqual(call.received, {
      projectId: PROJECT_ID,
      type: "filesystem",
    });
    assert.equal(views.length, 1);
    const v = views[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(v).sort(), [
      "id",
      "name",
      "path",
      "projectId",
      "type",
    ]);
    assert.equal(v["type"], "filesystem");
    assert.equal(v["id"], "fs-1");
    assert.equal(v["projectId"], PROJECT_ID);
    assert.equal(v["name"], "scratch");
    assert.equal(v["path"], "/w");
  });
});
