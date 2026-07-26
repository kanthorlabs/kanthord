// src/app/ai-provider/get-ai-provider.test.ts — GetAiProvider
// (008.1 Story C: set-default use case + read/register CLI).

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
} from "../../storage/port.ts";
import { GetAiProvider } from "./get-ai-provider.ts";
import type { AiProviderView } from "./ai-provider-view.ts";
import { UnknownReferenceError } from "../errors.ts";

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
    baseUrl: "https://api.openai.com",
    effort: "high",
    value: "sk-secret",
    state: "active",
    credentialVersion: 1,
    ...overrides,
  };
}

test("GetAiProvider: returns view with isDefault=true for the default provider", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  registry.setDefault("p1");

  const uc = new GetAiProvider(registry);
  const view: AiProviderView = uc.execute("p1");

  assert.equal(view.id, "p1");
  assert.equal(view.name, "alpha");
  assert.equal(view.isDefault, true);
});

test("GetAiProvider: returns view with isDefault=false for non-default provider", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  registry.add(makeProvider({ id: "p2", name: "beta" }));
  registry.setDefault("p1");

  const uc = new GetAiProvider(registry);
  const view: AiProviderView = uc.execute("p2");

  assert.equal(view.id, "p2");
  assert.equal(view.isDefault, false);
});

test("GetAiProvider: throws UnknownReferenceError for unknown id", () => {
  const registry = new FakeRegistry();
  const uc = new GetAiProvider(registry);

  assert.throws(
    () => uc.execute("unknown-id"),
    (err: unknown) =>
      err instanceof UnknownReferenceError && err.id === "unknown-id",
  );
});

test("GetAiProvider: view does NOT contain value field", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider({ id: "p1" }));
  registry.setDefault("p1");

  const uc = new GetAiProvider(registry);
  const view: AiProviderView = uc.execute("p1");

  // type-level proof: value is absent from the view type
  assert.equal(
    "value" in view,
    false,
    "value must be structurally absent from view",
  );

  // runtime proof: JSON.stringify must not contain the secret
  const json = JSON.stringify(view);
  assert.equal(
    json.includes("sk-secret"),
    false,
    "secret must not appear in JSON",
  );

  // protocol fields present
  assert.equal(view.id, "p1");
  assert.equal(view.provider, "openai-codex");
  assert.equal(view.model, "gpt-5.6-terra");
  assert.equal(view.baseUrl, "https://api.openai.com");
  assert.equal(view.effort, "high");
});
