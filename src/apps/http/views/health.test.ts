import { test } from "node:test";
import assert from "node:assert/strict";
import { healthView, type HealthResult } from "./health.ts";

test("healthView output key set is exactly status and version, not a spread of extra fields", () => {
  const result = {
    status: "ok",
    version: "1.2.3",
    secret: "leak-me",
  } as unknown as HealthResult;
  const view = healthView(result);
  assert.deepEqual(Object.keys(view).sort(), ["status", "version"]);
  assert.equal(view.status, "ok");
  assert.equal(view.version, "1.2.3");
  assert.equal((view as Record<string, unknown>).secret, undefined);
});
