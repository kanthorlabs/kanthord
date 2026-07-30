import { test } from "node:test";
import assert from "node:assert/strict";
import { aiProviderView, type AiProviderDtoView } from "./ai-provider.ts";
import type { AiProviderView } from "../../../app/ai-provider/ai-provider-view.ts";

test("aiProviderView output key set is exactly the eight declared fields, no leaked secret or credentialId", () => {
  const result = {
    id: "ap1",
    name: "my provider",
    provider: "anthropic",
    model: "claude",
    baseUrl: null,
    effort: null,
    state: "active",
    isDefault: true,
    secret: "leak-me",
    credentialId: "leak-me-too",
  } as unknown as AiProviderView;
  const view: AiProviderDtoView = aiProviderView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "baseUrl",
    "effort",
    "id",
    "isDefault",
    "model",
    "name",
    "provider",
    "state",
  ]);
  assert.equal(view.id, "ap1");
  assert.equal(view.name, "my provider");
  assert.equal(view.provider, "anthropic");
  assert.equal(view.model, "claude");
  assert.equal(view.baseUrl, null);
  assert.equal(view.effort, null);
  assert.equal(view.state, "active");
  assert.equal(view.isDefault, true);
});
