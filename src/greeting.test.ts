import { test } from "node:test";
import assert from "node:assert/strict";

import { greet } from "./greeting.ts";

test("greets World", () => {
  assert.equal(greet("World"), "Hello, World!");
});

test("interpolates the name", () => {
  assert.equal(greet("Aelita"), "Hello, Aelita!");
});
