// src/app/ai-provider/unassign-ai-provider.test.ts — UnassignAiProvider
// (008.2 Story B: unassign a provider from a project).

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  UnitOfWork,
  ReferenceResolver,
} from "../../storage/port.ts";
import { UnassignAiProvider } from "./unassign-ai-provider.ts";
import { UnknownReferenceError } from "../errors.ts";

// ── Fakes ────────────────────────────────────────────────────────────────────

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
  update(
    id: string,
    patch: {
      model?: string;
      baseUrl?: string;
      effort?: string;
      api?: "openai-completions" | "openai-responses";
      contextWindow?: number;
      maxTokens?: number;
    },
  ): GlobalAiProvider {
    const current = this.#store.get(id);
    const merged = { ...current, ...patch } as GlobalAiProvider;
    this.#store.set(id, merged);
    return { ...merged };
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
    if (this.#assignments.has(key)) {
      throw new Error("UNIQUE constraint failed");
    }
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

  maxRank(projectId: string): number | undefined {
    const rows = Array.from(this.#assignments.values()).filter(
      (a) => a.projectId === projectId,
    );
    if (rows.length === 0) return undefined;
    return Math.max(...rows.map((r) => r.rank));
  }

  shiftRanksFrom(projectId: string, rank: number): void {
    for (const a of this.#assignments.values()) {
      if (a.projectId === projectId && a.rank >= rank) {
        a.rank += 1;
      }
    }
  }

  compactRanks(projectId: string): void {
    const sorted = Array.from(this.#assignments.values())
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => a.rank - b.rank);
    for (let i = 0; i < sorted.length; i++) {
      sorted[i]!.rank = i;
    }
  }

  getAssignment(
    projectId: string,
    providerId: string,
  ): { rank: number } | undefined {
    const a = this.#assignments.get(`${projectId}:${providerId}`);
    return a ? { rank: a.rank } : undefined;
  }

  listProjectsAssigning(_providerId: string): string[] {
    return [];
  }

  // Test helper
  add(p: GlobalAiProvider): void {
    this.#store.set(p.id, { ...p });
  }
}

class FakeRefResolver implements ReferenceResolver {
  readonly #kinds = new Map<
    string,
    "project" | "resource" | "initiative" | "objective" | "task"
  >();

  setKind(
    id: string,
    kind: "project" | "resource" | "initiative" | "objective" | "task",
  ): void {
    this.#kinds.set(id, kind);
  }

  resolveKind(
    id: string,
  ): "project" | "resource" | "initiative" | "objective" | "task" | undefined {
    return this.#kinds.get(id);
  }
}

class FakeUnitOfWork implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
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

// ── Tests ────────────────────────────────────────────────────────────────────

test("UnassignAiProvider: unassigns a provider from a project", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  registry.assign("proj-1", "p1", 0);

  const refResolver = new FakeRefResolver();
  refResolver.setKind("proj-1", "project");
  const uow = new FakeUnitOfWork();
  const uc = new UnassignAiProvider(registry, refResolver, uow);

  uc.execute({ projectId: "proj-1", providerId: "p1" });

  const assignment = registry.getAssignment("proj-1", "p1");
  assert.equal(
    assignment,
    undefined,
    "assignment must be removed after unassign",
  );
});

test("UnassignAiProvider: throws UnknownReferenceError for unknown project", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  registry.assign("proj-1", "p1", 0);

  const refResolver = new FakeRefResolver();
  // No kind set for "unknown-proj"
  const uow = new FakeUnitOfWork();
  const uc = new UnassignAiProvider(registry, refResolver, uow);

  assert.throws(
    () => uc.execute({ projectId: "unknown-proj", providerId: "p1" }),
    (err: unknown) =>
      err instanceof UnknownReferenceError && err.kind === "project",
  );
});

test("UnassignAiProvider: throws UnknownReferenceError for unknown provider", () => {
  const registry = new FakeRegistry();
  const refResolver = new FakeRefResolver();
  refResolver.setKind("proj-1", "project");
  const uow = new FakeUnitOfWork();
  const uc = new UnassignAiProvider(registry, refResolver, uow);

  assert.throws(
    () => uc.execute({ projectId: "proj-1", providerId: "unknown-p" }),
    (err: unknown) =>
      err instanceof UnknownReferenceError && err.kind === "ai_provider",
  );
});

test("UnassignAiProvider: is a no-op when the provider is not assigned to the project", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  const refResolver = new FakeRefResolver();
  refResolver.setKind("proj-1", "project");
  const uow = new FakeUnitOfWork();
  const uc = new UnassignAiProvider(registry, refResolver, uow);

  // Should not throw even though p1 is not assigned to proj-1
  assert.doesNotThrow(() =>
    uc.execute({ projectId: "proj-1", providerId: "p1" }),
  );
});
