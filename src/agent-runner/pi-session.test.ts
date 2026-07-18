/**
 * Story 04 T1 — PiProviderSessionFactory
 *
 * Tests for the ProviderSession / PiProviderSessionFactory seam.
 * All tests are hermetic: no network, no real OAuth flows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AIProvider, Credential } from "../domain/resource.ts";
import {
  CredentialError,
  UnknownModelError,
  PiProviderSessionFactory,
} from "./pi-session.ts";

// ---------- fixture builders -------------------------------------------------

function makeAIProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: "aip-01",
    type: "ai_provider",
    name: "test-openai",
    provider: "openai",
    model: "gpt-5.5",
    ...overrides,
  };
}

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "cred-01",
    type: "credential",
    name: "test-key",
    provider: "openai",
    value: "sk-test-abc123",
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

function makeFactory(
  saved?: Array<{ id: string; value: string }>,
): PiProviderSessionFactory {
  return new PiProviderSessionFactory({
    saveCredentialValue: (id: string, value: string) => {
      saved?.push({ id, value });
    },
  });
}

// ---------- (a) API-key credential ------------------------------------------

test("PiProviderSessionFactory API-key credential and known provider/model returns session with getApiKey returning the stored key", async () => {
  const factory = makeFactory();
  const session = await factory.for(makeAIProvider(), makeCredential());
  assert.equal(session.getApiKey(), "sk-test-abc123");
});

// ---------- (b) OAuth credential --------------------------------------------

test("PiProviderSessionFactory OAuth JSON credential creates a session without throwing CredentialError", async () => {
  const factory = makeFactory();
  const cred = makeCredential({
    value: oauthValue("access-tok-111", "refresh-tok-222"),
  });
  // should not throw
  const session = await factory.for(makeAIProvider(), cred);
  assert.ok(session, "session is returned for OAuth credential");
});

test("PiProviderSessionFactory OAuth credential getApiKey returns the OAuth access token", async () => {
  const factory = makeFactory();
  const cred = makeCredential({
    value: oauthValue("access-tok-777", "refresh-tok-888"),
  });
  const session = await factory.for(makeAIProvider(), cred);
  // The access token is used as the API key for OAuth credentials
  assert.equal(session.getApiKey(), "access-tok-777");
});

test("PiProviderSessionFactory OAuth credential exposes credentialStore; modify calls saveCredentialValue with serialised new value", async () => {
  const saved: Array<{ id: string; value: string }> = [];
  const factory = makeFactory(saved);
  const cred = makeCredential({
    id: "cred-oauth-01",
    value: oauthValue("access-tok-A", "refresh-tok-B"),
  });
  const session = await factory.for(makeAIProvider(), cred);

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

// ---------- (c) provider mismatch -------------------------------------------

test("PiProviderSessionFactory provider mismatch throws CredentialError naming both providers but not containing the secret value", async () => {
  const factory = makeFactory();
  const aiProvider = makeAIProvider({ provider: "openai" });
  const cred = makeCredential({
    provider: "anthropic",
    value: "sk-ant-secret999",
  });
  await assert.rejects(
    () => factory.for(aiProvider, cred),
    (err: unknown) => {
      assert.ok(err instanceof CredentialError, "is CredentialError");
      assert.ok(
        err.message.includes("openai"),
        `message contains 'openai': ${err.message}`,
      );
      assert.ok(
        err.message.includes("anthropic"),
        `message contains 'anthropic': ${err.message}`,
      );
      assert.ok(
        !err.message.includes("sk-ant-secret999"),
        "message must NOT contain the secret value",
      );
      return true;
    },
  );
});

// ---------- (d) empty value -------------------------------------------------

test("PiProviderSessionFactory empty credential value throws CredentialError", async () => {
  const factory = makeFactory();
  const cred = makeCredential({ value: "" });
  await assert.rejects(
    () => factory.for(makeAIProvider(), cred),
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
    () => factory.for(aiProvider, makeCredential()),
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
  const session = await factory.for(aiProvider, makeCredential());
  assert.equal(
    session.model.baseUrl,
    "https://custom-endpoint.example.com/v1",
    "session.model.baseUrl matches AIProvider.baseUrl",
  );
});
