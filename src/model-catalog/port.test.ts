import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeModelCatalog } from "./fake.ts";
import { UnknownModelError } from "./port.ts";

// suite: src/model-catalog/port.ts

test("FakeModelCatalog: isValid returns true for a supplied valid pair", () => {
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-terra" },
  ]);
  assert.equal(
    catalog.isValid("openai-codex", "gpt-5.6-terra"),
    true,
    "supplied (provider, model) pair is valid",
  );
});

test("FakeModelCatalog: isValid returns false for a pair not in the supplied list", () => {
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-terra" },
  ]);
  assert.equal(
    catalog.isValid("openai-codex", "no-such-model"),
    false,
    "absent model pair is invalid",
  );
});

test("FakeModelCatalog: constructed with no args rejects every pair", () => {
  const catalog = new FakeModelCatalog();
  assert.equal(
    catalog.isValid("openai-codex", "gpt-5.6-terra"),
    false,
    "no-args fake rejects known model",
  );
  assert.equal(
    catalog.isValid("anthropic", "claude-3-5-sonnet"),
    false,
    "no-args fake rejects any model",
  );
});

test("UnknownModelError: has name, provider, model fields and message contains 'get models'", () => {
  const err = new UnknownModelError("openai-codex", "no-such");
  assert.equal(err.name, "UnknownModelError", "name is 'UnknownModelError'");
  assert.equal(
    err.provider,
    "openai-codex",
    "provider field matches constructor arg",
  );
  assert.equal(err.model, "no-such", "model field matches constructor arg");
  assert.ok(
    err.message.includes("get models"),
    `message must contain 'get models' — got: ${err.message}`,
  );
  assert.ok(err instanceof Error, "UnknownModelError extends Error");
});
