// src/app/project/observe-setup-facts.test.ts — EPIC 015 Story 1
// Hermetic tests for the `ObserveSetupFacts` fact collector. No sqlite, no
// git, no model — the seam takes three injected repositories and synthesises
// the `ObservedFacts` value consumed by `planSetup` / `planGraph`.
//
// Why the fakes are inline (not shared): Story 1 is the only story that
// collects observed facts; the only consumer is `SetupPlan` in the same
// story. The fakes stay here.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ObserveSetupFacts } from "./observe-setup-facts.ts";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  InitiativeRepository,
  ProjectRepository,
} from "../../storage/port.ts";
import type { Resource } from "../../domain/resource.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";

// ── Fakes ────────────────────────────────────────────────────────────────────

class FakeProjects implements ProjectRepository {
  /** id → Project (so resolveProjectByName + get can cooperate). */
  readonly byId = new Map<
    string,
    { id: string; name: string; projectId?: string }
  >();
  /** id → Resource (so listResources can be filtered). */
  readonly resourceById = new Map<string, Resource>();

  // Test bookkeeping — proves execute() uses listResources, not the optional one.
  #listResourcesCalls = 0;
  #listResourcesByProjectCalls = 0;

  save(project: { id: string; name: string }): void {
    this.byId.set(project.id, { ...project });
  }

  get(id: string): { id: string; name: string } | undefined {
    const p = this.byId.get(id);
    if (!p) return undefined;
    return { id: p.id, name: p.name };
  }

  addResource(_projectId: string, resource: Resource): void {
    this.resourceById.set(resource.id, resource);
  }

  listResources(projectId: string): Resource[] {
    this.#listResourcesCalls += 1;
    return [...this.resourceById.values()].filter(
      (r) => (r as { projectId?: string }).projectId === projectId,
    );
  }

  listResourcesByProject(_projectId: string, _type: string): Resource[] {
    this.#listResourcesByProjectCalls += 1;
    // Trap: if execute() ever calls this method, the test below explodes.
    throw new Error(
      "listResourcesByProject must NOT be called by ObserveSetupFacts.execute",
    );
  }

  listProjects(): { id: string; name: string }[] {
    return [...this.byId.values()].map((p) => ({ id: p.id, name: p.name }));
  }

  resolveProjectByName(name: string): string[] {
    const ids: string[] = [];
    for (const p of this.byId.values()) {
      if (p.name === name) ids.push(p.id);
    }
    return ids;
  }

  getResource(id: string): Resource | undefined {
    return this.resourceById.get(id);
  }

  resolveResourceByName(_projectId: string, _name: string): string[] {
    return [];
  }

  // Test helpers
  get listResourcesCalls(): number {
    return this.#listResourcesCalls;
  }
  get listResourcesByProjectCalls(): number {
    return this.#listResourcesByProjectCalls;
  }
}

class FakeInitiatives implements InitiativeRepository {
  readonly byId = new Map<string, Initiative>();

  // Storage port only mandates these for Story 1.
  save(initiative: Initiative): void {
    this.byId.set(initiative.id, initiative);
  }
  get(id: string): Initiative | undefined {
    return this.byId.get(id);
  }
  saveObjective(): void {}
  getObjective(): undefined {
    return undefined;
  }
  listObjectives(_initiativeId: string): Objective[] {
    // Story 1 does not consume objectives, but the port requires the method.
    return [];
  }
  listInitiatives(projectId: string): Initiative[] {
    return [...this.byId.values()].filter((i) => i.projectId === projectId);
  }
  resolveInitiativeByName(): string[] {
    return [];
  }
  resolveObjectiveByName(): string[] {
    return [];
  }
  setPaused(): void {}
  setWorkspace(): void {}
  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [];
  }
  getSha256(): undefined {
    return undefined;
  }
  conditionalRenameInitiative(): { status: "conflict"; currentSha: string } {
    return { status: "conflict", currentSha: "" };
  }
  conditionalRenameObjective(): { status: "conflict"; currentSha: string } {
    return { status: "conflict", currentSha: "" };
  }
  conditionalDeleteObjective(): { status: "conflict"; currentSha: string } {
    return { status: "conflict", currentSha: "" };
  }
}

class FakeRegistry implements AiProviderRegistry {
  readonly byId = new Map<string, GlobalAiProvider>();
  /** projectId → list of assigned provider ids (in rank order). */
  readonly assigned = new Map<string, string[]>();

  add(p: GlobalAiProvider): void {
    this.byId.set(p.id, { ...p });
  }

