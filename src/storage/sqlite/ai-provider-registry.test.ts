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
import { UnknownReferenceError } from "../../domain/errors.ts";

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

// ── 008.2 Story A — project assignment store ─────────────────────────────────

test("SqliteAiProviderRegistry: assign two providers at ranks 0 and 1, listAssigned returns rank order, maxRank returns 1", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const projectId = "test-proj";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projectId,
    "Test",
  );

  const p1 = registry.register({
    name: "assign-alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-1",
  });
  const p2 = registry.register({
    name: "assign-beta",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    value: "sk-2",
  });

  registry.assign(projectId, p1.id, 0);
  registry.assign(projectId, p2.id, 1);

  const assigned = registry.listAssigned(projectId);
  assert.equal(assigned.length, 2);
  assert.equal(assigned[0]!.id, p1.id);
  assert.equal(assigned[1]!.id, p2.id);
  assert.equal(registry.maxRank(projectId), 1);
});

test("SqliteAiProviderRegistry: duplicate assign (same projectId, providerId) throws", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const projectId = "test-proj-dup";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projectId,
    "Test",
  );
  const p1 = registry.register({
    name: "dup-alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-1",
  });

  registry.assign(projectId, p1.id, 0);
  assert.throws(() => registry.assign(projectId, p1.id, 1));
});

test("SqliteAiProviderRegistry: two assigns with the same rank throws UNIQUE constraint", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const projectId = "test-proj-rank";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projectId,
    "Test",
  );
  const p1 = registry.register({
    name: "runk-alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-1",
  });
  const p2 = registry.register({
    name: "runk-beta",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    value: "sk-2",
  });

  registry.assign(projectId, p1.id, 0);
  assert.throws(() => registry.assign(projectId, p2.id, 0));
});

test("SqliteAiProviderRegistry: shiftRanksFrom then insert at 0 keeps order total; compactRanks turns gaps into contiguous", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const projectId = "test-proj-shift";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projectId,
    "Test",
  );
  const p1 = registry.register({
    name: "shift-alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-1",
  });
  const p2 = registry.register({
    name: "shift-beta",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    value: "sk-2",
  });
  const p3 = registry.register({
    name: "shift-gamma",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    value: "sk-3",
  });

  registry.assign(projectId, p1.id, 1);
  registry.assign(projectId, p2.id, 2);

  registry.shiftRanksFrom(projectId, 0);
  registry.assign(projectId, p3.id, 0);

  let assigned = registry.listAssigned(projectId);
  assert.equal(assigned.length, 3);
  assert.equal(assigned[0]!.id, p3.id);
  assert.equal(assigned[1]!.id, p1.id);
  assert.equal(assigned[2]!.id, p2.id);

  // compactRanks: insert at ranks 0,2,5 and compress to 0,1,2
  const projectId2 = "test-proj-compact";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projectId2,
    "Compact",
  );
  const p4 = registry.register({
    name: "compact-a",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-4",
  });
  const p5 = registry.register({
    name: "compact-b",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    value: "sk-5",
  });
  const p6 = registry.register({
    name: "compact-c",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    value: "sk-6",
  });

  registry.assign(projectId2, p4.id, 0);
  registry.assign(projectId2, p5.id, 2);
  registry.assign(projectId2, p6.id, 5);

  registry.compactRanks(projectId2);

  const compacted = registry.listAssigned(projectId2);
  assert.equal(compacted.length, 3);
  assert.equal(compacted[0]!.id, p4.id);
  assert.equal(compacted[1]!.id, p5.id);
  assert.equal(compacted[2]!.id, p6.id);
  assert.equal(registry.maxRank(projectId2), 2);
});

test("SqliteAiProviderRegistry: unassign removes one; getAssignment undefined after", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const projectId = "test-proj-unassign";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projectId,
    "Test",
  );
  const p1 = registry.register({
    name: "unassign-alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-1",
  });

  registry.assign(projectId, p1.id, 0);

  const before = registry.getAssignment(projectId, p1.id);
  assert.notEqual(before, undefined);
  assert.equal(before!.rank, 0);

  registry.unassign(projectId, p1.id);

  const assignmentAfter = registry.getAssignment(projectId, p1.id);
  assert.equal(assignmentAfter, undefined);
});

