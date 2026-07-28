// src/app/project/check-project.test.ts — EPIC 014 Story 6
// Hermetic tests for the `CheckProject` fact collector. The collector does
// every read and every clock read, then calls the pure `buildProjectReadiness`
// (Story 1+2). Its only IO is the injected `CheckProjectDeps`; the test
// uses inline fakes for the six narrow deps, no sqlite, no git, no model.
//
// Mirrors the inline-fake style of `src/app/task/list-tasks.test.ts:10`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CheckProject } from "./check-project.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Resource } from "../../domain/resource.ts";
import type { Initiative } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type { ReadinessReport } from "./project-readiness.ts";

// ── Fakes ────────────────────────────────────────────────────────────────────

class FakeProjects {
  readonly projectExists: Map<string, boolean> = new Map();
  readonly resources: Map<string, Resource> = new Map();
  /** Per-dep call counts. */
  readonly calls = { get: 0, listResources: 0, getResource: 0 };

  get(id: string): { id: string } | undefined {
    this.calls.get++;
    if (this.projectExists.get(id) === false) return undefined;
    if (this.projectExists.has(id)) return { id };
    return undefined;
  }

  listResources(projectId: string): Resource[] {
    this.calls.listResources++;
    return [...this.resources.values()].filter(
      (r) => (r as { projectId?: string }).projectId === projectId,
    );
  }

  getResource(id: string): Resource | undefined {
    this.calls.getResource++;
    return this.resources.get(id);
  }
}

class FakeInitiatives {
  /** `id → paused`. `listAllInitiatives` returns these as {id, paused}. */
  readonly pausedById: Map<string, boolean> = new Map();
  readonly initiativesByProject: Map<string, Initiative[]> = new Map();
  readonly calls = { listInitiatives: 0, listAllInitiatives: 0 };

  listInitiatives(projectId: string): Initiative[] {
    this.calls.listInitiatives++;
    return this.initiativesByProject.get(projectId) ?? [];
  }

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    this.calls.listAllInitiatives++;
    return [...this.pausedById.entries()].map(([id, paused]) => ({
      id,
      paused,
    }));
  }
}

class FakeTasks {
  readonly byInitiative: Map<string, Task[]> = new Map();
  readonly calls = { listByInitiative: 0 };

  listByInitiative(initiativeId: string): Task[] {
    this.calls.listByInitiative++;
    return this.byInitiative.get(initiativeId) ?? [];
  }
}

class FakeProviders {
  /** chain(projectId) — returned in order. */
  chainResult: Map<string, Array<{ id: string; name: string }>> = new Map();
  /** assignedIds(projectId). */
  assignedIdsResult: Map<string, string[]> = new Map();
  readonly calls = { chain: 0, assignedIds: 0 };

  chain(projectId: string): Array<{ id: string; name: string }> {
    this.calls.chain++;
    return this.chainResult.get(projectId) ?? [];
  }

  assignedIds(projectId: string): string[] {
    this.calls.assignedIds++;
    return this.assignedIdsResult.get(projectId) ?? [];
  }
}

class FakeStatus {
  schemaVersionResult: number = 28;
  readonly calls = { schemaVersion: 0 };

  schemaVersion(): number {
    this.calls.schemaVersion++;
    return this.schemaVersionResult;
  }
}

class FakeHeartbeat {
  staleMs: number = 6000;
  instancesResult: Array<{ instanceId: string; ageMs: number }> = [];
  readonly calls = { instances: 0 };

  instances(): Array<{ instanceId: string; ageMs: number }> {
    this.calls.instances++;
    return this.instancesResult;
  }
}

class FakeRepositoryProbe {
  readonly calls: Array<{ remoteUrl: string; branch: string; auth: unknown }> =
    [];
  /** Map of `resourceId` → probe result. Default = ok. */
  resultByResourceId: Map<string, { status: "ok" | "failed"; detail: string }> =
    new Map();

  async probe(input: {
    remoteUrl: string;
    branch: string;
    auth: unknown;
  }): Promise<{ status: "ok" | "failed"; detail: string }> {
    // Match by `remoteUrl` (each test passes a distinct URL per resource).
    this.calls.push({
      remoteUrl: input.remoteUrl,
      branch: input.branch,
      auth: input.auth,
    });
    // Fall back to ok if not configured.
    return (
      this.resultByResourceId.get(input.remoteUrl) ?? {
        status: "ok",
        detail: "ok",
      }
    );
  }
}

