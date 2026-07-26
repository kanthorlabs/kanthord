// src/storage/sqlite/ai-provider-registry.test.ts — SqliteAiProviderRegistry
// (008.1 Story A: global ai_providers store + default pointer).
// Renamed to 7-domain-method surface per Story A spec (S12 Option a).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "./open.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./migrations.ts";
import { SqliteAiProviderRegistry } from "./ai-provider-registry.ts";

function makeTempDb() {
  const dir = mkdtempSync(
    join(tmpdir(), "kanthord-ai-provider-registry-test-"),
  );
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir, registry: new SqliteAiProviderRegistry(db) };
}

test("SqliteAiProviderRegistry: register returns a ULID-format id matching the EPIC Proof regex", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "test",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-test",
  });

  // ULID format: 26 chars starting with "01" (timestamp component), Crockford base32
  assert.equal(
    record.id.length,
    26,
    "ULID is 26 characters; UUIDs are 36 characters with hyphens",
  );
  assert.ok(
    record.id.startsWith("01"),
    "ULID starts with 01 timestamp component",
  );
  assert.match(
    record.id,
    /^01[0-9A-HJKMNP-TV-Z]{24}$/,
    "id matches ULID regex pattern from EPIC Proof grep",
  );
});

test("SqliteAiProviderRegistry: register then get round-trips a full GlobalAiProvider", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    baseUrl: "https://custom.api.com",
    effort: "high",
    value: "sk-secret",
  });

  assert.ok(record.id);
  assert.equal(record.name, "alpha");
  assert.equal(record.provider, "openai-codex");
  assert.equal(record.model, "gpt-5.6-terra");
  assert.equal(record.baseUrl, "https://custom.api.com");
  assert.equal(record.effort, "high");
  assert.equal(record.value, "sk-secret");
  assert.equal(record.state, "active");
  assert.equal(record.credentialVersion, 1);

  // get round-trips the same record
  const loaded = registry.get(record.id);
  assert.deepEqual(loaded, record);
});

test("SqliteAiProviderRegistry: register with only required fields stores null for optional fields", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });

  assert.equal(record.baseUrl, null);
  assert.equal(record.effort, null);
});

test("SqliteAiProviderRegistry: register with name of logged_out provider reactivates it", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const p1 = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });
  registry.logout(p1.id);

  const p2 = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-new-secret",
  });

  // Reactivation reuses the same record (same id)
  assert.equal(p2.id, p1.id);
  assert.equal(p2.state, "active");
  assert.equal(p2.value, "sk-new-secret");
  assert.equal(
    p2.credentialVersion,
    3,
    "reactivation bumps credentialVersion (logout + reactivation = 2 bumps)",
  );
});

test("SqliteAiProviderRegistry: list returns all registered providers", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record1 = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret-1",
  });
  const record2 = registry.register({
    name: "beta",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    baseUrl: "https://custom.api.com",
    effort: "high",
    value: "sk-secret-2",
  });

  const all = registry.list();
  assert.equal(all.length, 2);
  assert.deepEqual(
    all.find((p) => p.id === record1.id),
    record1,
  );
  assert.deepEqual(
    all.find((p) => p.id === record2.id),
    record2,
  );
});

test("SqliteAiProviderRegistry: getDefault returns first registered provider; setDefault flips it", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const p1 = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret-1",
  });

  // First provider does NOT auto-become the default at adapter level
  // (the use case RegisterAiProvider handles the first-wins convention)
  assert.equal(
    registry.getDefault(),
    undefined,
    "register() does not auto-set default",
  );

  // Explicitly set the default pointer (as the use case would)
  registry.setDefault(p1.id);
  assert.deepEqual(registry.getDefault(), p1);

  const p2 = registry.register({
    name: "beta",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    value: "sk-secret-2",
  });

  // Second provider does NOT change the default (first-wins)
  assert.deepEqual(registry.getDefault(), p1);

  // setDefault flips to p2
  registry.setDefault(p2.id);
  assert.deepEqual(registry.getDefault(), p2);
});

test("SqliteAiProviderRegistry: logout flips state to logged_out and clears value, bumps version", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });

  registry.logout(record.id);

  const afterLogout = registry.get(record.id);
  assert.equal(afterLogout?.state, "logged_out");
  assert.equal(afterLogout?.value, null);
  assert.equal(
    afterLogout?.credentialVersion,
    record.credentialVersion + 1,
    "logout bumps credentialVersion",
  );
});

test("SqliteAiProviderRegistry: logout clears the raw value column (B1 regression)", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });

  registry.logout(record.id);

  // Read the raw value column directly, bypassing the registry.get() method
  const row = db
    .prepare("SELECT value FROM ai_providers WHERE id = ?")
    .get(record.id) as { value: string | null } | undefined;
  // After logout the secret must be nulled/blanked, never preserved in the clear
  assert.notEqual(row, undefined);
  assert.equal(row!.value, null);
});

test("SqliteAiProviderRegistry: clearDefault empties the pointer while provider rows survive", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });
  registry.setDefault(record.id);
  assert.equal(registry.getDefault()?.id, record.id);

  registry.clearDefault();

  assert.equal(registry.getDefault(), undefined);
  assert.notEqual(registry.get(record.id), undefined, "provider row survives");
});

test("SqliteAiProviderRegistry: clearDefault on an already-empty pointer is a no-op, not an error", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(registry.getDefault(), undefined);
  assert.doesNotThrow(() => registry.clearDefault());
  assert.equal(registry.getDefault(), undefined);
});

test("SqliteAiProviderRegistry: remove deletes the record", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });

  assert.notEqual(registry.get(record.id), undefined);

  registry.remove(record.id);
  assert.equal(registry.get(record.id), undefined);
});

test("SqliteAiProviderRegistry: remove of the current default deletes the ai_provider_default row (B1 regression)", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });
  registry.setDefault(record.id);

  // Read the raw pointer table directly, bypassing the registry.getDefault() method
  const before = db.prepare("SELECT * FROM ai_provider_default").get() as
    { id: number; providerId: string } | undefined;
  assert.notEqual(before, undefined, "pointer row exists before remove");
  assert.equal(before!.providerId, record.id);

  registry.remove(record.id);

  const after_ = db.prepare("SELECT * FROM ai_provider_default").get() as
    { id: number; providerId: string } | undefined;
  assert.equal(
    after_,
    undefined,
    "pointer row must be gone after removing the default",
  );
});
