import { test } from "node:test";
import assert from "node:assert/strict";

import { greetFromDaemon } from "./greeting.ts";

test("daemon uses the core greeting", () => {
  assert.equal(greetFromDaemon("World"), "Hello, World!");
});

test("daemon passes names through to core", () => {
  assert.equal(greetFromDaemon("Aelita"), "Hello, Aelita!");
});
