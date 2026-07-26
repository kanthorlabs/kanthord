/**
 * Story 04 T1 — PiProviderSessionFactory
 *
 * Tests for the ProviderSession / PiProviderSessionFactory seam.
 * All tests are hermetic: no network, no real OAuth flows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResolvedProvider } from "./port.ts";
import type {
  Api,
  Model,
  StreamFunction,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  CredentialError,
  UnknownModelError,
  PiProviderSessionFactory,
  withReasoning,
} from "./pi-session.ts";

// ---------- fixture builders -------------------------------------------------

function makeAIProvider(
  overrides: Partial<ResolvedProvider> = {},
): ResolvedProvider {
  return {
    id: "aip-01",
    name: "test-openai",
    provider: "openai",
    model: "gpt-5.5",
    value: "sk-test-abc123",
    credentialVersion: 1,
    ...overrides,
  };
}

function oauthValue(
  access: string,
  refresh: string,
  expires = Date.now() + 3_600_000,
): string {
  return JSON.stringify({ type: "oauth", access, refresh, expires });
}

import type { AiProviderRegistry } from "../storage/port.ts";

function makeFactory(
  saved?: Array<{ id: string; value: string; expectedVersion?: number }>,
  returnSuccess: boolean = true,
): PiProviderSessionFactory {
  const registry: AiProviderRegistry = {
    updateCredentialCAS(id: string, value: string, expectedVersion: number) {
      saved?.push({ id, value, expectedVersion });
      if (returnSuccess)
        return { applied: true, newVersion: expectedVersion + 1 };
      return { applied: false };
    },
    register: () => {
      throw new Error("not implemented");
    },
    list: () => {
      throw new Error("not implemented");
    },
    get: () => {
      throw new Error("not implemented");
    },
    getDefault: () => {
      throw new Error("not implemented");
    },
    setDefault: () => {
      throw new Error("not implemented");
    },
    clearDefault: () => {
      throw new Error("not implemented");
    },
    logout: () => {
      throw new Error("not implemented");
    },
    remove: () => {
      throw new Error("not implemented");
    },
    assign: () => {
      throw new Error("not implemented");
    },
    unassign: () => {
      throw new Error("not implemented");
    },
    listAssigned: () => {
      throw new Error("not implemented");
    },
    maxRank: () => {
      throw new Error("not implemented");
    },
    shiftRanksFrom: () => {
      throw new Error("not implemented");
    },
    compactRanks: () => {
      throw new Error("not implemented");
    },
    getAssignment: () => {
      throw new Error("not implemented");
    },
    listProjectsAssigning: () => {
      throw new Error("not implemented");
    },
  };
  return new PiProviderSessionFactory({ registry });
}

// ---------- withReasoning (effort injection boundary) -----------------------

test("withReasoning injects the effort as options.reasoning on every call", () => {
  const seen: Array<SimpleStreamOptions | undefined> = [];
  const base = ((_m, _c, options) => {
    seen.push(options as SimpleStreamOptions);
    return {} as ReturnType<StreamFunction>;
  }) as StreamFunction;

  const wrapped = withReasoning(base, "medium");
  wrapped(
    {} as Model<Api>,
    [] as never,
    { maxTokens: 5 } as SimpleStreamOptions,
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.reasoning, "medium");
  assert.equal(
    (seen[0] as { maxTokens?: number }).maxTokens,
    5,
    "existing options are preserved",
  );
});

test("withReasoning returns the base function unchanged when no effort is set", () => {
  const base = (() => ({}) as ReturnType<StreamFunction>) as StreamFunction;
  assert.equal(withReasoning(base, undefined), base);
});

// ---------- (a) API-key credential ------------------------------------------

test("PiProviderSessionFactory API-key credential and known provider/model returns session with getApiKey returning the stored key", async () => {
  const factory = makeFactory();
  const session = await factory.for(makeAIProvider());
  assert.equal(session.getApiKey(), "sk-test-abc123");
});

// ---------- (b) OAuth credential --------------------------------------------

test("PiProviderSessionFactory OAuth JSON credential creates a session without throwing CredentialError", async () => {
  const factory = makeFactory();
  // should not throw
  const session = await factory.for(
    makeAIProvider({ value: oauthValue("access-tok-111", "refresh-tok-222") }),
  );
  assert.ok(session, "session is returned for OAuth credential");
});

test("PiProviderSessionFactory OAuth credential getApiKey returns '' so pi resolves+refreshes via the credential store", async () => {
  const factory = makeFactory();
  const session = await factory.for(
    makeAIProvider({ value: oauthValue("access-tok-777", "refresh-tok-888") }),
  );
  // A non-empty apiKey would make pi treat the request as api-key auth and
  // skip OAuth refresh (auth/resolve.ts). The token is resolved from the
  // credential store passed to builtinModels instead.
  assert.equal(session.getApiKey(), "");
  assert.ok(session.credentialStore, "credential store is wired for refresh");
});

test("PiProviderSessionFactory OAuth credential store read returns the latest credential after modify", async () => {
  const factory = makeFactory();
  const session = await factory.for(
    makeAIProvider({ value: oauthValue("access-old", "refresh-old") }),
  );
  const store = session.credentialStore!;
  const before = (await store.read("openai-codex")) as { access: string };
  assert.equal(before.access, "access-old");

  const rotated = {
    type: "oauth" as const,
    access: "access-rotated",
    refresh: "refresh-rotated",
    expires: Date.now() + 7_200_000,
  };
  await store.modify("openai-codex", async () => rotated);

  const after = (await store.read("openai-codex")) as { access: string };
  assert.equal(
    after.access,
    "access-rotated",
    "read reflects the rotated token, not the stale original",
  );
});

test("PiProviderSessionFactory OAuth store.modify returns the current credential (not undefined) when the callback makes no change", async () => {
  const saved: Array<{ id: string; value: string }> = [];
  const factory = makeFactory(saved);
  const session = await factory.for(
    makeAIProvider({ value: oauthValue("access-x", "refresh-y") }),
  );
  const store = session.credentialStore!;

  // pi's refresh callback returns undefined when another request already
  // refreshed. Per the CredentialStore contract, modify must then return the
  // latest stored credential — not undefined (which pi reads as "no auth").
  const returned = (await store.modify(
    "openai-codex",
    async () => undefined,
  )) as { access: string } | undefined;

  assert.ok(returned, "modify returns the current credential, not undefined");
  assert.equal(returned?.access, "access-x");
  assert.equal(
    saved.length,
    0,
    "no persistence when the callback made no change",
  );
});

test("PiProviderSessionFactory OAuth credential exposes credentialStore; modify calls saveCredentialValue with serialised new value", async () => {
  const saved: Array<{ id: string; value: string; expectedVersion?: number }> =
    [];
  const factory = makeFactory(saved);
  const session = await factory.for(
    makeAIProvider({
      id: "cred-oauth-01",
      value: oauthValue("access-tok-A", "refresh-tok-B"),
    }),
    undefined,
    1,
  );

  // The session exposes the CredentialStore for callers (and the runner)
  // to trigger token refresh without going through the agent loop.
  assert.ok(
    session.credentialStore,
    "session.credentialStore is set for OAuth sessions",
  );

  const newOAuth = {
    type: "oauth" as const,
    access: "access-tok-NEW",
    refresh: "refresh-tok-NEW",
    expires: Date.now() + 7_200_000,
  };
  await session.credentialStore.modify("openai", async () => newOAuth);

  assert.equal(saved.length, 1, "saveCredentialValue called once");
  assert.equal(saved[0]!.id, "cred-oauth-01", "saved with credential id");
  const parsed = JSON.parse(saved[0]!.value) as {
    access: string;
    type: string;
  };
  assert.equal(parsed.access, "access-tok-NEW");
  assert.equal(parsed.type, "oauth");
});

// ---------- Story G — credential-version CAS --------------------------------

test("(Story G) PiProviderSessionFactory OAuth credential: saveCredentialValue receives expectedCredentialVersion", async () => {
  const saved: Array<{ id: string; value: string; expectedVersion?: number }> =
    [];
  const factory = makeFactory(saved, true);
  const session = await factory.for(
    makeAIProvider({
      id: "cred-oauth-g1",
      value: oauthValue("access-A", "refresh-B"),
    }),
    undefined,
    3,
  );
  assert.ok(session.credentialStore, "session has credentialStore");

  const newOAuth = {
    type: "oauth" as const,
    access: "access-NEW",
    refresh: "refresh-NEW",
    expires: Date.now() + 7_200_000,
  };
  await session.credentialStore.modify("openai", async () => newOAuth);

  assert.equal(saved.length, 1, "saveCredentialValue called once");
  assert.equal(
    saved[0]!.expectedVersion,
    3,
    "saveCredentialValue called with expectedVersion=3",
  );
});

test("(Story G) PiProviderSessionFactory OAuth credential: version bumps after successful save", async () => {
  const saved: Array<{ id: string; value: string; expectedVersion?: number }> =
    [];
  const factory = makeFactory(saved, true);
  const session = await factory.for(
    makeAIProvider({
      id: "cred-oauth-g2",
      value: oauthValue("access-A", "refresh-B"),
    }),
    undefined,
    5,
  );
  assert.ok(session.credentialStore, "session has credentialStore");

  const newOAuth1 = {
    type: "oauth" as const,
    access: "access-NEW1",
    refresh: "ref1",
    expires: Date.now() + 7_200_000,
  };
  await session.credentialStore.modify("openai", async () => newOAuth1);
  assert.equal(saved.length, 1, "first modify called save");
  assert.equal(saved[0]!.expectedVersion, 5, "first save uses version 5");

  const newOAuth2 = {
    type: "oauth" as const,
    access: "access-NEW2",
    refresh: "ref2",
    expires: Date.now() + 7_200_000,
  };
  await session.credentialStore.modify("openai", async () => newOAuth2);
  assert.equal(saved.length, 2, "second modify called save");
  assert.equal(
    saved[1]!.expectedVersion,
    6,
    "second save uses bumped version 6",
  );
});

test("(Story G) PiProviderSessionFactory OAuth credential: save returning false (CAS mismatch) does not throw", async () => {
  const factory = makeFactory(undefined, false);
  const session = await factory.for(
    makeAIProvider({
      id: "cred-oauth-g3",
      value: oauthValue("access-A", "refresh-B"),
    }),
    undefined,
    3,
  );
  assert.ok(session.credentialStore, "session has credentialStore");

  const newOAuth = {
    type: "oauth" as const,
    access: "access-NEW",
    refresh: "refresh-NEW",
    expires: Date.now() + 7_200_000,
  };
  await assert.doesNotReject(() =>
    session.credentialStore!.modify("openai", async () => newOAuth),
  );
  // In-memory credential should still be updated even when save fails
  const after = (await session.credentialStore!.read("openai")) as {
    access: string;
  };
  assert.equal(
    after.access,
    "access-NEW",
    "in-memory credential updated despite CAS failure",
  );
});

test("(BLOCKER S1) PiProviderSessionFactory OAuth credential: registry.updateCredentialCAS throwing does not reject modify (write-back must not throw into the agent loop)", async () => {
  const registry: AiProviderRegistry = {
    updateCredentialCAS() {
      throw new Error("db unavailable");
    },
    register: () => {
      throw new Error("not implemented");
    },
    list: () => {
      throw new Error("not implemented");
    },
    get: () => {
      throw new Error("not implemented");
    },
    getDefault: () => {
      throw new Error("not implemented");
    },
    setDefault: () => {
      throw new Error("not implemented");
    },
    clearDefault: () => {
      throw new Error("not implemented");
    },
    logout: () => {
      throw new Error("not implemented");
    },
    remove: () => {
      throw new Error("not implemented");
    },
    assign: () => {
      throw new Error("not implemented");
    },
    unassign: () => {
      throw new Error("not implemented");
    },
    listAssigned: () => {
      throw new Error("not implemented");
    },
    maxRank: () => {
      throw new Error("not implemented");
    },
    shiftRanksFrom: () => {
      throw new Error("not implemented");
    },
    compactRanks: () => {
      throw new Error("not implemented");
    },
    getAssignment: () => {
      throw new Error("not implemented");
    },
    listProjectsAssigning: () => {
      throw new Error("not implemented");
    },
  };
  const factory = new PiProviderSessionFactory({ registry });
  const session = await factory.for(
    makeAIProvider({
      id: "cred-oauth-s1",
      value: oauthValue("access-A", "refresh-B"),
    }),
    undefined,
    3,
  );
  assert.ok(session.credentialStore, "session has credentialStore");

  const newOAuth = {
    type: "oauth" as const,
    access: "access-NEW",
    refresh: "refresh-NEW",
    expires: Date.now() + 7_200_000,
  };
  await assert.doesNotReject(
    () => session.credentialStore!.modify("openai", async () => newOAuth),
    "a throwing registry.updateCredentialCAS must not reject the agent loop's modify call",
  );
  // In-memory credential should still be updated even when the write-back throws.
  const after = (await session.credentialStore!.read("openai")) as {
    access: string;
  };
  assert.equal(
    after.access,
    "access-NEW",
    "in-memory credential updated despite the write-back throwing",
  );
});

// ---------- (c) provider mismatch -------------------------------------------

test("PiProviderSessionFactory provider mismatch throws CredentialError naming both providers but not containing the secret value", async () => {
  const factory = makeFactory();
  const provider = makeAIProvider({
    provider: "openai",
    value: "sk-ant-secret999",
  });
  // Since provider name == "openai" and the value is an API key, the session
  // should be created successfully — no provider mismatch possible with the
  // unified ResolvedProvider type (credential folded into provider).
  const session = await factory.for(provider);
  assert.ok(session, "session is returned for a valid provider");
});

// ---------- (d) empty value -------------------------------------------------

test("PiProviderSessionFactory empty credential value throws CredentialError", async () => {
  const factory = makeFactory();
  await assert.rejects(
    () => factory.for(makeAIProvider({ value: "" })),
    CredentialError,
  );
});

// ---------- (e) unknown model -----------------------------------------------

test("PiProviderSessionFactory unknown model throws UnknownModelError with provider and model names", async () => {
  const factory = makeFactory();
  const aiProvider = makeAIProvider({
    provider: "openai",
    model: "gpt-nonexistent-9999",
  });
  await assert.rejects(
    () => factory.for(aiProvider),
    (err: unknown) => {
      assert.ok(err instanceof UnknownModelError, "is UnknownModelError");
      assert.ok(
        err.message.includes("openai") || String(err.provider) === "openai",
        "error references provider",
      );
      assert.ok(
        err.message.includes("gpt-nonexistent-9999") ||
          String(err.model) === "gpt-nonexistent-9999",
        "error references model id",
      );
      return true;
    },
  );
});

// ---------- (f) baseUrl override --------------------------------------------

test("PiProviderSessionFactory with baseUrl set the session model baseUrl reflects the override", async () => {
  const factory = makeFactory();
  const aiProvider = makeAIProvider({
    provider: "openai",
    model: "gpt-5.5",
    baseUrl: "https://custom-endpoint.example.com/v1",
  });
  const session = await factory.for(aiProvider);
  assert.equal(
    session.model.baseUrl,
    "https://custom-endpoint.example.com/v1",
    "session.model.baseUrl matches AIProvider.baseUrl",
  );
});
