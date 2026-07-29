// src/app/ai-provider/set-default-ai-provider.test.ts — SetDefaultAiProvider
// (008.1 Story C: set-default use case + read/register CLI).

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
} from "../../storage/port.ts";
import { SetDefaultAiProvider } from "./set-default-ai-provider.ts";
import { UnknownReferenceError } from "../errors.ts";
import { LoggedOutProviderError } from "./errors.ts";

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
  } as GlobalAiProvider;
}

test("SetDefaultAiProvider: sets active provider as default", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1", name: "alpha" }));
  registry.add(makeProvider({ id: "p2", name: "beta" }));
  registry.setDefault("p1");

  const uc = new SetDefaultAiProvider(registry);
  uc.execute("p2");

  assert.equal(registry.getDefault()?.id, "p2", "default was flipped to p2");
});

test("SetDefaultAiProvider: rejects unknown id (UnknownReferenceError)", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  registry.setDefault("p1");

  const uc = new SetDefaultAiProvider(registry);
  assert.throws(
    () => uc.execute("unknown-id"),
    (err: unknown) =>
      err instanceof UnknownReferenceError && err.id === "unknown-id",
  );
});

test("SetDefaultAiProvider: rejects logged_out provider (LoggedOutProviderError)", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1", name: "alpha" }));
  registry.add(
    makeProvider({
      id: "p2",
      name: "beta",
      state: "logged_out",
      credentialVersion: 2,
    }),
  );
  registry.setDefault("p1");

  const uc = new SetDefaultAiProvider(registry);
  assert.throws(
    () => uc.execute("p2"),
    (err: unknown) =>
      err instanceof LoggedOutProviderError &&
      err.id === "p2" &&
      err.message.includes("set-default"),
  );
});
