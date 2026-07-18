/**
 * Story 04 T3 — login <provider> CLI handler
 *
 * Verifies four scenarios using injectable deps (no network):
 *   (a) known provider → OAuth flow invoked, credential saved with JSON
 *       value, stdout = ULID
 *   (b) same name a second time → succeeds again (upsert path, no duplicate)
 *   (c) provider without an OAuth flow → exit 1, one error line
 *   (d) unknown project → exit 1, one error line
 *
 * Fails today: src/apps/cli/login.ts is absent.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runLogin } from "./login.ts";
import type {
  OAuthCredentials,
  OAuthProviderInterface,
} from "@earendil-works/pi-ai";

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZPA";

const FAKE_CREDS: OAuthCredentials = {
  refresh: "tok_r",
  access: "tok_a",
  expires: Date.now() + 3_600_000,
};

function makeFakeProvider(id = "anthropic"): OAuthProviderInterface {
  return {
    id,
    name: id,
    async login(_callbacks) {
      return FAKE_CREDS;
    },
    async refreshToken(creds) {
      return creds;
    },
    getApiKey() {
      return "fake-api-key";
    },
  };
}

type SaveCredentialOpts = {
  projectId: string;
  name: string;
  provider: string;
  value: string;
};

describe("runLogin", () => {
  test("known provider: OAuth flow is invoked, credential saved with serialized JSON value, stdout is the ULID", async () => {
    const saved: SaveCredentialOpts[] = [];
    const newId = "01HZZZZZZZZZZZZZZZZZZZZZ01";

    const result = await runLogin(
      "anthropic",
      { project: PROJECT_ID, name: "my-cred" },
      {
        getProvider: (id) =>
          id === "anthropic" ? makeFakeProvider("anthropic") : undefined,
        saveCredential: async (opts) => {
          saved.push(opts);
          return newId;
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      result.stdout,
      [newId],
      "stdout contains exactly the ULID",
    );
    assert.equal(saved.length, 1, "saveCredential called once");
    assert.equal(saved[0]?.projectId, PROJECT_ID);
    assert.equal(saved[0]?.name, "my-cred");
    assert.equal(saved[0]?.provider, "anthropic");
    assert.deepEqual(
      JSON.parse(saved[0]?.value ?? "{}"),
      FAKE_CREDS,
      "stored value is serialized OAuthCredentials JSON",
    );
  });

  test("same provider + name a second time: saveCredential is called again without error (upsert path)", async () => {
    let callCount = 0;
    const deps = {
      getProvider: (_id: string) => makeFakeProvider("anthropic"),
      saveCredential: async (_opts: SaveCredentialOpts) => {
        callCount++;
        return "id-fixed";
      },
    };

    const r1 = await runLogin(
      "anthropic",
      { project: PROJECT_ID, name: "my-cred" },
      deps,
    );
    const r2 = await runLogin(
      "anthropic",
      { project: PROJECT_ID, name: "my-cred" },
      deps,
    );

    assert.equal(r1.exitCode, 0);
    assert.equal(
      r2.exitCode,
      0,
      "second login also succeeds (no DuplicateNameError)",
    );
    assert.equal(callCount, 2, "saveCredential called on each login call");
  });

  test("provider without an OAuth flow returns exit 1 with one error line", async () => {
    const result = await runLogin(
      "openai",
      { project: PROJECT_ID, name: "my-cred" },
      {
        getProvider: (_id) => undefined,
        saveCredential: async () => {
          throw new Error("saveCredential must not be called");
        },
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1, "exactly one error line on stdout");
    assert.equal(result.stdout.length, 0, "no stdout on failure");
  });

  test("unknown project returns exit 1 with one error line", async () => {
    const { UnknownReferenceError } = await import("../../app/errors.ts");

    const result = await runLogin(
      "anthropic",
      { project: "no-such-project", name: "my-cred" },
      {
        getProvider: (_id) => makeFakeProvider("anthropic"),
        saveCredential: async () => {
          throw new UnknownReferenceError("project", "no-such-project");
        },
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr.length, 1, "exactly one error line");
    assert.equal(result.stdout.length, 0, "no stdout on failure");
  });
});
