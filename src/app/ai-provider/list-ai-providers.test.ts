// src/app/ai-provider/list-ai-providers.test.ts — ListAiProviders
// (008.1 Story C: set-default use case + read/register CLI).

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
} from "../../storage/port.ts";
import { ListAiProviders } from "./list-ai-providers.ts";
import type { AiProviderView } from "./ai-provider-view.ts";

class FakeRegistry implements AiProviderRegistry {
  readonly #store = new Map<string, GlobalAiProvider>();
  #defaultId: string | undefined = undefined;

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

  // 008.2 Story A — project→provider assignment (required by port)
  assign(_projectId: string, _providerId: string, _rank: number): void {}
  unassign(_projectId: string, _providerId: string): void {}
  listAssigned(_projectId: string): GlobalAiProvider[] {
    return [];
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

  // Test helper: directly add a pre-built provider
  add(p: GlobalAiProvider): void {
    this.#store.set(p.id, { ...p });
  }
}

test("ListAiProviders: returns all providers with correct isDefault", () => {
  const registry = new FakeRegistry();
  registry.add({
    id: "p1",
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    baseUrl: null,
    effort: null,
    value: "sk-1",
    state: "active",
    credentialVersion: 1,
    api: null,
    contextWindow: null,
    maxTokens: null,
  });
  registry.add({
    id: "p2",
    name: "beta",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    baseUrl: null,
    effort: null,
    value: "sk-2",
    state: "active",
    credentialVersion: 1,
    api: null,
    contextWindow: null,
    maxTokens: null,
  });
  registry.setDefault("p1");

  const uc = new ListAiProviders(registry);
  const views: AiProviderView[] = uc.execute();

  assert.equal(views.length, 2);
  const v0 = views[0]!;
  const v1 = views[1]!;
  assert.equal(v0.id, "p1");
  assert.equal(v0.isDefault, true);
  assert.equal(v1.id, "p2");
  assert.equal(v1.isDefault, false);
});

test("ListAiProviders: views do NOT contain value field", () => {
  const registry = new FakeRegistry();
  registry.add({
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
  });
  registry.setDefault("p1");

  const uc = new ListAiProviders(registry);
  const views: AiProviderView[] = uc.execute();

  assert.equal(views.length, 1);
  const v0 = views[0]!;
  assert.equal(
    "value" in v0,
    false,
    "value must be structurally absent from view",
  );
  assert.equal(JSON.stringify(views).includes("sk-secret"), false);
});

test("ListAiProviders: returns empty array when no providers exist", () => {
  const registry = new FakeRegistry();
  const uc = new ListAiProviders(registry);
  const views: AiProviderView[] = uc.execute();

  assert.deepEqual(views, []);
});
