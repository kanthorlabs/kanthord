import assert from "node:assert/strict";
import test from "node:test";
import {
  requireEnablementCredentials,
  unsuitableEnablementCredentials,
} from "./enablement.mjs";

function fakeApi(credentials) {
  const paths = [];
  return {
    api: {
      get: (path) => {
        paths.push(path);
        const name = path.split("/").at(-1);
        return Promise.resolve(credentials[name] ?? null);
      },
    },
    paths,
  };
}

const ENABLEMENTS = {
  "swe@1": {
    providers: [
      {
        name: "anthropic-subscription",
        provider: "anthropic-subscription",
        credential: "anthropic-subscription",
      },
    ],
  },
  "re@1": {
    providers: [
      {
        name: "e2e-openrouter",
        provider: "openrouter",
        credential: "e2e-openrouter",
      },
    ],
  },
};

test("unsuitableEnablementCredentials answers nothing when each credential suits its provider", async () => {
  const { api, paths } = fakeApi({
    "anthropic-subscription": { platform: "anthropic-subscription" },
    "e2e-openrouter": { platform: "openrouter" },
  });
  assert.deepEqual(await unsuitableEnablementCredentials(api, ENABLEMENTS), []);
  assert.deepEqual(paths, [
    "/api/llm/credential/anthropic-subscription",
    "/api/llm/credential/e2e-openrouter",
  ]);
});

test("unsuitableEnablementCredentials names a missing credential and a platform mismatch", async () => {
  const { api } = fakeApi({ "e2e-openrouter": { platform: "nvidia" } });
  assert.deepEqual(await unsuitableEnablementCredentials(api, ENABLEMENTS), [
    "swe@1: credential anthropic-subscription is missing",
    "re@1: credential e2e-openrouter has the platform nvidia, not openrouter",
  ]);
});

test("requireEnablementCredentials refuses with the credential and the login step", () => {
  assert.doesNotThrow(() => requireEnablementCredentials([]));
  assert.throws(
    () =>
      requireEnablementCredentials([
        "swe@1: credential anthropic-subscription is missing",
      ]),
    /swe@1: credential anthropic-subscription is missing\. .*kanthord llm credential login <platform> --name <credential>/,
  );
});
