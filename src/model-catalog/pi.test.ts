/**
 * Story 04 T3 — PiModelCatalog adapter
 *
 * Verifies that PiModelCatalog, constructed with a ListModels function that
 * returns a static catalog of known pairs, correctly accepts known pairs and
 * rejects unknown ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PiModelCatalog } from "./pi.ts";
import type { ModelInfo } from "../apps/cli/models.ts";

// A deterministic ListModels stub — no network, no real pi-ai dependency.
// Mirrors the shape that composition.ts produces from builtinModels(), with
// the specific pair the Proof's `create ai-provider` step uses.
const stubListModels = (_provider?: string): ModelInfo[] => [
  {
    provider: "openai-codex",
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    reasoning: false,
    contextWindow: 200_000,
  },
  {
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    reasoning: false,
    contextWindow: 200_000,
  },
  {
    provider: "anthropic",
    id: "claude-3",
    name: "Claude 3",
    reasoning: false,
    contextWindow: 200_000,
  },
];

test("PiModelCatalog: isValid returns true for a known (provider, model) pair", () => {
  const catalog = new PiModelCatalog(stubListModels);
  assert.equal(catalog.isValid("openai-codex", "gpt-5.6-terra"), true);
});

test("PiModelCatalog: isValid returns false for an unknown model in a known provider", () => {
  const catalog = new PiModelCatalog(stubListModels);
  assert.equal(catalog.isValid("openai-codex", "no-such-model-xyz"), false);
});

test("PiModelCatalog: isValid returns false for a completely unknown provider", () => {
  const catalog = new PiModelCatalog(stubListModels);
  assert.equal(catalog.isValid("not-a-provider", "some-model"), false);
});

test("PiModelCatalog: isValid returns true for a second provider in the catalog", () => {
  const catalog = new PiModelCatalog(stubListModels);
  assert.equal(catalog.isValid("anthropic", "claude-3"), true);
});
