// src/apps/http/envelope.test.ts — dataEnvelope/errorEnvelope shape (Story 02).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataEnvelope, errorEnvelope } from "./envelope.ts";

test("dataEnvelope wraps the value under a sole 'data' key", () => {
  const env = dataEnvelope({ a: 1 });
  assert.deepEqual(env, { data: { a: 1 } });
  assert.deepEqual(Object.keys(env), ["data"]);
});

test("errorEnvelope builds { error: { code, message, requestId } } exactly", () => {
  const env = errorEnvelope("x", "y", "z");
  assert.deepEqual(env, { error: { code: "x", message: "y", requestId: "z" } });
  assert.deepEqual(Object.keys(env.error), ["code", "message", "requestId"]);
});
