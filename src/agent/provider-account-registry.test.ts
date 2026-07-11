/**
 * src/agent/provider-account-registry.test.ts
 *
 * Suite: Story 001 T3 — ProviderAccount registry CRUD
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";

import {
  createProviderAccountRegistry,
  type ProviderAccount,
  type ProviderKind,
} from "./provider-account-registry.ts";
import type { ProviderCredentialStore } from "./provider-credential-store.ts";

// ---------------------------------------------------------------------------
// Fake credential store — structurally matches ProviderCredentialStore
// ---------------------------------------------------------------------------

function makeFakeStore(): ProviderCredentialStore & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    async read(_key: string): Promise<Credential | undefined> {
      return undefined;
    },
    async modify(
      _key: string,
      _fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    ): Promise<Credential | undefined> {
      return undefined;
    },
    async delete(key: string): Promise<void> {
      deleted.push(key);
    },
  };
}

// ---------------------------------------------------------------------------
// T3 — ProviderAccount registry CRUD
// ---------------------------------------------------------------------------

describe("provider-account-registry — T3 CRUD", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kanthord-reg-t3-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("add returns an account with a fresh id and the given providerKind + label", async () => {
    const reg = createProviderAccountRegistry({
      dataRoot: tmpDir,
      store: makeFakeStore(),
    });
    const account = await reg.add({ providerKind: "openai-codex", label: "work" });
    assert.ok(account.id, "id must be non-empty");
    assert.equal(account.providerKind, "openai-codex");
    assert.equal(account.label, "work");
  });

  test("list returns all registered accounts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-list-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      const a = await reg.add({ providerKind: "openai-codex", label: "a" });
      const b = await reg.add({ providerKind: "github-copilot", label: "b" });
      const all = await reg.list();
      assert.ok(all.some((x) => x.id === a.id));
      assert.ok(all.some((x) => x.id === b.id));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("list filtered by kind returns only accounts of that kind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-list-kind-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      await reg.add({ providerKind: "openai-codex", label: "codex-1" });
      await reg.add({ providerKind: "openai-codex", label: "codex-2" });
      await reg.add({ providerKind: "github-copilot", label: "copilot-1" });
      const codexOnly = await reg.list({ kind: "openai-codex" });
      assert.equal(codexOnly.length, 2);
      assert.ok(codexOnly.every((a) => a.providerKind === "openai-codex"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("two same-kind accounts with different labels both appear in list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-same-kind-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      const w = await reg.add({ providerKind: "openai-codex", label: "work" });
      const r = await reg.add({ providerKind: "openai-codex", label: "repo-a" });
      assert.notEqual(w.id, r.id, "distinct ids for same-kind accounts");
      const codexAccounts = (await reg.list()).filter(
        (a: ProviderAccount) => a.providerKind === "openai-codex",
      );
      assert.equal(codexAccounts.length, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("update changes the label and returns the updated account", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-update-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      const account = await reg.add({ providerKind: "openai-codex", label: "old" });
      const updated = await reg.update(account.id, { label: "new-label" });
      assert.equal(updated.label, "new-label");
      assert.equal(updated.id, account.id);
      assert.equal(updated.providerKind, account.providerKind);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("remove deletes the account and calls store.delete with the account id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-remove-"));
    try {
      const fake = makeFakeStore();
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: fake });
      const account = await reg.add({ providerKind: "openai-codex", label: "to-remove" });
      await reg.remove(account.id);
      assert.ok(
        fake.deleted.includes(account.id),
        "store.delete must be called with account id",
      );
      const all = await reg.list();
      assert.ok(!all.some((a: ProviderAccount) => a.id === account.id), "account must be gone from list");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // S2 regression: get() success path must be tested against the real file-backed impl
  test("get success path — add then get(id) returns deepEqual account (S2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-get-success-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      const added = await reg.add({ providerKind: "openai-codex", label: "get-success" });
      const fetched = await reg.get(added.id);
      assert.deepEqual(fetched, added);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("get on an unknown id throws a typed error naming the id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-get-unknown-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      const unknownId = "acct_does_not_exist";
      await assert.rejects(
        () => reg.get(unknownId),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            (err as Error).message.includes(unknownId),
            `error must name id "${unknownId}"`,
          );
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("update on an unknown id throws a typed error naming the id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-update-unknown-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      const unknownId = "acct_update_missing";
      await assert.rejects(
        () => reg.update(unknownId, { label: "x" }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            (err as Error).message.includes(unknownId),
            `error must name id "${unknownId}"`,
          );
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("remove on an unknown id throws a typed error naming the id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanthord-reg-remove-unknown-"));
    try {
      const reg = createProviderAccountRegistry({ dataRoot: dir, store: makeFakeStore() });
      const unknownId = "acct_remove_missing";
      await assert.rejects(
        () => reg.remove(unknownId),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            (err as Error).message.includes(unknownId),
            `error must name id "${unknownId}"`,
          );
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
