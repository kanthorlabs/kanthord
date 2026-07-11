/**
 * src/cli/daemon-provider-session.test.ts
 *
 * Suite: src/cli/daemon-provider-session.ts
 * Task T1 (Story 001, Epic 019.6): boot-time account→session resolver
 *
 * Run hermetically — no real model calls; no network.
 *   node --import ./src/harness/no-network-guard.ts --test \
 *        src/cli/daemon-provider-session.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createProviderAccountRegistry } from "../agent/provider-account-registry.ts";
import { createProviderCredentialStore } from "../agent/provider-credential-store.ts";
import { resolveDaemonProviderSession } from "./daemon-provider-session.ts";

// ---------------------------------------------------------------------------
// Temp-dir helpers
// ---------------------------------------------------------------------------

function makeTempDir(suffix: string): string {
  return join(tmpdir(), `daemon-prov-sess-${suffix}-${Date.now()}`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/cli/daemon-provider-session.ts", () => {
  // -------------------------------------------------------------------------
  // Happy path: explicit label + explicit modelId
  // -------------------------------------------------------------------------

  describe("resolveDaemonProviderSession — happy path (label + modelId)", () => {
    let dataRoot: string;

    before(async () => {
      dataRoot = makeTempDir("happy");
      await mkdir(dataRoot, { recursive: true });

      const store = createProviderCredentialStore({ dataRoot });
      const registry = createProviderAccountRegistry({ dataRoot, store });

      // Add a logged-in openai-codex account.
      const account = await registry.add({
        providerKind: "openai-codex",
        label: "work",
      });

      // Write a fake OAuth credential so the account appears "logged in".
      await store.modify(account.credentialKey, async () => ({
        type: "oauth" as const,
        access: "fake-access-token",
        refresh: "fake-refresh-token",
        expires: Date.now() + 3_600_000,
      }));
    });

    after(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it("returns model.provider === openai-codex", async () => {
      const session = await resolveDaemonProviderSession({
        dataRoot,
        accountLabel: "work",
        modelId: "gpt-5.5",
      });
      assert.equal(session.model.provider, "openai-codex");
    });

    it("returns model.id === gpt-5.5", async () => {
      const session = await resolveDaemonProviderSession({
        dataRoot,
        accountLabel: "work",
        modelId: "gpt-5.5",
      });
      assert.equal(session.model.id, "gpt-5.5");
    });

    it("returns streamFn as a function (no network call at build time)", async () => {
      const session = await resolveDaemonProviderSession({
        dataRoot,
        accountLabel: "work",
        modelId: "gpt-5.5",
      });
      assert.equal(typeof session.streamFn, "function");
    });
  });

  // -------------------------------------------------------------------------
  // Sole-account auto-select: no label, exactly one account
  // -------------------------------------------------------------------------

  describe("resolveDaemonProviderSession — sole account auto-select", () => {
    let dataRoot: string;

    before(async () => {
      dataRoot = makeTempDir("auto");
      await mkdir(dataRoot, { recursive: true });

      const store = createProviderCredentialStore({ dataRoot });
      const registry = createProviderAccountRegistry({ dataRoot, store });

      const account = await registry.add({
        providerKind: "openai-codex",
        label: "solo",
      });

      await store.modify(account.credentialKey, async () => ({
        type: "oauth" as const,
        access: "fake-access-token",
        refresh: "fake-refresh-token",
        expires: Date.now() + 3_600_000,
      }));
    });

    after(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it("resolves the sole account when no label is given", async () => {
      const session = await resolveDaemonProviderSession({
        dataRoot,
        modelId: "gpt-5.5",
      });
      assert.equal(session.model.provider, "openai-codex");
    });
  });

  // -------------------------------------------------------------------------
  // Error: empty data root — no accounts registered
  // -------------------------------------------------------------------------

  describe("resolveDaemonProviderSession — empty data root rejects with login hint", () => {
    let dataRoot: string;

    before(async () => {
      dataRoot = makeTempDir("empty");
      await mkdir(dataRoot, { recursive: true });
    });

    after(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it("rejects with a message containing 'kanthord login'", async () => {
      await assert.rejects(
        () =>
          resolveDaemonProviderSession({
            dataRoot,
            modelId: "gpt-5.5",
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes("kanthord login"),
            `expected 'kanthord login' in error message, got: ${err.message}`,
          );
          return true;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error: multiple accounts, no label → ambiguous
  // -------------------------------------------------------------------------

  describe("resolveDaemonProviderSession — ambiguous accounts rejects with --account hint", () => {
    let dataRoot: string;

    before(async () => {
      dataRoot = makeTempDir("ambig");
      await mkdir(dataRoot, { recursive: true });

      const store = createProviderCredentialStore({ dataRoot });
      const registry = createProviderAccountRegistry({ dataRoot, store });

      await registry.add({ providerKind: "openai-codex", label: "alpha" });
      await registry.add({ providerKind: "openai-codex", label: "beta" });
    });

    after(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it("rejects with a message containing '--account'", async () => {
      await assert.rejects(
        () =>
          resolveDaemonProviderSession({
            dataRoot,
            modelId: "gpt-5.5",
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes("--account"),
            `expected '--account' in error message, got: ${err.message}`,
          );
          return true;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error: account has no defaultModel, no modelId given
  // -------------------------------------------------------------------------

  describe("resolveDaemonProviderSession — missing model rejects with --model hint", () => {
    let dataRoot: string;

    before(async () => {
      dataRoot = makeTempDir("nomodel");
      await mkdir(dataRoot, { recursive: true });

      const store = createProviderCredentialStore({ dataRoot });
      const registry = createProviderAccountRegistry({ dataRoot, store });

      await registry.add({
        providerKind: "openai-codex",
        label: "work",
        // no defaultModel
      });
    });

    after(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it("rejects with a message containing '--model'", async () => {
      await assert.rejects(
        () =>
          resolveDaemonProviderSession({
            dataRoot,
            accountLabel: "work",
            // no modelId
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes("--model"),
            `expected '--model' in error message, got: ${err.message}`,
          );
          return true;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // B1: label supplied, accounts exist, none matches → --account error
  // -------------------------------------------------------------------------

  describe("resolveDaemonProviderSession — label matches none rejects with --account hint", () => {
    let dataRoot: string;

    before(async () => {
      dataRoot = makeTempDir("nomatch");
      await mkdir(dataRoot, { recursive: true });

      const store = createProviderCredentialStore({ dataRoot });
      const registry = createProviderAccountRegistry({ dataRoot, store });

      await registry.add({ providerKind: "openai-codex", label: "alpha" });
      await registry.add({ providerKind: "openai-codex", label: "beta" });
    });

    after(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it("rejects with a message containing '--account' when label matches none", async () => {
      await assert.rejects(
        () =>
          resolveDaemonProviderSession({
            dataRoot,
            accountLabel: "gamma",
            modelId: "gpt-5.5",
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes("--account"),
            `expected '--account' in error message, got: ${err.message}`,
          );
          return true;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // B2: modelId omitted + account has defaultModel → session.model.id === defaultModel
  // -------------------------------------------------------------------------

  describe("resolveDaemonProviderSession — defaultModel fallback when modelId omitted", () => {
    let dataRoot: string;

    before(async () => {
      dataRoot = makeTempDir("defmodel");
      await mkdir(dataRoot, { recursive: true });

      const store = createProviderCredentialStore({ dataRoot });
      const registry = createProviderAccountRegistry({ dataRoot, store });

      // defaultModel must be a valid openai-codex model id
      const account = await registry.add({
        providerKind: "openai-codex",
        label: "work",
        defaultModel: "gpt-5.4",
      });

      await store.modify(account.credentialKey, async () => ({
        type: "oauth" as const,
        access: "fake-access-token",
        refresh: "fake-refresh-token",
        expires: Date.now() + 3_600_000,
      }));
    });

    after(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it("uses account defaultModel when modelId is omitted", async () => {
      const session = await resolveDaemonProviderSession({
        dataRoot,
        // no modelId — should fall back to account.defaultModel ("gpt-5.4")
      });
      assert.equal(session.model.id, "gpt-5.4");
    });
  });
});
