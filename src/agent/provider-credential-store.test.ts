/**
 * src/agent/provider-credential-store.test.ts
 *
 * Suite: Story 001 — ProviderAccount registry + account-keyed credential store
 * Tasks covered: T1 (round-trip + modify), T2 (custody invariants)
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthCredential } from "@earendil-works/pi-ai";

import { IdentityLoadError } from "../git/keyring.ts";
import {
  createProviderCredentialStore,
  type ProviderCredentialStore,
} from "./provider-credential-store.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOAuth(tag: string): OAuthCredential {
  return {
    type: "oauth",
    access: `access-${tag}`,
    refresh: `refresh-${tag}`,
    expires: Date.now() + 3_600_000,
  };
}

// ---------------------------------------------------------------------------
// T1 — round-trip + modify
// ---------------------------------------------------------------------------

describe("provider-credential-store — T1 round-trip + modify", () => {
  let tmpDir: string;
  let store: ProviderCredentialStore;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-cred-store-t1-"));
    store = createProviderCredentialStore({ dataRoot: tmpDir });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("read of absent account id resolves undefined", async () => {
    const result = await store.read("acct_absent_123");
    assert.equal(result, undefined);
  });

  test("modify writes an oauth credential; read returns equal value", async () => {
    const cred = makeOAuth("alpha");
    await store.modify("acct_alpha", async () => cred);
    const result = await store.read("acct_alpha");
    assert.deepEqual(result, cred);
  });

  test("modify with rotated credential persists the new value", async () => {
    const cred1 = makeOAuth("beta-v1");
    const cred2 = makeOAuth("beta-v2");
    await store.modify("acct_beta", async () => cred1);
    await store.modify("acct_beta", async () => cred2);
    const result = await store.read("acct_beta");
    assert.deepEqual(result, cred2);
  });

  test("modify returning undefined is a no-op — credential unchanged", async () => {
    const cred = makeOAuth("gamma");
    await store.modify("acct_gamma", async () => cred);
    // fn returns undefined → no change
    await store.modify("acct_gamma", async (_current) => undefined);
    const result = await store.read("acct_gamma");
    assert.deepEqual(result, cred);
  });

  test("two accounts of the same provider kind coexist under different ids", async () => {
    const credA = makeOAuth("codex-work");
    const credB = makeOAuth("codex-repo-a");
    // Both are "openai-codex" accounts — the store keys only by account id
    await store.modify("acct_codex_work", async () => credA);
    await store.modify("acct_codex_repo_a", async () => credB);
    const resultA = await store.read("acct_codex_work");
    const resultB = await store.read("acct_codex_repo_a");
    assert.deepEqual(resultA, credA);
    assert.deepEqual(resultB, credB);
    // Reading one does not contaminate the other
    assert.notDeepEqual(resultA, resultB);
  });

  test("delete removes the credential; subsequent read resolves undefined", async () => {
    const cred = makeOAuth("delta");
    await store.modify("acct_delta", async () => cred);
    assert.notEqual(await store.read("acct_delta"), undefined);
    await store.delete("acct_delta");
    assert.equal(await store.read("acct_delta"), undefined);
  });
});

// ---------------------------------------------------------------------------
// T2 — custody invariants (perms, owner, log redaction)
// ---------------------------------------------------------------------------

describe("provider-credential-store — T2 custody invariants", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-cred-store-t2-"));
  });

  after(async () => {
    // Restore writable perms so rm can clean up
    try {
      await chmod(join(tmpDir, "credentials.json"), 0o600);
    } catch {
      // file may not exist
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("fresh store file is created with mode 0600", async () => {
    const store = createProviderCredentialStore({ dataRoot: tmpDir });
    await store.modify("acct_perm_check", async () => makeOAuth("perm"));
    const { stat } = await import("node:fs/promises");
    const info = await stat(join(tmpDir, "credentials.json"));
    assert.equal(info.mode & 0o777, 0o600);
  });

  test("opening a store with a 0644 backing file throws insecure-file-mode", async () => {
    // Create the file at 0600, then widen to 0644
    const store1 = createProviderCredentialStore({ dataRoot: tmpDir });
    await store1.modify("acct_widen", async () => makeOAuth("widen"));
    await chmod(join(tmpDir, "credentials.json"), 0o644);

    // Now create a new store instance against the same root
    const store2 = createProviderCredentialStore({ dataRoot: tmpDir });
    await assert.rejects(
      () => store2.read("acct_widen"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { code?: string }).code, "insecure-file-mode");
        return true;
      },
    );
  });

  test("log callback never receives a raw access or refresh token value", async () => {
    // Restore to 0600 for this sub-test
    await chmod(join(tmpDir, "credentials.json"), 0o600);
    const logLines: string[] = [];
    const store = createProviderCredentialStore({
      dataRoot: tmpDir,
      log: (msg) => logLines.push(msg),
    });
    const cred = makeOAuth("secret-value-xyz");
    await store.modify("acct_log", async () => cred);
    await store.read("acct_log");

    for (const line of logLines) {
      assert.ok(
        !line.includes("access-secret-value-xyz"),
        `log line contains raw access token: ${line}`,
      );
      assert.ok(
        !line.includes("refresh-secret-value-xyz"),
        `log line contains raw refresh token: ${line}`,
      );
    }
  });

  // S1 regression: custody error must be instanceof IdentityLoadError (not plain Error)
  test("insecure-file-mode custody error is instanceof IdentityLoadError (S1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-cred-store-s1-"));
    try {
      const store1 = createProviderCredentialStore({ dataRoot: dir });
      await store1.modify("acct_s1", async () => makeOAuth("s1"));
      // Widen to 0644 to trigger the custody check
      await chmod(join(dir, "credentials.json"), 0o644);
      const store2 = createProviderCredentialStore({ dataRoot: dir });
      await assert.rejects(
        () => store2.read("acct_s1"),
        (err: unknown) => {
          // Must be instanceof IdentityLoadError — not a plain Error
          assert.ok(
            err instanceof IdentityLoadError,
            `expected IdentityLoadError but got ${Object.prototype.toString.call(err)}`,
          );
          assert.equal((err as IdentityLoadError).code, "insecure-file-mode");
          return true;
        },
      );
    } finally {
      try { await chmod(join(dir, "credentials.json"), 0o600); } catch { /* ignore */ }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