test("SqliteAiProviderRegistry: listProjectsAssigning returns every project that assigns a provider", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const projA = "proj-list-a";
  const projB = "proj-list-b";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projA,
    "Project A",
  );
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projB,
    "Project B",
  );

  const p1 = registry.register({
    name: "list-alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-1",
  });
  const p2 = registry.register({
    name: "list-beta",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    value: "sk-2",
  });

  registry.assign(projA, p1.id, 0);
  registry.assign(projA, p2.id, 1);
  registry.assign(projB, p1.id, 0);

  const assigningP1 = registry.listProjectsAssigning(p1.id);
  assert.equal(assigningP1.length, 2);
  assert.ok(assigningP1.includes(projA));
  assert.ok(assigningP1.includes(projB));

  const assigningP2 = registry.listProjectsAssigning(p2.id);
  assert.deepEqual(assigningP2, [projA]);
});

// ── 008.1 — custom openai-compatible provider tests ──────────────────────────

test("SqliteAiProviderRegistry: custom record with api/contextWindow/maxTokens round-trips", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "custom-qwen",
    provider: "qwen-token-plan",
    model: "qwen-max",
    baseUrl: "https://custom.api.com",
    api: "openai-completions",
    contextWindow: 32768,
    maxTokens: 4096,
    value: "sk-custom-key",
  });

  const loaded = registry.get(record.id)!;
  assert.equal(loaded.name, "custom-qwen");

  assert.equal(loaded.api, "openai-completions");
  assert.equal(loaded.contextWindow, 32768);
  assert.equal(loaded.maxTokens, 4096);
});

test("SqliteAiProviderRegistry: builtin record has null for custom fields", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = registry.register({
    name: "builtin",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });

  const loaded = registry.get(record.id)!;
  assert.equal(loaded.name, "builtin");

  assert.equal(loaded.api, null);
  assert.equal(loaded.contextWindow, null);
  assert.equal(loaded.maxTokens, null);
});

// ── e2e 20260727-124515 B2 — every read method returns the full record ──
//
// listAssigned shipped a 9-column SELECT against a 12-field contract, so `api`
// read back undefined and the daemon's custom-provider branch never fired. The
// per-method round-trips above only covered `get`, which is why the gap
// survived. This asserts the whole record through EVERY public read path, so a
// new query that omits a column cannot pass.

test("SqliteAiProviderRegistry: get/list/getDefault/listAssigned each return all 12 fields of a custom record", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const projectId = "full-fields-proj";
  db.prepare("INSERT INTO projects(id, name) VALUES (?, ?)").run(
    projectId,
    "Full Fields",
  );

  const record = registry.register({
    name: "custom-full",
    provider: "e2e-custom",
    model: "deepseek-v4-flash",
    baseUrl: "https://custom.api.com/v1",
    effort: "high",
    api: "openai-completions",
    contextWindow: 131072,
    maxTokens: 8192,
    value: "sk-custom-key",
  });
  registry.assign(projectId, record.id, 0);
  registry.setDefault(record.id);

  const expected = {
    id: record.id,
    name: "custom-full",
    provider: "e2e-custom",
    model: "deepseek-v4-flash",
    baseUrl: "https://custom.api.com/v1",
    effort: "high",
    value: "sk-custom-key",
    state: "active",
    credentialVersion: record.credentialVersion,
    api: "openai-completions",
    contextWindow: 131072,
    maxTokens: 8192,
  };

  const byReadMethod = {
    get: registry.get(record.id),
    list: registry.list().find((p) => p.id === record.id),
    getDefault: registry.getDefault(),
    listAssigned: registry
      .listAssigned(projectId)
      .find((p) => p.id === record.id),
  };

  for (const [method, loaded] of Object.entries(byReadMethod)) {
    assert.ok(loaded !== undefined, `${method} returned the record`);
    assert.deepEqual(
      { ...loaded },
      expected,
      `${method} returns every field — a dropped column shows up here`,
    );
  }
});

// ── BLOCKER 4 — updateCredentialCAS discriminated result ──

test("(BLOCKER 4) SqliteAiProviderRegistry: updateCredentialCAS applies successfully and bumps version", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const p = registry.register({
    name: "cas-applied",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-old",
  });

  const result = registry.updateCredentialCAS(
    p.id,
    "sk-new",
    p.credentialVersion,
  );
  assert.deepEqual(
    result,
    { applied: true, newVersion: p.credentialVersion + 1 },
    "updateCredentialCAS with correct version must return {applied:true, newVersion}",
  );
  const stored = registry.get(p.id)!;
  assert.equal(stored.value, "sk-new", "value must be updated");
  assert.equal(
    stored.credentialVersion,
    p.credentialVersion + 1,
    "credentialVersion must bump by 1",
  );
});