class FakeProviderProbe {
  readonly calls: string[] = [];
  result: {
    resourceId: string;
    status: "ok" | "failed";
    detail: string;
  } = { resourceId: "", status: "ok", detail: "ok" };

  async execute(providerId: string): Promise<{
    resourceId: string;
    status: "ok" | "failed";
    detail: string;
  }> {
    this.calls.push(providerId);
    return { ...this.result, resourceId: providerId };
  }
}

interface Deps {
  projects: FakeProjects;
  initiatives: FakeInitiatives;
  tasks: FakeTasks;
  providers: FakeProviders;
  status: FakeStatus;
  heartbeat: FakeHeartbeat;
  repositoryProbe: FakeRepositoryProbe;
  providerProbe: FakeProviderProbe;
  expectedSchemaVersion: number;
}

function makeDeps(): Deps {
  return {
    projects: new FakeProjects(),
    initiatives: new FakeInitiatives(),
    tasks: new FakeTasks(),
    providers: new FakeProviders(),
    status: new FakeStatus(),
    heartbeat: new FakeHeartbeat(),
    repositoryProbe: new FakeRepositoryProbe(),
    providerProbe: new FakeProviderProbe(),
    expectedSchemaVersion: 28,
  };
}

function newCheckProject(deps: Deps): CheckProject {
  return new CheckProject({
    projects: deps.projects,
    initiatives: deps.initiatives,
    tasks: deps.tasks,
    providers: deps.providers,
    status: deps.status,
    expectedSchemaVersion: deps.expectedSchemaVersion,
    heartbeat: deps.heartbeat,
    repositoryProbe: deps.repositoryProbe,
    providerProbe: deps.providerProbe,
  });
}

// ── Minimal all-green fact shape ─────────────────────────────────────────────

function seedAllGreen(deps: Deps, projectId = "p1"): void {
  deps.projects.projectExists.set(projectId, true);
  deps.status.schemaVersionResult = 28;
  deps.heartbeat.instancesResult = [{ instanceId: "1:1000", ageMs: 1000 }];
  deps.providers.chainResult.set(projectId, []);
  deps.providers.assignedIdsResult.set(projectId, []);
  deps.initiatives.initiativesByProject.set(projectId, []);
  deps.initiatives.pausedById.clear();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("CheckProject is constructible (no throw)", () => {
  const deps = makeDeps();
  const cp = newCheckProject(deps);
  assert.ok(cp instanceof CheckProject);
});

test("execute rejects with UnknownReferenceError for an unknown project id and only calls projects.get", async () => {
  const deps = makeDeps();
  deps.projects.projectExists.set("missing", false);
  const cp = newCheckProject(deps);

  await assert.rejects(
    cp.execute({
      id: "missing",
      probeRepositories: false,
      probeProvider: false,
    }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      assert.equal((err as Error).message, "no project with id missing");
      return true;
    },
  );

  assert.equal(deps.projects.calls.get, 1);
  assert.equal(deps.projects.calls.listResources, 0);
  assert.equal(deps.projects.calls.getResource, 0);
  assert.equal(deps.initiatives.calls.listInitiatives, 0);
  assert.equal(deps.tasks.calls.listByInitiative, 0);
  assert.equal(deps.providers.calls.chain, 0);
  assert.equal(deps.heartbeat.calls.instances, 0);
});

// ── Repository mapping ───────────────────────────────────────────────────────

test("https-token repository with a valid credential resource is unverified (credentialExists, credentialIsCredentialType true)", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.projects.resources.set("cred-1", {
    id: "cred-1",
    type: "credential",
    name: "cre",
    provider: "github",
    value: "tok",
  } as Resource);
  deps.projects.resources.set("repo-1", {
    id: "repo-1",
    type: "repository",
    name: "r1",
    remoteUrl: "https://example.com/r1",
    branch: "main",
    path: "/tmp/r1",
    auth: { kind: "https-token", credentialId: "cred-1" },
  } as Resource);

  // Tag resources with projectId so listResources returns them.
  for (const r of deps.projects.resources.values()) {
    (r as { projectId?: string }).projectId = "p1";
  }

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "repository")!;
  assert.equal(c.status, "unverified");
  // The collector must have resolved the credential reference.
  assert.equal(deps.projects.calls.getResource, 1);
});

