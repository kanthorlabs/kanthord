import assert from "node:assert/strict";
import test from "node:test";
import {
  mergedProviders,
  requireEnablementCredentials,
  unsuitableEnablementCredentials,
} from "./enablement.mjs";

const CONFIG_PATH = "scripts/e2e/todoapp.json";
const LIVE = [{ revision: 1, ended_at: null }];
const ENDED = [{ revision: 1, ended_at: 1792426097901 }];
const PLATFORMS = {
  items: [
    { platform: "anthropic-subscription", secret_shape: "oauth" },
    { platform: "openrouter", secret_shape: "api_key" },
    { platform: "nvidia", secret_shape: "api_key" },
  ],
};

const SUBSCRIPTION = {
  name: "anthropic-subscription",
  provider: "anthropic-subscription",
  credential: "anthropic-subscription",
};
const OPENROUTER = {
  name: "e2e-openrouter",
  provider: "openrouter",
  credential: "e2e-openrouter",
};
const NVIDIA = {
  name: "e2e-nvidia",
  provider: "nvidia",
  credential: "e2e-nvidia",
};

function fakeApi({ credentials = {}, enablements = {} }) {
  const paths = [];
  const answers = new Map([["/api/llm/credential/platform", PLATFORMS]]);
  for (const [name, credential] of Object.entries(credentials))
    answers.set(`/api/llm/credential/${name}`, credential);
  for (const [agent, enablement] of Object.entries(enablements))
    answers.set(`/api/agent/enablement/${agent}`, enablement);
  return {
    api: {
      get: (path) => {
        paths.push(path);
        return Promise.resolve(answers.get(path) ?? null);
      },
    },
    paths,
  };
}

test("mergedProviders keeps the server providers and adds the new config providers", () => {
  assert.deepEqual(mergedProviders(null, { providers: [OPENROUTER] }), [
    OPENROUTER,
  ]);
  assert.deepEqual(
    mergedProviders(
      { agent_providers: [NVIDIA, OPENROUTER] },
      { providers: [OPENROUTER, SUBSCRIPTION] },
    ),
    [NVIDIA, OPENROUTER, SUBSCRIPTION],
  );
});

test("unsuitableEnablementCredentials answers nothing when each credential is live and serves its provider", async () => {
  const { api, paths } = fakeApi({
    credentials: {
      "anthropic-subscription": {
        platform: "anthropic-subscription",
        revisions: LIVE,
      },
      "e2e-openrouter": {
        platform: "openrouter",
        revisions: [...ENDED, { revision: 2, ended_at: null }],
      },
    },
  });
  const refusals = await unsuitableEnablementCredentials(
    api,
    {
      "swe@1": { providers: [SUBSCRIPTION] },
      "re@1": { providers: [OPENROUTER] },
    },
    CONFIG_PATH,
  );
  assert.deepEqual(refusals, []);
  assert.deepEqual(paths, [
    "/api/llm/credential/platform",
    "/api/agent/enablement/swe@1",
    "/api/llm/credential/anthropic-subscription",
    "/api/agent/enablement/re@1",
    "/api/llm/credential/e2e-openrouter",
  ]);
});

test("a missing OAuth credential names the concrete login command", async () => {
  const { api } = fakeApi({});
  assert.deepEqual(
    await unsuitableEnablementCredentials(
      api,
      { "swe@1": { providers: [SUBSCRIPTION] } },
      CONFIG_PATH,
    ),
    [
      "swe@1: credential anthropic-subscription is missing; run `kanthord llm credential login anthropic-subscription --name anthropic-subscription`",
    ],
  );
});

test("a missing key credential names the config file", async () => {
  const { api } = fakeApi({});
  assert.deepEqual(
    await unsuitableEnablementCredentials(
      api,
      { "re@1": { providers: [OPENROUTER] } },
      CONFIG_PATH,
    ),
    [
      "re@1: credential e2e-openrouter is missing; add it to credentials in scripts/e2e/todoapp.json",
    ],
  );
});

test("a credential of another provider or with only ended revisions is refused", async () => {
  const { api } = fakeApi({
    credentials: {
      "e2e-openrouter": { platform: "nvidia", revisions: LIVE },
      "anthropic-subscription": {
        platform: "anthropic-subscription",
        revisions: ENDED,
      },
    },
  });
  assert.deepEqual(
    await unsuitableEnablementCredentials(
      api,
      {
        "re@1": { providers: [OPENROUTER] },
        "swe@1": { providers: [SUBSCRIPTION] },
      },
      CONFIG_PATH,
    ),
    [
      "re@1: credential e2e-openrouter serves the provider nvidia, not openrouter; archive it or choose another credential name",
      "swe@1: credential anthropic-subscription has no live revision; archive it or choose another credential name",
    ],
  );
});

test("a server provider that the config does not name is checked too", async () => {
  const { api } = fakeApi({
    credentials: {
      "e2e-openrouter": { platform: "openrouter", revisions: LIVE },
    },
    enablements: { "swe@1": { agent_providers: [NVIDIA] } },
  });
  assert.deepEqual(
    await unsuitableEnablementCredentials(
      api,
      { "swe@1": { providers: [OPENROUTER] } },
      CONFIG_PATH,
    ),
    [
      "swe@1: credential e2e-nvidia is missing; add it to credentials in scripts/e2e/todoapp.json",
    ],
  );
});

test("requireEnablementCredentials refuses with one line for each refusal", () => {
  assert.doesNotThrow(() => requireEnablementCredentials([]));
  assert.throws(() => requireEnablementCredentials(["first", "second"]), {
    message: "first\nsecond",
  });
});
