import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCommitterIdentity,
  saveCommitterIdentity,
  resolveCommitterIdentity,
} from "./committer-identity.ts";

// suite: src/config/committer-identity.ts

test("loadCommitterIdentity returns undefined when no file exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "committer-test-"));
  try {
    const result = await loadCommitterIdentity(dir);
    assert.strictEqual(result, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveCommitterIdentity + loadCommitterIdentity round-trips name and email", async () => {
  const dir = await mkdtemp(join(tmpdir(), "committer-test-"));
  try {
    await saveCommitterIdentity(dir, {
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    const result = await loadCommitterIdentity(dir);
    assert.deepStrictEqual(result, {
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveCommitterIdentity returns slot committer when slot and global both present", () => {
  const slotCommitter = { name: "Slot User", email: "slot@example.com" };
  const globalIdentity = { name: "Global User", email: "global@example.com" };
  const result = resolveCommitterIdentity({ slotCommitter, globalIdentity });
  assert.deepStrictEqual(result, slotCommitter);
});

test("resolveCommitterIdentity returns global identity when slot committer is absent", () => {
  const globalIdentity = { name: "Global User", email: "global@example.com" };
  const result = resolveCommitterIdentity({
    slotCommitter: undefined,
    globalIdentity,
  });
  assert.deepStrictEqual(result, globalIdentity);
});

test("resolveCommitterIdentity returns undefined when neither slot nor global is set", () => {
  const result = resolveCommitterIdentity({
    slotCommitter: undefined,
    globalIdentity: undefined,
  });
  assert.strictEqual(result, undefined);
});

test("loadCommitterIdentity round-trips unicode name unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "committer-test-"));
  try {
    await saveCommitterIdentity(dir, {
      name: "Björn Ångström",
      email: "bjorn@example.com",
    });
    const result = await loadCommitterIdentity(dir);
    assert.deepStrictEqual(result, {
      name: "Björn Ångström",
      email: "bjorn@example.com",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