test("https-token repository with a missing credential resource is blocked", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.projects.resources.set("repo-1", {
    id: "repo-1",
    type: "repository",
    name: "r1",
    remoteUrl: "https://example.com/r1",
    branch: "main",
    path: "/tmp/r1",
    auth: { kind: "https-token", credentialId: "does-not-exist" },
  } as Resource);
  for (const r of deps.projects.resources.values()) {
    (r as { projectId?: string }).projectId = "p1";
  }

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "repository")!;
  assert.equal(c.status, "blocked");
  assert.ok(c.detail.includes("credential"));
});

test("https-token repository whose credential reference is a non-credential resource is blocked", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.projects.resources.set("fs-1", {
    id: "fs-1",
    type: "filesystem",
    name: "fs",
    path: "/tmp",
  } as Resource);
  deps.projects.resources.set("repo-1", {
    id: "repo-1",
    type: "repository",
    name: "r1",
    remoteUrl: "https://example.com/r1",
    branch: "main",
    path: "/tmp/r1",
    auth: { kind: "https-token", credentialId: "fs-1" },
  } as Resource);
  for (const r of deps.projects.resources.values()) {
    (r as { projectId?: string }).projectId = "p1";
  }

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "repository")!;
  assert.equal(c.status, "blocked");
});

test("non-repository resources (credential, filesystem, notification) are excluded from repository facts", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.projects.resources.set("cred-1", {
    id: "cred-1",
    type: "credential",
    name: "c",
    provider: "p",
    value: "v",
  } as Resource);
  deps.projects.resources.set("fs-1", {
    id: "fs-1",
    type: "filesystem",
    name: "f",
    path: "/x",
  } as Resource);
  deps.projects.resources.set("noti-1", {
    id: "noti-1",
    type: "notification",
    name: "n",
    provider: "slack",
    destination: "x",
  } as Resource);
  for (const r of deps.projects.resources.values()) {
    (r as { projectId?: string }).projectId = "p1";
  }

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  // The repository check should report "missing" because no repository is in the project.
  const c = report.checks.find((x) => x.name === "repository")!;
  assert.equal(c.status, "missing");
  // No getResource call (no https-token repos).
  assert.equal(deps.projects.calls.getResource, 0);
});

// ── Initiative mapping ───────────────────────────────────────────────────────

test("paused is taken from listAllInitiatives; an initiative absent defaults to paused:false", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  const initiative: Initiative = {
    id: "i1",
    projectId: "p1",
    name: "i1",
    paused: false, // this is overwritten by listAllInitiatives
    status: "building",
  };
  deps.initiatives.initiativesByProject.set("p1", [initiative]);
  deps.initiatives.pausedById.set("i1", true);
  deps.tasks.byInitiative.set("i1", []);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "initiative")!;
  // Paused → check is paused, not missing
  assert.equal(c.status, "paused");
});

test("initiative absent from listAllInitiatives defaults to paused:false", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  const initiative: Initiative = {
    id: "i1",
    projectId: "p1",
    name: "i1",
    paused: false,
    status: "building",
  };
  deps.initiatives.initiativesByProject.set("p1", [initiative]);
  // No entry in pausedById for i1.
  deps.tasks.byInitiative.set("i1", [
    {
      id: "t1",
      objectiveId: "o1",
      title: "t",
      status: "pending",
      dependencies: [],
    },
  ]);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  // With paused=false and an incomplete task, the check is "ok".
  const c = report.checks.find((x) => x.name === "initiative")!;
  assert.equal(c.status, "ok");
});

test("initiative with status undefined is treated as building (default)", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  const initiative = {
    id: "i1",
    projectId: "p1",
    name: "i1",
    paused: false,
  } as Initiative; // no status
  deps.initiatives.initiativesByProject.set("p1", [initiative]);
  deps.initiatives.pausedById.set("i1", false);
  deps.tasks.byInitiative.set("i1", [
    {
      id: "t1",
      objectiveId: "o1",
      title: "t",
      status: "pending",
      dependencies: [],
    },
  ]);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  // Treated as building → with an incomplete task, "ok".
  const c = report.checks.find((x) => x.name === "initiative")!;
  assert.equal(c.status, "ok");
});

