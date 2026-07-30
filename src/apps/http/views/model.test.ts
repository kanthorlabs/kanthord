import { test } from "node:test";
import assert from "node:assert/strict";
import { modelView, type ModelInfoResult } from "./model.ts";

test("modelView output key set is exactly the five declared fields, injected extra dropped", () => {
  const result = {
    provider: "anthropic",
    id: "claude-x",
    name: "Claude X",
    reasoning: true,
    contextWindow: 200000,
    extra: "leak-me",
  } as unknown as ModelInfoResult;
  const view = modelView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "contextWindow",
    "id",
    "name",
    "provider",
    "reasoning",
  ]);
  assert.equal(view.provider, "anthropic");
  assert.equal(view.id, "claude-x");
  assert.equal(view.name, "Claude X");
  assert.equal(view.reasoning, true);
  assert.equal(view.contextWindow, 200000);
});
