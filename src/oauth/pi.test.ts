/**
 * PiOAuthLoginProvider — maps our presenter onto pi's OAuth callbacks and tags
 * the returned credential. Hermetic via an injected fake pi provider.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type {
  OAuthProviderInterface,
  OAuthCredentials,
} from "@earendil-works/pi-ai";
import { PiOAuthLoginProvider } from "./pi.ts";
import { UnknownOAuthProviderError } from "./port.ts";
import type { OAuthLoginPresenter } from "./port.ts";

const CREDS: OAuthCredentials = {
  access: "acc",
  refresh: "ref",
  expires: 123,
};

function recordingPresenter() {
  const events: string[] = [];
  const presenter: OAuthLoginPresenter = {
    showAuthUrl: (url) => events.push(`url:${url}`),
    showDeviceCode: (info) => events.push(`device:${info.userCode}`),
    progress: (m) => events.push(`progress:${m}`),
    promptCode: async () => "",
  };
  return { events, presenter };
}

describe("PiOAuthLoginProvider", () => {
  test("selects the requested method, surfaces the URL, and tags the credential", async () => {
    let selected: string | undefined;
    const provider: OAuthProviderInterface = {
      id: "openai-codex",
      name: "openai-codex",
      async login(cb) {
        selected = await cb.onSelect({ message: "m", options: [] });
        cb.onAuth({ url: "https://auth.example/x" });
        return CREDS;
      },
      async refreshToken(c) {
        return c;
      },
      getApiKey: () => "k",
    };

    const { events, presenter } = recordingPresenter();
    const sut = new PiOAuthLoginProvider({ getProvider: () => provider });

    const value = await sut.login({
      providerId: "openai-codex",
      method: "device_code",
      presenter,
    });

    assert.equal(selected, "device_code", "onSelect returns the chosen method");
    assert.ok(events.includes("url:https://auth.example/x"));
    assert.deepEqual(JSON.parse(value), { type: "oauth", ...CREDS });
  });

  test("unknown provider: throws UnknownOAuthProviderError", async () => {
    const sut = new PiOAuthLoginProvider({ getProvider: () => undefined });
    await assert.rejects(
      sut.login({
        providerId: "nope",
        method: "browser",
        presenter: recordingPresenter().presenter,
      }),
      UnknownOAuthProviderError,
    );
    assert.equal(sut.has("nope"), false);
  });
});
