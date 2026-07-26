/**
 * BLOCKER S3 — one shared `toResolvedProvider` mapping used by both
 * src/composition.ts and src/agent-runner/pi-provider-probe.ts, replacing the
 * copy-pasted `p.effort as any` mapping duplicated at both call sites.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GlobalAiProvider } from "../storage/port.ts";
import { toResolvedProvider } from "./resolved-provider.ts";

function makeGlobalProvider(
  overrides: Partial<GlobalAiProvider> = {},
): GlobalAiProvider {
  return {
    id: "aip-01",
    name: "acct-1",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    baseUrl: null,
    effort: null,
    value: "sk-test",
    state: "active",
    credentialVersion: 2,
    api: null,
    contextWindow: null,
    maxTokens: null,
    ...overrides,
  };
}

test("(BLOCKER S3) toResolvedProvider maps a GlobalAiProvider with all nullable fields to a ResolvedProvider with those keys absent", () => {
  const resolved = toResolvedProvider(makeGlobalProvider());
  assert.deepEqual(resolved, {
    id: "aip-01",
    name: "acct-1",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    value: "sk-test",
    credentialVersion: 2,
  });
  assert.ok(
    !("baseUrl" in resolved),
    "baseUrl key absent when the source is null",
  );
  assert.ok(
    !("effort" in resolved),
    "effort key absent when the source is null",
  );
  assert.ok(!("api" in resolved), "api key absent when the source is null");
});

test("(BLOCKER S3) toResolvedProvider carries through a non-null effort as the typed ReasoningEffort value (not `any`)", () => {
  const resolved = toResolvedProvider(
    makeGlobalProvider({ effort: "high", baseUrl: "https://x.example" }),
  );
  assert.equal(resolved.effort, "high");
  assert.equal(resolved.baseUrl, "https://x.example");
});

test("(BLOCKER S3) toResolvedProvider defaults a null value to the empty string", () => {
  const resolved = toResolvedProvider(makeGlobalProvider({ value: null }));
  assert.equal(resolved.value, "");
});

test("(BLOCKER S3) toResolvedProvider carries through custom-provider api/contextWindow/maxTokens", () => {
  const resolved = toResolvedProvider(
    makeGlobalProvider({
      api: "openai-completions",
      contextWindow: 128_000,
      maxTokens: 4096,
    }),
  );
  assert.equal(resolved.api, "openai-completions");
  assert.equal(resolved.contextWindow, 128_000);
  assert.equal(resolved.maxTokens, 4096);
});