  assign(projectId: string, providerId: string): void {
    const list = this.assigned.get(projectId) ?? [];
    list.push(providerId);
    this.assigned.set(projectId, list);
  }

  register(): GlobalAiProvider {
    throw new Error("not used in Story 1");
  }
  list(): GlobalAiProvider[] {
    return [...this.byId.values()].map((p) => ({ ...p }));
  }
  get(id: string): GlobalAiProvider | undefined {
    const p = this.byId.get(id);
    return p ? { ...p } : undefined;
  }
  getDefault(): undefined {
    return undefined;
  }
  setDefault(): void {}
  clearDefault(): void {}
  logout(): void {}
  remove(): void {}
  unassign(): void {}
  listAssigned(projectId: string): GlobalAiProvider[] {
    const ids = this.assigned.get(projectId) ?? [];
    return ids
      .map((id) => this.byId.get(id))
      .filter((p): p is GlobalAiProvider => p !== undefined)
      .map((p) => ({ ...p }));
  }
  maxRank(): undefined {
    return undefined;
  }
  shiftRanksFrom(): void {}
  compactRanks(): void {}
  getAssignment(): undefined {
    return undefined;
  }
  listProjectsAssigning(): string[] {
    return [];
  }
  updateCredentialCAS(): { applied: false } {
    return { applied: false };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildProjects(
  fakes: { projects: FakeProjects },
  projectId: string,
  resources: Resource[],
): void {
  fakes.projects.save({ id: projectId, name: "demo" });
  for (const r of resources) {
    fakes.projects.addResource(projectId, r);
  }
}

const baseInput = {
  projectName: "demo",
  repositoryName: "repo",
  providerName: "alpha",
  credentialName: "cred",
} as const;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ObserveSetupFacts", () => {
  test("two projects sharing the name → projectsByName has both, the other four lists are []", () => {
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    projects.save({ id: "p1", name: "demo" });
    projects.save({ id: "p2", name: "demo" });

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    const facts = uc.execute({ ...baseInput });

    assert.equal(facts.projectsByName.length, 2);
    assert.deepEqual(
      facts.projectsByName.map((p) => p.id),
      ["p1", "p2"],
    );
    assert.deepEqual(facts.credentialsByName, []);
    assert.deepEqual(facts.repositoriesByName, []);
    assert.deepEqual(facts.providersByName, []);
    assert.deepEqual(facts.initiatives, []);
  });

  test("one project, resources filtered by type AND name; differently named resources are absent", () => {
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    buildProjects({ projects }, "p1", [
      {
        id: "r-match",
        type: "repository",
        projectId: "p1",
        name: "repo",
        remoteUrl: "https://git.example.com/owner/repo.git",
        branch: "main",
        path: "/tmp/repo",
        auth: { kind: "ambient" },
      },
      {
        id: "r-other",
        type: "repository",
        projectId: "p1",
        name: "other",
        remoteUrl: "https://git.example.com/owner/other.git",
        branch: "main",
        path: "/tmp/other",
        auth: { kind: "ambient" },
      },
      {
        id: "c-match",
        type: "credential",
        projectId: "p1",
        name: "cred",
        provider: "github",
        value: "sk-secret-should-not-leak",
      },
      {
        id: "c-other",
        type: "credential",
        projectId: "p1",
        name: "other-cred",
        provider: "github",
        value: "sk-other-secret",
      },
      {
        id: "n-1",
        type: "notification",
        projectId: "p1",
        name: "slack-1",
        provider: "slack",
        destination: "#kanthord",
      },
    ]);

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    const facts = uc.execute({ ...baseInput });

    assert.equal(facts.projectsByName.length, 1);
    assert.equal(facts.projectsByName[0]!.id, "p1");
    assert.equal(facts.repositoriesByName.length, 1);
    assert.equal(facts.repositoriesByName[0]!.id, "r-match");
    assert.equal(facts.repositoriesByName[0]!.name, "repo");
    assert.equal(facts.repositoriesByName[0]!.auth.kind, "ambient");
    assert.equal(facts.credentialsByName.length, 1);
    assert.equal(facts.credentialsByName[0]!.id, "c-match");
    assert.equal(facts.credentialsByName[0]!.provider, "github");
  });

  test("credentialName omitted → credentialsByName is [] even when credentials exist", () => {
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    buildProjects({ projects }, "p1", [
      {
        id: "c-1",
        type: "credential",
        projectId: "p1",
        name: "cred",
        provider: "github",
        value: "sk-x",
      },
    ]);

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    const facts = uc.execute({
      projectName: "demo",
      repositoryName: "repo",
      providerName: "alpha",
      // credentialName deliberately omitted
    });

    assert.equal(facts.credentialsByName.length, 0);
  });

  test("assignedToProject is true only when the provider id appears in listAssigned(projectId)", () => {
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    buildProjects({ projects }, "p1", []);
    registry.add({
      id: "pr1",
      name: "alpha",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      baseUrl: null,
      effort: null,
      value: "sk-secret",
      state: "active",
      credentialVersion: 1,
      api: null,
      contextWindow: null,
      maxTokens: null,
    });
    // pr1 is in listAssigned for p1
    registry.assign("p1", "pr1");

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    const facts = uc.execute({ ...baseInput });

    assert.equal(facts.providersByName.length, 1);
    assert.equal(facts.providersByName[0]!.assignedToProject, true);
  });

  test("a provider that is only the global default (absent from listAssigned) yields assignedToProject=false", () => {
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    buildProjects({ projects }, "p1", []);
    registry.add({
      id: "pr1",
      name: "alpha",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      baseUrl: null,
      effort: null,
      value: "sk-secret",
      state: "active",
      credentialVersion: 1,
      api: null,
      contextWindow: null,
      maxTokens: null,
    });
    // Not in listAssigned — only the global default.
    // (The fake returns undefined for getDefault to model "no default")

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    const facts = uc.execute({ ...baseInput });

    assert.equal(facts.providersByName.length, 1);
    assert.equal(
      facts.providersByName[0]!.assignedToProject,
      false,
      "global default alone is not an assignment",
    );
  });

  test("lists are sorted by id ascending even when the fake returns them reversed", () => {
    // One project so the four scoped lists populate; two repositories inserted
    // in reverse order so the sort must run. The projectsByName list is a
    // single entry (trivially sorted) — the other four-list test already
    // covers the multi-entry projectsByName sort.
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    buildProjects({ projects }, "p1", [
      {
        id: "r2",
        type: "repository",
        projectId: "p1",
        name: "repo",
        remoteUrl: "https://git.example.com/owner/repo.git",
        branch: "main",
        path: "/tmp/repo",
        auth: { kind: "ambient" },
      },
      {
        id: "r1",
        type: "repository",
        projectId: "p1",
        name: "repo",
        remoteUrl: "https://git.example.com/owner/repo.git",
        branch: "main",
        path: "/tmp/repo",
        auth: { kind: "ambient" },
      },
    ]);

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    const facts = uc.execute({ ...baseInput });

    // projectsByName is sorted by id ascending (single entry, trivially).
    assert.deepEqual(
      facts.projectsByName.map((p) => p.id),
      ["p1"],
    );
    // repositoriesByName is sorted by id ascending (from reversed input).
    assert.deepEqual(
      facts.repositoriesByName.map((r) => r.id),
      ["r1", "r2"],
    );
  });

  test("returned ObservedProvider has no `value` property and the secret never reaches JSON", () => {
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    buildProjects({ projects }, "p1", []);
    registry.add({
      id: "pr1",
      name: "alpha",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      baseUrl: null,
      effort: null,
      value: "sk-LEAK-CANARY-12345",
      state: "active",
      credentialVersion: 1,
      api: null,
      contextWindow: null,
      maxTokens: null,
    });
    registry.assign("p1", "pr1");

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    const facts = uc.execute({ ...baseInput });

    const observed = facts.providersByName[0]!;
    assert.equal(
      "value" in observed,
      false,
      "ObservedProvider must not carry a value property",
    );
    const json = JSON.stringify(facts);
    assert.equal(
      json.includes("sk-LEAK-CANARY-12345"),
      false,
      "the secret must never appear in JSON.stringify(facts)",
    );
  });

  test("execute uses listResources (NOT listResourcesByProject) — even when the trap method exists", () => {
    const projects = new FakeProjects();
    const initiatives = new FakeInitiatives();
    const registry = new FakeRegistry();
    buildProjects({ projects }, "p1", []);

    const uc = new ObserveSetupFacts(projects, initiatives, registry);
    uc.execute({ ...baseInput });

    assert.equal(
      projects.listResourcesCalls,
      1,
      "execute() must call listResources exactly once",
    );
    assert.equal(
      projects.listResourcesByProjectCalls,
      0,
      "execute() must NOT call listResourcesByProject",
    );
  });
});