test("incompleteTaskCount counts pending/running/failed/awaiting_confirmation and excludes completed/discarded", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  const initiative: Initiative = {
    id: "i1",
    projectId: "p1",
    name: "i1",
    paused: false,
    status: "building",
  };
  deps.initiatives.initiativesByProject.set("p1", [initiative]);
  deps.initiatives.pausedById.set("i1", false);
  deps.tasks.byInitiative.set("i1", [
    {
      id: "t1",
      objectiveId: "o1",
      title: "t",
      status: "pending",
      dependencies: [],
    },
    {
      id: "t2",
      objectiveId: "o1",
      title: "t",
      status: "running",
      dependencies: [],
    },
    {
      id: "t3",
      objectiveId: "o1",
      title: "t",
      status: "failed",
      dependencies: [],
    },
    {
      id: "t4",
      objectiveId: "o1",
      title: "t",
      status: "awaiting_confirmation",
      dependencies: [],
    },
    {
      id: "t5",
      objectiveId: "o1",
      title: "t",
      status: "completed",
      dependencies: [],
    },
    {
      id: "t6",
      objectiveId: "o1",
      title: "t",
      status: "discarded",
      dependencies: [],
    },
  ]);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "initiative")!;
  // 4 incomplete tasks → ok with a "4 incomplete task(s)" detail
  assert.equal(c.status, "ok");
  assert.ok(c.detail.includes("4 incomplete task"));
});

// ── Provider source derivation ───────────────────────────────────────────────

test("chain returning one member with empty assignedIds → source:default and the report reads unverified (NOT missing)", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.providers.chainResult.set("p1", [{ id: "p1", name: "p1" }]);
  deps.providers.assignedIdsResult.set("p1", []);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "ai_provider")!;
  assert.equal(c.status, "unverified");
  assert.ok(c.detail.includes("default"));
  assert.ok(c.detail.includes("assign"));
});

test("chain returning one member with that id in assignedIds → source:assigned and no default suffix", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.providers.chainResult.set("p1", [{ id: "p1", name: "p1" }]);
  deps.providers.assignedIdsResult.set("p1", ["p1"]);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "ai_provider")!;
  assert.equal(c.status, "unverified");
  assert.ok(
    !c.detail.includes("resolving via the global default"),
    `assigned detail must not carry the default-suffix tail, got: ${c.detail}`,
  );
});

test("empty chain + no assignments → ai_provider:missing", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "ai_provider")!;
  assert.equal(c.status, "missing");
});

test("empty chain + assignedIds=[p1] → ai_provider:blocked", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.providers.assignedIdsResult.set("p1", ["p1"]);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "ai_provider")!;
  assert.equal(c.status, "blocked");
  assert.ok(c.detail.includes("login"));
});

test("chain member whose id is in assignedIds derives source:assigned even if `isDefault` would be true", async () => {
  // We can't pass `isDefault` through the chain shape (the chain shape is
  // {id, name}), so the contract is: source is derived from assignedIds
  // membership only. A chain member with id in assignedIds is always
  // source:assigned, regardless of how it would look to `isDefault`.
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.providers.chainResult.set("p1", [{ id: "p1", name: "p1" }]);
  deps.providers.assignedIdsResult.set("p1", ["p1"]);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  const c = report.checks.find((x) => x.name === "ai_provider")!;
  assert.ok(
    !c.detail.includes("resolving via the global default"),
    `assigned detail must not carry the default-suffix tail, got: ${c.detail}`,
  );
});

test("chain and assignedIds are each called exactly once per execute", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  const cp = newCheckProject(deps);

  await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  });

  assert.equal(deps.providers.calls.chain, 1);
  assert.equal(deps.providers.calls.assignedIds, 1);
});

// ── Probe plumbing ───────────────────────────────────────────────────────────

test("neither probe flag → repositoryProbe.probe called 0 times, providerProbe.execute called 0 times, verified === null", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.projects.resources.set("repo-1", {
    id: "repo-1",
    type: "repository",
    name: "r1",
    remoteUrl: "https://example.com/r1",
    branch: "main",
    path: "/tmp/r1",
    auth: { kind: "ambient" },
  } as Resource);
  for (const r of deps.projects.resources.values()) {
    (r as { projectId?: string }).projectId = "p1";
  }
  deps.providers.chainResult.set("p1", [{ id: "p1", name: "p1" }]);

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  })) as ReadinessReport;

  assert.equal(deps.repositoryProbe.calls.length, 0);
  assert.equal(deps.providerProbe.calls.length, 0);
  assert.equal(report.verified, null);
});

