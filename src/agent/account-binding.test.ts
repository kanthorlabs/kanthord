/**
 * src/agent/account-binding.test.ts
 *
 * Story 003 Task T3 — durable per-task account binding survives respawn + restart.
 *
 * Tests the `AccountBindingStore` and `resolveOrBindAccount` seams from
 * `src/agent/account-binding.ts`. All assertions use durable state (a temp dir);
 * no real model or network calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// This import will fail ERR_MODULE_NOT_FOUND until the SE creates the module.
import {
  createAccountBindingStore,
  resolveOrBindAccount,
} from "./account-binding.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kanthord-account-binding-"));
}

async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// AccountBindingStore — CRUD and durability
// ---------------------------------------------------------------------------

test(
  "T3 — write then read on same store instance returns the binding",
  async () => {
    const dir = await makeTempDir();
    try {
      const store = createAccountBindingStore({ dataRoot: dir });
      await store.write("task-001", {
        accountId: "acct_aaa",
        modelId: "gpt-4o",
        boundAt: new Date().toISOString(),
      });
      const result = await store.read("task-001");
      assert.ok(result !== undefined, "read must return the written binding");
      assert.strictEqual(result.accountId, "acct_aaa");
      assert.strictEqual(result.modelId, "gpt-4o");
    } finally {
      await cleanupTempDir(dir);
    }
  },
);

test(
  "T3 — read on fresh store instance (same dir) returns the binding — simulated daemon restart",
  async () => {
    const dir = await makeTempDir();
    try {
      // First instance: write binding (simulates first spawn)
      const store1 = createAccountBindingStore({ dataRoot: dir });
      await store1.write("task-001", {
        accountId: "acct_bbb",
        modelId: "gpt-4o",
        boundAt: new Date().toISOString(),
      });

      // Second instance with same dir (simulates daemon restart)
      const store2 = createAccountBindingStore({ dataRoot: dir });
      const result = await store2.read("task-001");
      assert.ok(
        result !== undefined,
        "fresh store instance must read binding from durable store",
      );
      assert.strictEqual(
        result.accountId,
        "acct_bbb",
        "account id must match across restart",
      );
      assert.strictEqual(
        result.modelId,
        "gpt-4o",
        "model id must match across restart",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  },
);

test(
  "T3 — read for unknown taskId returns undefined",
  async () => {
    const dir = await makeTempDir();
    try {
      const store = createAccountBindingStore({ dataRoot: dir });
      const result = await store.read("task-does-not-exist");
      assert.strictEqual(
        result,
        undefined,
        "read for unknown taskId must return undefined",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  },
);

test(
  "T3 — write is idempotent: subsequent write for same task overwrites binding",
  async () => {
    const dir = await makeTempDir();
    try {
      const store = createAccountBindingStore({ dataRoot: dir });
      await store.write("task-001", {
        accountId: "acct_old",
        modelId: "gpt-4o",
        boundAt: new Date().toISOString(),
      });
      await store.write("task-001", {
        accountId: "acct_new",
        modelId: "gpt-4o-mini",
        boundAt: new Date().toISOString(),
      });
      const result = await store.read("task-001");
      assert.ok(result !== undefined);
      assert.strictEqual(result.accountId, "acct_new");
      assert.strictEqual(result.modelId, "gpt-4o-mini");
    } finally {
      await cleanupTempDir(dir);
    }
  },
);

// ---------------------------------------------------------------------------
// resolveOrBindAccount — spawn / respawn / restart all resolve same account
// ---------------------------------------------------------------------------

test(
  "T3 — spawn, respawn, and restart resolve the same account from the durable binding",
  async () => {
    const dir = await makeTempDir();
    try {
      const store = createAccountBindingStore({ dataRoot: dir });

      // First spawn: no existing binding; slotAccountId provided → writes and returns
      const firstSpawn = await resolveOrBindAccount({
        taskId: "task-002",
        store,
        slotAccountId: "acct_ccc",
        modelId: "gpt-4o",
      });
      assert.strictEqual(firstSpawn.accountId, "acct_ccc");
      assert.strictEqual(firstSpawn.modelId, "gpt-4o");

      // Second spawn (same store): binding exists → returns same account
      const secondSpawn = await resolveOrBindAccount({
        taskId: "task-002",
        store,
        slotAccountId: "acct_different", // ignored because binding already exists
        modelId: "gpt-4o",
      });
      assert.strictEqual(
        secondSpawn.accountId,
        "acct_ccc",
        "second spawn must resolve same account from binding, not override",
      );

      // Respawn (new store instance, same dir — simulates daemon restart)
      const storeAfterRestart = createAccountBindingStore({ dataRoot: dir });
      const spawnAfterRestart = await resolveOrBindAccount({
        taskId: "task-002",
        store: storeAfterRestart,
        slotAccountId: "acct_different", // ignored — binding on disk takes precedence
        modelId: "gpt-4o",
      });
      assert.strictEqual(
        spawnAfterRestart.accountId,
        "acct_ccc",
        "spawn after simulated restart must resolve same account from durable store",
      );
    } finally {
      await cleanupTempDir(dir);
    }
  },
);

test(
  "T3 — no existing binding + defaultAccountId → writes binding and returns it",
  async () => {
    const dir = await makeTempDir();
    try {
      const store = createAccountBindingStore({ dataRoot: dir });
      const result = await resolveOrBindAccount({
        taskId: "task-003",
        store,
        defaultAccountId: "acct_default",
        modelId: "gpt-4o",
      });
      assert.strictEqual(result.accountId, "acct_default");

      // Confirm written to durable store
      const persisted = await store.read("task-003");
      assert.ok(persisted !== undefined);
      assert.strictEqual(persisted.accountId, "acct_default");
    } finally {
      await cleanupTempDir(dir);
    }
  },
);

test(
  "T3 — no existing binding + no slotAccountId + no defaultAccountId → typed error",
  async () => {
    const dir = await makeTempDir();
    try {
      const store = createAccountBindingStore({ dataRoot: dir });
      await assert.rejects(
        () =>
          resolveOrBindAccount({
            taskId: "task-no-account",
            store,
            modelId: "gpt-4o",
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error, "must throw an Error");
          assert.ok(
            err.message.includes("no account"),
            `error message must mention 'no account'; got: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await cleanupTempDir(dir);
    }
  },
);
