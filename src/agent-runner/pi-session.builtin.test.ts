/**
 * Story F — Runtime support for pi's builtin API-key providers.
 *
 * Hermetic session-construction tests for the builtin (deepseek/openrouter/
 * opencode) providers using the real PiProviderSessionFactory, no network.
 * Three sets:
 *   1-4. Characterization — session construction succeeds for a valid model
 *        per provider, including opencode's mixed per-model API flavors.
 *   5.   ModelCatalog rejects a bogus (provider, model) pair.
 *   6.   RED — a custom provider with an unsupported api flavor must fail
 *        with a clear error instead of silently falling through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { PiModelCatalog } from "../model-catalog/pi.ts";
import { PiProviderSessionFactory, UnsupportedApiError } from "./pi-session.ts";
import type { ResolvedProvider } from "./port.ts";
import type { ModelCatalog } from "../model-catalog/port.ts";
import type { AiProviderRegistry, GlobalAiProvider } from "../storage/port.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuiltinProvider(
  provider: string,
  model: string,
): ResolvedProvider {
  return {
    id: `builtin-${provider}`,
    name: `Test ${provider}`,
    provider,
    model,
    value: "sk-dummy-test-key",
    credentialVersion: 1,
  };
}

function makeFactory(): PiProviderSessionFactory {
  const registry: AiProviderRegistry = {
    updateCredentialCAS: () => ({ applied: false as const }),
    register: () => {
      throw new Error("not implemented");
    },
    list: () => {
      throw new Error("not implemented");
    },
    get: () => {
      throw new Error("not implemented");
    },
    update: () => ({}) as GlobalAiProvider,
    getDefault: () => {
      throw new Error("not implemented");
    },
    setDefault: () => {
      throw new Error("not implemented");
    },
    clearDefault: () => {
      throw new Error("not implemented");
    },
    logout: () => {
      throw new Error("not implemented");
    },
    remove: () => {
      throw new Error("not implemented");
    },
    assign: () => {
      throw new Error("not implemented");
    },
    unassign: () => {
      throw new Error("not implemented");
    },
    listAssigned: () => {
      throw new Error("not implemented");
    },
    maxRank: () => {
      throw new Error("not implemented");
    },
    shiftRanksFrom: () => {
      throw new Error("not implemented");
    },
    compactRanks: () => {
      throw new Error("not implemented");
    },
    getAssignment: () => {
      throw new Error("not implemented");
    },
    listProjectsAssigning: () => {
      throw new Error("not implemented");
    },
  };
  return new PiProviderSessionFactory({ registry });
}

const factory = makeFactory();

// ---------------------------------------------------------------------------
// 1-3. Each builtin provider constructs a session with a valid model
//      (characterization — pass on first run; sensitivity proven below).
// ---------------------------------------------------------------------------

for (const entry of [
  { provider: "deepseek", model: "deepseek-v4-flash" },
  { provider: "openrouter", model: "ai21/jamba-large-1.7" },
  { provider: "opencode", model: "big-pickle" },
]) {
  test(`(Story F) ${entry.provider}: session construction succeeds for ${entry.model}`, async () => {
    const aiProvider = makeBuiltinProvider(entry.provider, entry.model);
    const session = await factory.for(aiProvider);

    assert.ok(session, "must return a session object");
    assert.equal(
      typeof session.getApiKey(),
      "string",
      "getApiKey() must return a string",
    );
    assert.equal(
      typeof session.streamFn,
      "function",
      "streamFn must be a function",
    );
  });
}

// ---------------------------------------------------------------------------
// 4. Opencode model with anthropic-messages api flavor
//      (characterization — different api flavor than openai-completions).
// ---------------------------------------------------------------------------

test("(Story F) opencode: session construction succeeds for anthropic-messages api flavor model", async () => {
  const models = builtinModels().getModels("opencode");
  const anthroModel = models.find((m) => m.api === "anthropic-messages");
  assert.ok(
    anthroModel,
    "opencode catalog must contain at least one anthropic-messages model",
  );

  const aiProvider = makeBuiltinProvider("opencode", anthroModel.id);
  const session = await factory.for(aiProvider);

  assert.ok(session, "must return a session object");
  assert.equal(typeof session.getApiKey(), "string");
  assert.equal(typeof session.streamFn, "function");
});

// ---------------------------------------------------------------------------
// 5. Bogus (provider, model) is rejected by ModelCatalog.isValid
// ---------------------------------------------------------------------------

test("(Story F) bogus (provider, model) pair is rejected by ModelCatalog.isValid", () => {
  const listModels = (provider?: string) =>
    builtinModels()
      .getModels(provider)
      .map((m) => ({ provider: m.provider, id: m.id }));
  const catalog: ModelCatalog = new PiModelCatalog(listModels);

  assert.equal(catalog.isValid("deepseek", "deepseek-v4-flash"), true);
  assert.equal(catalog.isValid("deepseek", "no-such-model-xyz"), false);
  assert.equal(catalog.isValid("nonexistent-provider", "any-model"), false);
});

// ---------------------------------------------------------------------------
// 6. RED — custom provider with unsupported api flavor throws clear error
//      The production code at pi-session.ts:237-240 silently falls through to
//      openAIResponsesApi() when aiProvider.api is neither "openai-completions"
//      nor "openai-responses".  The fix adds an explicit guard that throws an
//      UnsupportedApiError (or named equivalent) instead.
// ---------------------------------------------------------------------------

test("(Story F) custom provider with unsupported api flavor throws UnsupportedApiError", async () => {
  const provider: ResolvedProvider = {
    id: "custom-unsupported-api",
    name: "Test Unsupported Api",
    provider: "custom",
    model: "custom-model",
    value: "sk-dummy",
    credentialVersion: 1,
    api: "unsupported-api" as any,
    baseUrl: "https://api.example.com",
    effort: undefined,
    contextWindow: 4096,
    maxTokens: 4096,
  };

  await assert.rejects(() => factory.for(provider), UnsupportedApiError);
});