test("probeRepositories:true with three repositories in descending-id order → probe called in ascending id order, ascending in report", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  for (const id of ["r3", "r2", "r1"]) {
    deps.projects.resources.set(id, {
      id,
      type: "repository",
      name: id,
      remoteUrl: `https://example.com/${id}`,
      branch: "main",
      path: `/tmp/${id}`,
      auth: { kind: "ambient" },
    } as Resource);
  }
  for (const r of deps.projects.resources.values()) {
    (r as { projectId?: string }).projectId = "p1";
  }

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: true,
    probeProvider: false,
  })) as ReadinessReport;

  assert.equal(deps.repositoryProbe.calls.length, 3);
  // Probe calls in ascending order by remoteUrl
  assert.deepEqual(
    deps.repositoryProbe.calls.map((c) => c.remoteUrl),
    [
      "https://example.com/r1",
      "https://example.com/r2",
      "https://example.com/r3",
    ],
  );
  const c = report.checks.find((x) => x.name === "repository")!;
  assert.deepEqual(
    c.probes!.map((p) => p.resourceId),
    ["r1", "r2", "r3"],
  );
});

test("probeRepositories:true with one failing probe → verified === false and that probe's status is failed", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.projects.resources.set("r1", {
    id: "r1",
    type: "repository",
    name: "r1",
    remoteUrl: "https://example.com/r1",
    branch: "main",
    path: "/tmp/r1",
    auth: { kind: "ambient" },
  } as Resource);
  deps.repositoryProbe.resultByResourceId.set("https://example.com/r1", {
    status: "failed",
    detail: "branch not found",
  });
  for (const r of deps.projects.resources.values()) {
    (r as { projectId?: string }).projectId = "p1";
  }

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: true,
    probeProvider: false,
  })) as ReadinessReport;

  assert.equal(report.verified, false);
  const c = report.checks.find((x) => x.name === "repository")!;
  const probe = c.probes!.find((p) => p.resourceId === "r1")!;
  assert.equal(probe.status, "failed");
});

test("probeProvider:true with a two-member resolved chain → providerProbe.execute called exactly once with resolved[0].id", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.providers.chainResult.set("p1", [
    { id: "p1", name: "p1" },
    { id: "p2", name: "p2" },
  ]);
  deps.providers.assignedIdsResult.set("p1", ["p1", "p2"]);

  const cp = newCheckProject(deps);
  await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: true,
  });

  assert.deepEqual(deps.providerProbe.calls, ["p1"]);
});

test("probeProvider:true with an empty chain → execute called 0 times and verified stays null (nothing was probed)", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  // Empty chain (seedAllGreen default), no assignments.

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: true,
  })) as ReadinessReport;

  assert.equal(deps.providerProbe.calls.length, 0);
  const c = report.checks.find((x) => x.name === "ai_provider")!;
  assert.equal(c.status, "missing");
  // The flag was passed, but with no provider to probe nothing actually ran.
  // The EPIC forbids a vacuous `true` here, so the verdict is `null`.
  assert.equal(report.verified, null);
  assert.equal(report.ready, false);
});

test("probeRepositories:true with no repositories → verified stays null (nothing was probed)", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.projects.resources.clear();

  const cp = newCheckProject(deps);
  const report = (await cp.execute({
    id: "p1",
    probeRepositories: true,
    probeProvider: false,
  })) as ReadinessReport;

  assert.equal(deps.repositoryProbe.calls.length, 0);
  assert.equal(report.verified, null);
});

test("probeProvider:true with a default-only chain → providerProbe.execute called once with that id", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  deps.providers.chainResult.set("p1", [{ id: "p1", name: "p1" }]);
  // assignedIds empty → p1 is the global default
  deps.providers.assignedIdsResult.set("p1", []);

  const cp = newCheckProject(deps);
  await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: true,
  });

  assert.deepEqual(deps.providerProbe.calls, ["p1"]);
});

// ── Heartbeat ────────────────────────────────────────────────────────────────

test("heartbeat.instances is called exactly once per execute", async () => {
  const deps = makeDeps();
  seedAllGreen(deps);
  const cp = newCheckProject(deps);

  await cp.execute({
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  });

  assert.equal(deps.heartbeat.calls.instances, 1);
});