test("(BLOCKER 4) SqliteAiProviderRegistry: updateCredentialCAS stale version returns {applied:false}", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const p = registry.register({
    name: "cas-stale",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-old",
  });

  const result = registry.updateCredentialCAS(p.id, "sk-new", 999);
  assert.deepEqual(
    result,
    { applied: false },
    "stale version must return {applied:false}",
  );

  const stored = registry.get(p.id)!;
  assert.equal(
    stored.value,
    "sk-old",
    "value must not be updated on stale CAS",
  );
  assert.equal(
    stored.credentialVersion,
    p.credentialVersion,
    "credentialVersion must not change on stale CAS",
  );
});

test("(BLOCKER 4) SqliteAiProviderRegistry: updateCredentialCAS logged_out returns {applied:false}", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const p = registry.register({
    name: "cas-loggedout",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-old",
  });
  registry.logout(p.id);

  const result = registry.updateCredentialCAS(
    p.id,
    "sk-new",
    p.credentialVersion,
  );
  assert.deepEqual(
    result,
    { applied: false },
    "logged_out provider must return {applied:false}",
  );
});

// ── 018 Story S2 — AiProviderRegistry.update (config columns only) ──

test("SqliteAiProviderRegistry: update with a single-key patch changes only that column", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const created = registry.register({
    name: "update-single",
    provider: "openai-codex",
    model: "model-old",
    value: "sk-secret",
  });

  const updated = registry.update(created.id, { model: "model-new" });

  assert.equal(updated.model, "model-new");
  assert.equal(updated.id, created.id);
  assert.equal(updated.name, created.name);
  assert.equal(updated.provider, created.provider);
  assert.equal(updated.value, created.value);
  assert.equal(updated.state, created.state);
  assert.equal(updated.credentialVersion, created.credentialVersion);
});

test("SqliteAiProviderRegistry: update with a multi-key patch writes all five config columns", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const created = registry.register({
    name: "update-multi",
    provider: "custom-vendor",
    model: "model-a",
    baseUrl: "https://old.example.com",
    effort: "low",
    api: "openai-completions",
    contextWindow: 1000,
    maxTokens: 100,
    value: "sk-secret",
  });

  const updated = registry.update(created.id, {
    baseUrl: "https://new.example.com",
    effort: "high",
    api: "openai-responses",
    contextWindow: 2000,
    maxTokens: 200,
  });

  assert.equal(updated.baseUrl, "https://new.example.com");
  assert.equal(updated.effort, "high");
  assert.equal(updated.api, "openai-responses");
  assert.equal(updated.contextWindow, 2000);
  assert.equal(updated.maxTokens, 200);
});

test("SqliteAiProviderRegistry: update with an empty patch issues no UPDATE and returns the current row", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const created = registry.register({
    name: "update-empty",
    provider: "openai-codex",
    model: "model-x",
    value: "sk-secret",
  });

  const result = registry.update(created.id, {});

  assert.deepEqual(result, created);
});

test("SqliteAiProviderRegistry: update on an unknown id throws UnknownReferenceError", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.throws(() => {
    registry.update("nonexistent-id", { model: "model-new" });
  }, UnknownReferenceError);
});

// BLOCKER S1 (review 20260729): an unknown id plus an EMPTY patch must also
// throw UnknownReferenceError — the port doc says "Throws UnknownReferenceError
// when no row has that id" with no carve-out for an empty patch. The current
// adapter short-circuits on an empty patch via `this.get(id)!` before any
// existence check, so it returns `undefined` (unsafely cast to
// GlobalAiProvider) instead of throwing.
test("SqliteAiProviderRegistry: update on an unknown id with an EMPTY patch still throws UnknownReferenceError", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.throws(() => {
    registry.update("nonexistent-id", {});
  }, UnknownReferenceError);
});

test("SqliteAiProviderRegistry: update keeps the row's id stable and list() still returns exactly one row", () => {
  const { db, dir, registry } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const created = registry.register({
    name: "update-id-stable",
    provider: "openai-codex",
    model: "model-x",
    value: "sk-secret",
  });

  registry.update(created.id, { model: "model-y" });

  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, created.id);
});
