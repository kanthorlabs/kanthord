/**
 * src/agent/login-operation.test.ts
 *
 * Suite: Story 002 T1 — observable login operation writes an account on success
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthCredential, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

import { startLoginOperation } from "./login-operation.ts";
import { createProviderAccountRegistry } from "./provider-account-registry.ts";
import { createProviderCredentialStore } from "./provider-credential-store.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CANNED_OAUTH: OAuthCredential = {
  type: "oauth",
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 3_600_000,
};

// ---------------------------------------------------------------------------
// T1 — observable login operation
// ---------------------------------------------------------------------------

describe("login-operation — T1 observable login", () => {
  test("github-copilot: state transitions to device-code then complete; account and credential written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-login-cp-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      // Deferred resolve lets us inspect state before login completes
      let resolveLogin!: (cred: OAuthCredential) => void;
      const loginPromise = new Promise<OAuthCredential>((r) => {
        resolveLogin = r;
      });

      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        callbacks.onDeviceCode({
          userCode: "GHCP-0001",
          verificationUri: "https://github.com/login/device",
        });
        return loginPromise;
      };

      const op = startLoginOperation({
        providerKind: "github-copilot",
        label: "copilot-work",
        loginFn: fakeFn,
        registry,
        store,
      });

      // Yield so onDeviceCode propagates into the operation's state
      await new Promise<void>((r) => setImmediate(r));

      const s1 = op.getState() as Record<string, unknown>;
      assert.equal(s1["phase"], "device-code", "state must be device-code after onDeviceCode fires");
      assert.equal(s1["userCode"], "GHCP-0001", "userCode must match");
      assert.equal(
        s1["verificationUri"],
        "https://github.com/login/device",
        "verificationUri must match",
      );

      // Now complete the login
      resolveLogin(CANNED_OAUTH);
      await op.result;

      const s2 = op.getState() as Record<string, unknown>;
      assert.equal(s2["phase"], "complete");
      const accountId = s2["accountId"] as string;
      assert.ok(accountId, "complete state must carry accountId");

      // Account is in the registry
      const accounts = await registry.list({ kind: "github-copilot" });
      assert.equal(accounts.length, 1, "exactly one account registered");
      assert.equal(accounts[0]?.label, "copilot-work");
      assert.equal(accounts[0]?.id, accountId);

      // Credential is stored under the account id
      const stored = await store.read(accountId);
      assert.deepEqual(stored, CANNED_OAUTH, "stored credential must match canned value");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("openai-codex: state transitions to device-code then complete; account and credential written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-login-oi-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      const codexCred: OAuthCredential = {
        ...CANNED_OAUTH,
        access: "codex-access-token",
      };

      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        callbacks.onDeviceCode({
          userCode: "OACX-9999",
          verificationUri: "https://auth.openai.com/device",
        });
        return codexCred;
      };

      const op = startLoginOperation({
        providerKind: "openai-codex",
        label: "codex-work",
        loginFn: fakeFn,
        registry,
        store,
      });

      await op.result;

      const s = op.getState() as Record<string, unknown>;
      assert.equal(s["phase"], "complete");
      const accountId = s["accountId"] as string;
      assert.ok(accountId, "complete state must carry accountId");

      const accounts = await registry.list({ kind: "openai-codex" });
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0]?.label, "codex-work");

      const stored = await store.read(accountId);
      assert.ok(stored !== undefined, "credential must be stored");
      assert.equal((stored as OAuthCredential).access, "codex-access-token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("regression 006: loginFn resolving credential without type field still persists type:oauth", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-login-notype-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      // Simulate a real OAuth response that lacks the `type` discriminant field
      // (the live OpenAI device-code flow was observed returning just { access, refresh, expires })
      const bareCredential = {
        access: "notype-access-token",
        refresh: "notype-refresh-token",
        expires: Date.now() + 3_600_000,
      } as unknown as OAuthCredential;

      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        callbacks.onDeviceCode({
          userCode: "NT-0001",
          verificationUri: "https://auth.openai.com/device",
        });
        return bareCredential;
      };

      const op = startLoginOperation({
        providerKind: "openai-codex",
        label: "notype-work",
        loginFn: fakeFn,
        registry,
        store,
      });

      await op.result;

      const s = op.getState() as Record<string, unknown>;
      assert.equal(s["phase"], "complete", "state must be complete");
      const accountId = s["accountId"] as string;

      const stored = await store.read(accountId) as Record<string, unknown>;
      assert.ok(stored !== undefined, "credential must be stored");
      assert.equal(stored["type"], "oauth", "persisted credential must have type:oauth stamped by startLoginOperation");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cancel: seam rejects → state failed; registry and store untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-login-cancel-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      const fakeFn = async (_callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        throw new Error("user cancelled");
      };

      const op = startLoginOperation({
        providerKind: "github-copilot",
        label: "cancelled-copilot",
        loginFn: fakeFn,
        registry,
        store,
      });

      // op.result resolves in all terminal states (complete or failed)
      await op.result;

      const s = op.getState() as Record<string, unknown>;
      assert.equal(s["phase"], "failed", "state must be failed on seam rejection");

      // Nothing persisted
      const accounts = await registry.list();
      assert.equal(accounts.length, 0, "no account must be registered on cancel");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T3 — enterprise-domain Copilot login (B3)
// ---------------------------------------------------------------------------

describe("login-operation — T3 enterprise-domain Copilot login (B3)", () => {
  test("T3-B3 — enterpriseDomain supplied: onPrompt delivers domain to loginFn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-login-ent-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      let capturedPromptResponse: string | undefined;

      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        // Real loginGitHubCopilot calls onPrompt to ask for the enterprise host;
        // startLoginOperation must supply enterpriseDomain as the response.
        capturedPromptResponse = await callbacks.onPrompt({ message: "Enter GitHub Enterprise domain:" });
        return CANNED_OAUTH;
      };

      const op = startLoginOperation({
        providerKind: "github-copilot",
        label: "enterprise-copilot",
        loginFn: fakeFn,
        registry,
        store,
        enterpriseDomain: "company.ghe.com",
      });

      await op.result;

      assert.equal(
        capturedPromptResponse,
        "company.ghe.com",
        "onPrompt must return the enterprise domain supplied to startLoginOperation",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Characterization lock: existing behavior — onPrompt returns "" when no
  // enterpriseDomain is supplied, preserving pi-ai's github.com default resolution.
  test("T3-B3 — no enterpriseDomain: onPrompt returns empty string (github.com default preserved)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-login-noent-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      let capturedPromptResponse: string | undefined;

      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        capturedPromptResponse = await callbacks.onPrompt({ message: "Enter GitHub Enterprise domain:" });
        return CANNED_OAUTH;
      };

      const op = startLoginOperation({
        providerKind: "github-copilot",
        label: "individual-copilot",
        loginFn: fakeFn,
        registry,
        store,
        // No enterpriseDomain — github.com default (onPrompt must return "")
      });

      await op.result;

      assert.equal(
        capturedPromptResponse,
        "",
        "onPrompt must return empty string when no enterpriseDomain is supplied (github.com default)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
