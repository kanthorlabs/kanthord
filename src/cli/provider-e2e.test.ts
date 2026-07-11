/**
 * src/cli/provider-e2e.test.ts
 *
 * Hermetic CLI end-to-end gate (EPIC 019.4 Verification Gate).
 *
 * Exercises the full management surface without any network call:
 *   add two accounts of the same kind (fake login) →
 *   list them →
 *   resolve a session binding for a task →
 *   confirm the binding persists across a simulated respawn (fresh store, same dir) →
 *   remove an account → confirm it is gone.
 *
 * All OAuth and pi-ai interactions use fakes. No socket is opened.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthCredential, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

import { createProviderAccountRegistry } from "../agent/provider-account-registry.ts";
import { createProviderCredentialStore } from "../agent/provider-credential-store.ts";
import { createAccountBindingStore, resolveOrBindAccount } from "../agent/account-binding.ts";
import { runLoginCommand } from "./login.ts";

// ---------------------------------------------------------------------------
// Fake loginFn — emits device-code callback synchronously then resolves
// ---------------------------------------------------------------------------

function makeFakeLoginFn(
  userCode: string,
  verificationUri: string,
): (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredential> {
  return async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredential> => {
    callbacks.onDeviceCode({ userCode, verificationUri });
    return {
      type: "oauth",
      access: `access-${userCode}`,
      refresh: `refresh-${userCode}`,
      expires: Date.now() + 3_600_000,
    };
  };
}

// ---------------------------------------------------------------------------
// CLI end-to-end hermetic gate
// ---------------------------------------------------------------------------

test("CLI e2e hermetic gate — add two same-kind accounts, list, resolve binding, respawn persistence, remove", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-e2e-"));
  try {
    // --- 1. Wire up the management surface ---
    const store = createProviderCredentialStore({ dataRoot: dir });
    const registry = createProviderAccountRegistry({ dataRoot: dir, store });
    const bindingStore = createAccountBindingStore({ dataRoot: dir });
    const lines: string[] = [];

    // --- 2. Add first openai-codex account (label: "work") via fake login ---
    const exitCode1 = await runLoginCommand(
      ["openai", "--account", "work"],
      {
        registry,
        store,
        loginFns: {
          "openai-codex": makeFakeLoginFn("WRKC-0001", "https://auth.openai.com/device"),
        },
        out: (msg) => lines.push(msg),
      },
    );
    assert.equal(exitCode1, 0, "first login must exit 0");
    assert.ok(
      lines.some((l) => l.includes("WRKC-0001")),
      "first login must surface the user code",
    );

    // --- 3. Add second openai-codex account (label: "repo-a-1") via fake login ---
    const exitCode2 = await runLoginCommand(
      ["openai", "--account", "repo-a-1"],
      {
        registry,
        store,
        loginFns: {
          "openai-codex": makeFakeLoginFn("RPOA-0002", "https://auth.openai.com/device"),
        },
        out: (msg) => lines.push(msg),
      },
    );
    assert.equal(exitCode2, 0, "second login must exit 0");
    assert.ok(
      lines.some((l) => l.includes("RPOA-0002")),
      "second login must surface the user code",
    );

    // --- 4. List — both accounts appear, both are openai-codex ---
    const allAccounts = await registry.list({ kind: "openai-codex" });
    assert.equal(allAccounts.length, 2, "exactly two openai-codex accounts must be registered");
    const labels = allAccounts.map((a) => a.label).sort();
    assert.deepEqual(labels, ["repo-a-1", "work"], "both labels must be present");

    // --- 5. Resolve a durable binding for a task (first spawn) ---
    const workAccount = allAccounts.find((a) => a.label === "work");
    assert.ok(workAccount !== undefined, "work account must exist");

    const taskId = "task-e2e-001";
    const modelId = "gpt-codex-mini";
    const binding = await resolveOrBindAccount({
      taskId,
      store: bindingStore,
      slotAccountId: workAccount.id,
      modelId,
    });
    assert.equal(binding.accountId, workAccount.id, "binding must record the selected account id");
    assert.equal(binding.modelId, modelId, "binding must record the model id");

    // --- 6. Respawn: fresh binding store on the same dir reads the same binding ---
    const bindingStore2 = createAccountBindingStore({ dataRoot: dir });
    const bindingAfterRespawn = await bindingStore2.read(taskId);
    assert.ok(bindingAfterRespawn !== undefined, "binding must persist for a fresh store instance");
    assert.equal(
      bindingAfterRespawn.accountId,
      workAccount.id,
      "respawn must resolve the same account id",
    );
    assert.equal(
      bindingAfterRespawn.modelId,
      modelId,
      "respawn must resolve the same model id",
    );

    // --- 7. resolveOrBindAccount on respawn returns the existing binding (ignores new slot) ---
    const repoAccount = allAccounts.find((a) => a.label === "repo-a-1");
    assert.ok(repoAccount !== undefined, "repo-a-1 account must exist");
    const bindingRespawnCall = await resolveOrBindAccount({
      taskId,
      store: bindingStore2,
      slotAccountId: repoAccount.id, // different account — must be ignored
      modelId: "different-model",
    });
    assert.equal(
      bindingRespawnCall.accountId,
      workAccount.id,
      "existing binding must take precedence over new slotAccountId on respawn",
    );

    // --- 8. Remove the repo-a-1 account ---
    await registry.remove(repoAccount.id);

    // --- 9. Confirm it is gone ---
    const remaining = await registry.list({ kind: "openai-codex" });
    assert.equal(remaining.length, 1, "only one account must remain after remove");
    assert.equal(remaining[0]?.label, "work", "the remaining account must be 'work'");

    // Confirm removing a non-existent id throws
    await assert.rejects(
      () => registry.remove(repoAccount.id),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must throw an Error");
        assert.ok(
          err.message.includes(repoAccount.id),
          "error must name the missing account id",
        );
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
