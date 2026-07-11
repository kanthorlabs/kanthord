/**
 * src/cli/login.test.ts
 *
 * Suite: Story 002 T2 — kanthord login CLI over the login operation
 *
 * Tests:
 *   - openai --account work: surfaces user code + URL; exits 0; account written
 *   - unknown kind: exits non-zero; nothing written to registry or store
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthCredential, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

import { createProviderAccountRegistry } from "../agent/provider-account-registry.ts";
import { createProviderCredentialStore } from "../agent/provider-credential-store.ts";
import { runLoginCommand, runMain } from "./login.ts";
import type { LoginCommandDeps } from "./login.ts";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CANNED_OAUTH: OAuthCredential = {
  type: "oauth",
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 3_600_000,
};

// ---------------------------------------------------------------------------
// T2 — CLI over the login operation
// ---------------------------------------------------------------------------

describe("login-cli — T2 kanthord login CLI", () => {
  test("openai --account work: surfaces user code + URL; exits 0; account written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-cli-login-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });
      const lines: string[] = [];

      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        callbacks.onDeviceCode({
          userCode: "OACX-1234",
          verificationUri: "https://auth.openai.com/device",
        });
        return CANNED_OAUTH;
      };

      const exitCode = await runLoginCommand(["openai", "--account", "work"], {
        registry,
        store,
        loginFns: { "openai-codex": fakeFn },
        out: (msg) => lines.push(msg),
      });

      assert.equal(exitCode, 0, "must exit 0 on success");

      // Surfaces the user code + URL through printed output
      const allOutput = lines.join("\n");
      assert.ok(
        allOutput.includes("OACX-1234"),
        "output must include the user code",
      );
      assert.ok(
        allOutput.includes("https://auth.openai.com/device"),
        "output must include the verification URL",
      );

      // Account is persisted in registry with the label from --account
      const accounts = await registry.list({ kind: "openai-codex" });
      assert.equal(accounts.length, 1, "exactly one account must be registered");
      assert.equal(accounts[0]?.label, "work", "account label must match --account arg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("openai --account work: surfaces user code + URL even when onDeviceCode fires asynchronously (002-async-devicecode regression)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-cli-login-async-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });
      const lines: string[] = [];

      // This fake AWAITS a microtask before calling onDeviceCode — matching
      // the real loginOpenAICodexDeviceCode which does a network fetch first.
      // Against the current synchronous getState() print the code is never seen.
      const asyncFakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        await Promise.resolve(); // yield one microtask before firing device-code
        callbacks.onDeviceCode({
          userCode: "ASYNC-9999",
          verificationUri: "https://auth.openai.com/device/async",
        });
        return CANNED_OAUTH;
      };

      const exitCode = await runLoginCommand(["openai", "--account", "async-work"], {
        registry,
        store,
        loginFns: { "openai-codex": asyncFakeFn },
        out: (msg) => lines.push(msg),
      });

      assert.equal(exitCode, 0, "must exit 0 on success");

      const allOutput = lines.join("\n");
      assert.ok(
        allOutput.includes("ASYNC-9999"),
        `output must include the user code; got: "${allOutput}"`,
      );
      assert.ok(
        allOutput.includes("https://auth.openai.com/device/async"),
        `output must include the verification URL; got: "${allOutput}"`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("unknown kind: exits non-zero; nothing written to registry or store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-cli-unknown-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      const exitCode = await runLoginCommand(["claude", "--account", "work"], {
        registry,
        store,
        loginFns: {},
        out: () => {},
      });

      assert.ok(exitCode !== 0, "must exit non-zero for unknown/unsupported kind");

      const accounts = await registry.list();
      assert.equal(accounts.length, 0, "no account must be registered for unknown kind");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T3-B3 CLI — --enterprise flag threads enterpriseDomain (Story 007)
// ---------------------------------------------------------------------------

describe("login-cli — T3-B3 --enterprise flag enterprise domain threading", () => {
  test("github-copilot --account X --enterprise company.ghe.com: onPrompt captures domain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-cli-ent-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      let capturedDomain: string | undefined;

      // Fake loginFn captures what onPrompt returns (the enterprise domain).
      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        capturedDomain = await callbacks.onPrompt({ message: "Enter GitHub Enterprise domain:" });
        return CANNED_OAUTH;
      };

      const exitCode = await runLoginCommand(
        ["github-copilot", "--account", "enterprise-acct", "--enterprise", "company.ghe.com"],
        {
          registry,
          store,
          loginFns: { "github-copilot": fakeFn },
          out: () => {},
        },
      );

      assert.equal(exitCode, 0, "must exit 0 on success");
      assert.equal(
        capturedDomain,
        "company.ghe.com",
        "--enterprise value must reach loginFn via onPrompt",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("github-copilot --account X (no --enterprise): onPrompt returns empty string (github.com default)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-cli-noent-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });

      let capturedDomain: string | undefined;

      const fakeFn = async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
        capturedDomain = await callbacks.onPrompt({ message: "Enter GitHub Enterprise domain:" });
        return CANNED_OAUTH;
      };

      const exitCode = await runLoginCommand(
        ["github-copilot", "--account", "personal"],
        {
          registry,
          store,
          loginFns: { "github-copilot": fakeFn },
          out: () => {},
        },
      );

      assert.equal(exitCode, 0, "must exit 0 on success");
      assert.equal(
        capturedDomain,
        "",
        "omitting --enterprise must leave onPrompt returning empty string (github.com default)",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T3 — runMain entrypoint wiring (006-cli-out-wiring)
// ---------------------------------------------------------------------------

describe("login-cli — T3 runMain entrypoint wiring (006-cli-out-wiring)", () => {
  test("runMain: injected out receives device code + URL even when onDeviceCode fires asynchronously; injected exit records 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-runmain-"));
    try {
      const store = createProviderCredentialStore({ dataRoot: dir });
      const registry = createProviderAccountRegistry({ dataRoot: dir, store });
      const lines: string[] = [];
      let capturedExit: number | undefined;

      const fakeBuildDeps = (_opts: { dataRoot: string }): LoginCommandDeps => ({
        registry,
        store,
        loginFns: {
          "openai-codex": async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
            await Promise.resolve(); // one microtask — mimics real pi-ai network fetch
            callbacks.onDeviceCode({
              userCode: "ABCD-1234",
              verificationUri: "https://example.test/device",
            });
            return CANNED_OAUTH;
          },
        },
      });

      await runMain(["openai", "--account", "live"], {
        buildDeps: fakeBuildDeps,
        out: (msg) => lines.push(msg),
        exit: (code) => { capturedExit = code; },
      });

      const allOutput = lines.join("\n");
      assert.ok(
        allOutput.includes("ABCD-1234"),
        `out must include user code ABCD-1234; got: "${allOutput}"`,
      );
      assert.ok(
        allOutput.includes("https://example.test/device"),
        `out must include verification URL; got: "${allOutput}"`,
      );
      assert.equal(capturedExit, 0, "injected exit must be called with 0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// S4 RED — USAGE / --help must mention --enterprise (Story 007)
//
// Operators running `kanthord login --help` must be able to discover the
// --enterprise flag. This test fails until the USAGE string in login.ts
// includes "--enterprise <domain>".
// ---------------------------------------------------------------------------

describe("login-cli — S4 --help output must advertise --enterprise flag", () => {
  test("runMain ['--help'] output includes '--enterprise' flag documentation", async () => {
    const lines: string[] = [];

    await runMain(["--help"], {
      buildDeps: (_opts) => ({
        registry: {} as never,
        store: {} as never,
        loginFns: {},
      }),
      out: (msg) => lines.push(msg),
      exit: () => {},
    });

    const output = lines.join("\n");
    assert.ok(
      output.includes("--enterprise"),
      `--help output must advertise the --enterprise flag; got:\n${output}`,
    );
  });
});
