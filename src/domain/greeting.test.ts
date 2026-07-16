import { test } from "node:test";
import assert from "node:assert/strict";

import { greeting } from "./greeting.ts";

test("greeting returns a hello line for the given name", () => {
  assert.equal(greeting("kanthord"), "Hello, kanthord!");
});
