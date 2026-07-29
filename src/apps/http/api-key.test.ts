import { test } from "node:test";
import assert from "node:assert/strict";

import { requireApiKey, MissingApiKeyError } from "./api-key.ts";

const badValues: Array<[string, string | undefined]> = [
  ["undefined", undefined],
  ["empty string", ""],
  ["blank after trim", "   "],
  ["15 chars", "0123456789abcde"],
];

for (const [name, value] of badValues) {
  test(`requireApiKey throws MissingApiKeyError naming API_KEY for: ${name}`, () => {
    assert.throws(() => requireApiKey(value), MissingApiKeyError);
    try {
      requireApiKey(value);
      assert.fail("expected requireApiKey to throw");
    } catch (err) {
      assert.ok(err instanceof MissingApiKeyError);
      assert.ok(
        (err as Error).message.includes("API_KEY"),
        `expected message to mention API_KEY, got: ${(err as Error).message}`,
      );
    }
  });
}

test("requireApiKey returns a 16-character key unchanged", () => {
  assert.equal(requireApiKey("0123456789abcdef"), "0123456789abcdef");
});

test("requireApiKey trims surrounding whitespace and returns the trimmed value", () => {
  assert.equal(requireApiKey("  0123456789abcdef  "), "0123456789abcdef");
});
