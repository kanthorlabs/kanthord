/**
 * src/agent/provider-session.test.ts
 *
 * Suite: Story 003 T1 — buildProviderSession resolves an account to {model, streamFn}
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ProviderAccountRegistry, ProviderAccount } from "./provider-account-registry.ts";
import type { ProviderCredentialStore } from "./provider-credential-store.ts";
import type { OAuthCredential, Credential } from "@earendil-works/pi-ai";

import { buildProviderSession } from "./provider-session.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A fake ProviderAccountRegistry backed by a single pre-configured account. */
function makeFakeRegistry(account: ProviderAccount): ProviderAccountRegistry {
  return {
    async add() {
      throw new Error("not expected in this test");
    },
    async get(id: string) {
      if (id !== account.id) {
        throw new Error(`provider account not found: "${id}"`);
      }
      return account;
    },
    async list() {
      return [account];
    },
    async update() {
      throw new Error("not expected in this test");
    },
    async remove() {
      throw new Error("not expected in this test");
    },
  };
}

/** A fake ProviderCredentialStore that returns a single pre-configured credential. */
function makeFakeStore(
  accountId: string,
  cred: OAuthCredential,
): ProviderCredentialStore {
  return {
    async read(id: string): Promise<Credential | undefined> {
      return id === accountId ? cred : undefined;
    },
    async modify(
      _id: string,
      _fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    ): Promise<Credential | undefined> {
      return undefined;
    },
    async delete(_id: string): Promise<void> {},
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCT_ID = "acct_test-copilot-001";
const MODEL_ID = "gpt-4.1"; // known github-copilot model id

/** A fake individual-tier access token (no proxy-ep). */
const INDIVIDUAL_CRED: OAuthCredential = {
  type: "oauth",
  access: "tid=abc;exp=9999999999;other=x",
  refresh: "",
  expires: Date.now() + 3_600_000,
};

/** A fake enterprise access token — embeds proxy-ep. */
const ENTERPRISE_CRED: OAuthCredential = {
  type: "oauth",
  access: "tid=ent;exp=9999999999;proxy-ep=proxy.myenterprise.example.com;sku=enterprise",
  refresh: "",
  expires: Date.now() + 3_600_000,
};

const COPILOT_ACCOUNT: ProviderAccount = {
  id: ACCT_ID,
  providerKind: "github-copilot",
  label: "work",
  credentialKey: ACCT_ID,
};

// ---------------------------------------------------------------------------
// T1 — buildProviderSession resolves an account to {model, streamFn}
// ---------------------------------------------------------------------------

describe("provider-session — T1 buildProviderSession", () => {
  test("returns model whose provider maps to the account id, plus a callable streamFn", async () => {
    const registry = makeFakeRegistry(COPILOT_ACCOUNT);
    const store = makeFakeStore(ACCT_ID, INDIVIDUAL_CRED);

    const session = await buildProviderSession(
      { accountId: ACCT_ID, modelId: MODEL_ID },
      { registry, store },
    );

    assert.equal(
      session.model.provider,
      COPILOT_ACCOUNT.providerKind,
      "model.provider must equal the canonical providerKind at the pi-ai boundary",
    );
    assert.equal(session.model.id, MODEL_ID, "model.id must match the requested modelId");
    assert.equal(typeof session.streamFn, "function", "streamFn must be a function");
  });

  test("unknown account id throws a typed error naming the id", async () => {
    const registry = makeFakeRegistry(COPILOT_ACCOUNT);
    const store = makeFakeStore(ACCT_ID, INDIVIDUAL_CRED);

    await assert.rejects(
      () =>
        buildProviderSession(
          { accountId: "acct_does-not-exist", modelId: MODEL_ID },
          { registry, store },
        ),
      (err: Error) => {
        assert.match(err.message, /acct_does-not-exist/);
        return true;
      },
    );
  });

  test("unknown model id throws a typed error naming the model id", async () => {
    const registry = makeFakeRegistry(COPILOT_ACCOUNT);
    const store = makeFakeStore(ACCT_ID, INDIVIDUAL_CRED);

    await assert.rejects(
      () =>
        buildProviderSession(
          { accountId: ACCT_ID, modelId: "no-such-model-xyz" },
          { registry, store },
        ),
      (err: Error) => {
        assert.match(err.message, /no-such-model-xyz/);
        return true;
      },
    );
  });

  // B1: enterprise base URL must come from pi-ai toAuth/applyAuth, NOT kanthord's
  // parseCopilotBaseUrl. Assert at the resolved-auth seam (session.getAuth) rather
  // than the eager session.model.baseUrl, which kanthord will no longer populate.
  test("enterprise proxy-ep token: pi-ai getAuth resolves enterprise base URL (B1 — no kanthord parsing)", async () => {
    const registry = makeFakeRegistry(COPILOT_ACCOUNT);
    const store = makeFakeStore(ACCT_ID, ENTERPRISE_CRED);

    const session = await buildProviderSession(
      { accountId: ACCT_ID, modelId: MODEL_ID },
      { registry, store },
    );

    // After B1: session.model.baseUrl is the provider default, not the enterprise
    // URL. pi-ai Copilot toAuth() processes proxy-ep and supplies the enterprise
    // base URL at auth-resolution time. Assert via session.getAuth seam.
    const authResult = await session.getAuth(session.model);
    assert.match(
      authResult?.auth?.baseUrl ?? "",
      /api\.myenterprise\.example\.com/,
      "enterprise base URL must come from pi-ai toAuth(), not kanthord token parsing",
    );
  });

  // Baseline: individual-tier Copilot (no proxy-ep) resolves to the individual
  // endpoint via the same pi-ai auth seam.
  test("individual-tier Copilot token: pi-ai getAuth resolves individual base URL (B1)", async () => {
    const registry = makeFakeRegistry(COPILOT_ACCOUNT);
    const store = makeFakeStore(ACCT_ID, INDIVIDUAL_CRED);

    const session = await buildProviderSession(
      { accountId: ACCT_ID, modelId: MODEL_ID },
      { registry, store },
    );

    const authResult = await session.getAuth(session.model);
    const auth = authResult?.auth;
    assert.ok(
      auth !== undefined,
      "getAuth must return a defined auth object for a valid individual credential",
    );
    assert.match(
      auth?.baseUrl ?? "",
      /api\.individual\.githubcopilot\.com/,
      "individual base URL must be the github.com individual Copilot host (api.individual.githubcopilot.com)",
    );
  });

  test("two same-kind accounts each resolve auth via their own account's credentialKey", async () => {
    const ACCT_A: ProviderAccount = {
      id: "acct_aaa", providerKind: "github-copilot", label: "aaa", credentialKey: "acct_aaa",
    };
    const ACCT_B: ProviderAccount = {
      id: "acct_bbb", providerKind: "github-copilot", label: "bbb", credentialKey: "acct_bbb",
    };

    const keysReadA: string[] = [];
    const recordingStoreA: ProviderCredentialStore = {
      async read(id) { keysReadA.push(id); return INDIVIDUAL_CRED; },
      async modify(_id, fn) { return fn(INDIVIDUAL_CRED); },
      async delete(_id) {},
    };
    const keysReadB: string[] = [];
    const recordingStoreB: ProviderCredentialStore = {
      async read(id) { keysReadB.push(id); return INDIVIDUAL_CRED; },
      async modify(_id, fn) { return fn(INDIVIDUAL_CRED); },
      async delete(_id) {},
    };

    const sessionA = await buildProviderSession(
      { accountId: ACCT_A.id, modelId: MODEL_ID },
      { registry: makeFakeRegistry(ACCT_A), store: recordingStoreA },
    );
    // getAuth triggers the per-session credential adapter → recordingStoreA.read(credKey)
    await sessionA.getAuth(sessionA.model);

    const sessionB = await buildProviderSession(
      { accountId: ACCT_B.id, modelId: MODEL_ID },
      { registry: makeFakeRegistry(ACCT_B), store: recordingStoreB },
    );
    await sessionB.getAuth(sessionB.model);

    assert.ok(
      keysReadA.includes(ACCT_A.credentialKey),
      `session A must read account A's credentialKey ("${ACCT_A.credentialKey}"); got: ${JSON.stringify(keysReadA)}`,
    );
    assert.ok(
      keysReadB.includes(ACCT_B.credentialKey),
      `session B must read account B's credentialKey ("${ACCT_B.credentialKey}"); got: ${JSON.stringify(keysReadB)}`,
    );
  });
});
