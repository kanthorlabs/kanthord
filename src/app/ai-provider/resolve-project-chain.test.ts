// src/app/ai-provider/resolve-project-chain.test.ts — ResolveProjectChain
// (008.2 Story D: resolved-chain use case — fake registry).

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  ReferenceResolver,
} from "../../storage/port.ts";
import { ResolveProjectChain } from "./resolve-project-chain.ts";
import type { AiProviderView } from "./ai-provider-view.ts";
import { UnknownReferenceError } from "../errors.ts";

// ── Fake ──────────────────────────────────────────────────────────────────────

class FakeRegistry implements AiProviderRegistry {
  readonly #store = new Map<string, GlobalAiProvider>();
  #defaultId: string | undefined = undefined;
  readonly #assignments = new Map<
    string,
    { projectId: string; providerId: string; rank: number }
  >();

  register(input: {
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    effort?: string;
    value: string;
  }): GlobalAiProvider {
    const id = `p${this.#store.size + 1}`;
    const record: GlobalAiProvider = {
      id,
      name: input.name,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? null,
      effort: input.effort ?? null,
      value: input.value,
      state: "active",
      credentialVersion: 1,
      api: null,
      contextWindow: null,
      maxTokens: null,
    };
    this.#store.set(id, record);
    return { ...record };
  }

  get(id: string): GlobalAiProvider | undefined {
    return this.#store.get(id);
  }

  list(): GlobalAiProvider[] {
    return Array.from(this.#store.values()).map((p) => ({ ...p }));
  }

  getDefault(): GlobalAiProvider | undefined {
    if (this.#defaultId === undefined) return undefined;
    const p = this.#store.get(this.#defaultId);
    return p ? { ...p } : undefined;
  }

  setDefault(id: string): void {
    this.#defaultId = id;
  }

  clearDefault(): void {
    this.#defaultId = undefined;
  }

  logout(_id: string): void {}

  remove(_id: string): void {}

  updateCredentialCAS(
    _id: string,
    _value: string,
    _expectedVersion: number,
  ): { applied: true; newVersion: number } | { applied: false } {
    return { applied: false };
  }

  assign(projectId: string, providerId: string, rank: number): void {
    const key = `${projectId}:${providerId}`;
    this.#assignments.set(key, { projectId, providerId, rank });
  }

  unassign(projectId: string, providerId: string): void {
    this.#assignments.delete(`${projectId}:${providerId}`);
  }

  listAssigned(projectId: string): GlobalAiProvider[] {
    return Array.from(this.#assignments.values())
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => a.rank - b.rank)
      .map((a) => {
        const p = this.#store.get(a.providerId);
        return p ? { ...p } : undefined;
      })
      .filter((p): p is GlobalAiProvider => p !== undefined);
  }

  maxRank(_projectId: string): number | undefined {
    return undefined;
  }

  shiftRanksFrom(_projectId: string, _rank: number): void {}

  compactRanks(_projectId: string): void {}

  getAssignment(
    _projectId: string,
    _providerId: string,
  ): { rank: number } | undefined {
    return undefined;
  }

  listProjectsAssigning(_providerId: string): string[] {
    return [];
  }

  /** Test helper: directly add a pre-built provider. */
  add(p: GlobalAiProvider): void {
    this.#store.set(p.id, { ...p });
  }
}

class FakeRefResolver implements ReferenceResolver {
  readonly #kinds = new Map<string, "project">();

  setKind(id: string, kind: "project"): void {
    this.#kinds.set(id, kind);
  }

  resolveKind(
    id: string,
  ): "project" | "resource" | "initiative" | "objective" | "task" | undefined {
    return this.#kinds.get(id);
  }
}

function makeProvider(
  overrides: Partial<GlobalAiProvider> = {},
): GlobalAiProvider {
  return {
    id: "p1",
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
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("ResolveProjectChain: assigned [P3,P2] + absent default P1 → [P3,P2,P1]", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p3", name: "gamma" }));
  registry.add(makeProvider({ id: "p2", name: "beta" }));
  registry.add(makeProvider({ id: "p1", name: "alpha" }));
  registry.setDefault("p1");
  registry.assign("proj-1", "p3", 0);
  registry.assign("proj-1", "p2", 1);

  const uc = new ResolveProjectChain(registry);
  const views: AiProviderView[] = uc.execute("proj-1");

  assert.equal(views.length, 3);
  assert.equal(views[0]!.id, "p3");
  assert.equal(views[1]!.id, "p2");
  assert.equal(views[2]!.id, "p1");
});

test("ResolveProjectChain: default already in assigned list is not duplicated", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p3", name: "gamma" }));
  registry.add(makeProvider({ id: "p2", name: "beta" }));
  registry.setDefault("p3");
  registry.assign("proj-1", "p3", 0);
  registry.assign("proj-1", "p2", 1);

  const uc = new ResolveProjectChain(registry);
  const views = uc.execute("proj-1");

  assert.equal(views.length, 2);
  assert.equal(views[0]!.id, "p3");
  assert.equal(views[1]!.id, "p2");
});

test("ResolveProjectChain: logged_out assigned provider is excluded from chain", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p3", name: "gamma" }));
  registry.add(makeProvider({ id: "p2", name: "beta", state: "logged_out" }));
  registry.add(makeProvider({ id: "p1", name: "alpha" }));
  registry.setDefault("p1");
  registry.assign("proj-1", "p3", 0);
  registry.assign("proj-1", "p2", 1);

  const uc = new ResolveProjectChain(registry);
  const views = uc.execute("proj-1");

  assert.equal(views.length, 2);
  assert.equal(views[0]!.id, "p3");
  assert.equal(views[1]!.id, "p1");
});

test("ResolveProjectChain: logged_out default is not appended to empty project", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1", name: "alpha", state: "logged_out" }));
  registry.setDefault("p1");

  const uc = new ResolveProjectChain(registry);
  const views = uc.execute("proj-1");

  assert.deepEqual(views, []);
});

test("ResolveProjectChain: empty project with active default → [default]", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1", name: "alpha" }));
  registry.setDefault("p1");

  const uc = new ResolveProjectChain(registry);
  const views = uc.execute("proj-1");

  assert.equal(views.length, 1);
  assert.equal(views[0]!.id, "p1");
});

test("ResolveProjectChain: no view contains value field", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p3", name: "gamma" }));
  registry.add(makeProvider({ id: "p2", name: "beta" }));
  registry.add(
    makeProvider({ id: "p1", name: "alpha", value: "sk-secret-p1" }),
  );
  registry.setDefault("p1");
  registry.assign("proj-1", "p3", 0);
  registry.assign("proj-1", "p2", 1);

  const uc = new ResolveProjectChain(registry);
  const views = uc.execute("proj-1");

  for (const v of views) {
    assert.equal(
      "value" in v,
      false,
      "view must not contain the credential value",
    );
  }
  // Also verify the serialised output
  assert.equal(
    JSON.stringify(views).includes("sk-secret"),
    false,
    "serialised views must not contain the credential value",
  );
});

// ── HUMAN_REVIEW: S3 — bogus project id must throw UnknownReferenceError ──

test("ResolveProjectChain: bogus project id throws UnknownReferenceError", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  registry.setDefault("p1");
  const refResolver = new FakeRefResolver();
  // No kind set for "bogus-proj" → resolveKind returns undefined

  const uc = new ResolveProjectChain(registry, refResolver);
  assert.throws(
    () => uc.execute("bogus-proj"),
    (err: unknown) =>
      err instanceof UnknownReferenceError && err.kind === "project",
  );
});
