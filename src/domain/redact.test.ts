// src/domain/redact.test.ts — EPIC 014 Story 4
// Hermetic unit tests for `makeRedactor`, the single shared value-based
// credential redactor. Extracted from the inline closure at
// `src/agent-runner/pi.ts:455-456` so the repository probe and the provider
// probe redact through the same path. The "no regex, no parse" contract is
// load-bearing: a secret containing regex metacharacters must be replaced
// literally.

import assert from "node:assert/strict";
import { test } from "node:test";

import { makeRedactor } from "./redact.ts";

// ── single occurrence ────────────────────────────────────────────────────────

test("makeRedactor replaces a single occurrence of the secret with ***", () => {
  const redact = makeRedactor("sk-test");
  assert.equal(redact("sk-test is invalid"), "*** is invalid");
});

test("makeRedactor leaves the input unchanged when the secret is absent", () => {
  const redact = makeRedactor("sk-test");
  assert.equal(redact("nothing to redact here"), "nothing to redact here");
});

test("makeRedactor returns the input unchanged when the input is empty", () => {
  const redact = makeRedactor("sk-test");
  assert.equal(redact(""), "");
});

// ── multiple occurrences ─────────────────────────────────────────────────────

test("makeRedactor replaces every occurrence (not just the first)", () => {
  const redact = makeRedactor("sk-test");
  assert.equal(redact("a sk-test b sk-test c sk-test"), "a *** b *** c ***");
});

test("makeRedactor replaces occurrences across a multi-line input", () => {
  const redact = makeRedactor("sk-test");
  assert.equal(
    redact("line1 sk-test\nline2 sk-test\nline3"),
    "line1 ***\nline2 ***\nline3",
  );
});

// ── nullish / empty secret → no-op ───────────────────────────────────────────

test("makeRedactor(null) returns the input unchanged", () => {
  const redact = makeRedactor(null);
  assert.equal(redact("anything goes here"), "anything goes here");
});

test("makeRedactor(undefined) returns the input unchanged", () => {
  const redact = makeRedactor(undefined);
  assert.equal(redact("anything goes here"), "anything goes here");
});

test('makeRedactor("") returns the input unchanged (an empty secret is a no-op, not a wipe)', () => {
  const redact = makeRedactor("");
  assert.equal(redact("anything goes here"), "anything goes here");
});

// ── regex metacharacters: must be replaced literally, not as a pattern ───────

test("makeRedactor replaces a secret containing regex metacharacters literally (the redactor is not a regex engine)", () => {
  // a.*b as a regex matches "a" + any chars + "b"; a literal-replace must
  // only hit the exact substring "a.*b".
  const redact = makeRedactor("a.*b");
  assert.equal(
    redact("payload a.*b present a-b too"),
    "payload *** present a-b too",
  );
});

test("makeRedactor replaces a secret containing regex metacharacters in a credential-shaped token", () => {
  const redact = makeRedactor("sk.*secret");
  assert.equal(redact("header: sk.*secret trailer"), "header: *** trailer");
});

// ── input mutability / idempotency ──────────────────────────────────────────

test("makeRedactor is a pure function: two calls on the same input return the same output", () => {
  const redact = makeRedactor("sk-test");
  const input = "first sk-test second";
  const a = redact(input);
  const b = redact(input);
  assert.equal(a, b);
  assert.equal(a, "first *** second");
});
