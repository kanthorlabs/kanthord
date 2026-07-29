// src/app/ai-provider/update-ai-provider.test.ts — UpdateAiProvider use case
// (018 S3: edit a registered provider's config + optional secret rotation).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  UnitOfWork,
} from "../../storage/port.ts";
import { UpdateAiProvider } from "./update-ai-provider.ts";
import { UnknownReferenceError, UnknownModelError } from "../errors.ts";
import {
  LoggedOutProviderError,
  InvalidNumericFlagError,
  EmptyValueError,
  UnknownProviderError,
  InvalidEffortError,
  NoUpdateFieldsError,
  BuiltinProviderFieldError,
  StaleCredentialError,
} from "./errors.ts";
import { FakeModelCatalog } from "../../model-catalog/fake.ts";
import { openDatabase } from "../../storage/sqlite/open.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";
import { SqliteAiProviderRegistry } from "../../storage/sqlite/ai-provider-registry.ts";
import { SqliteUnitOfWork } from "../../storage/sqlite/sqlite-unit-of-work.ts";

// ------------------------------------------------------------------ fakes

type CasResult = { applied: true; newVersion: number } | { applied: false };

class FakeRegistry implements AiProviderRegistry {
  readonly #store = new Map<string, GlobalAiProvider>();
  readonly calls: string[] = [];
  #casResult: CasResult | undefined;

  seed(p: GlobalAiProvider): void {
    this.#store.set(p.id, p);
  }

  setCasResult(r: CasResult): void {
    this.#casResult = r;
  }

  register(): GlobalAiProvider {
    throw new Error("not used in this test");
  }

  update(
    id: string,
    patch: {
      model?: string;
      baseUrl?: string;
      effort?: string;
      api?: "openai-completions" | "openai-responses";
      contextWindow?: number;
      maxTokens?: number;
    },
  ): GlobalAiProvider {
    this.calls.push(`update:${JSON.stringify(patch)}`);
    const current = this.#store.get(id);
    if (current === undefined)
      throw new UnknownReferenceError("ai_provider", id);
    const merged: GlobalAiProvider = { ...current, ...patch };
    this.#store.set(id, merged);
    return { ...merged };
  }

  get(id: string): GlobalAiProvider | undefined {
    this.calls.push(`get:${id}`);
    return this.#store.get(id);
  }

  list(): GlobalAiProvider[] {
    return Array.from(this.#store.values()).map((p) => ({ ...p }));
  }

  getDefault(): GlobalAiProvider | undefined {
    return undefined;
  }
  setDefault(_id: string): void {}
  clearDefault(): void {}
  logout(_id: string): void {}
  remove(_id: string): void {}

  updateCredentialCAS(
    id: string,
    value: string,
    expectedVersion: number,
  ): CasResult {
    this.calls.push(`updateCredentialCAS:${id},${value},${expectedVersion}`);
    return (
      this.#casResult ?? { applied: true, newVersion: expectedVersion + 1 }
    );
  }

  // ── 008.2 project→provider assignment — not exercised by this test ──
  assign(_projectId: string, _providerId: string, _rank: number): void {}
  unassign(_projectId: string, _providerId: string): void {}
  listAssigned(_projectId: string): GlobalAiProvider[] {
    return [];
  }
  maxRank(_projectId: string): number | undefined {
    return undefined;
  }
  shiftRanksFrom(_projectId: string, _rank: number): void {}
  compactRanks(_projectId: string): void {}
  getAssignment(
    _projectId: string,
    _providerId: string,
  ): { rank: number } | undefined {
    return undefined;
  }
  listProjectsAssigning(_providerId: string): string[] {
    return [];
  }
}

class FakeUnitOfWork implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

/** Records whether the wrapped body threw — used for the atomicity test. */
class RecordingUnitOfWork implements UnitOfWork {
  bodyThrew = false;
  transaction<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      this.bodyThrew = true;
      throw err;
    }
  }
}

// -------------------------------------------------------- helpers

function customRow(
  overrides: Partial<GlobalAiProvider> = {},
): GlobalAiProvider {
  return {
    id: "cust-1",
    name: "custom-one",
    provider: "custom-one",
    model: "qwen-max",
    baseUrl: "https://api.example.com/v1",
    effort: null,
    value: "sk-old",
    state: "active",
    credentialVersion: 1,
    api: "openai-completions",
    contextWindow: 32768,
    maxTokens: 4096,
    ...overrides,
  };
}

function builtinRow(
  overrides: Partial<GlobalAiProvider> = {},
): GlobalAiProvider {
  return {
    id: "built-1",
    name: "codex-one",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    baseUrl: null,
    effort: null,
    value: "sk-old",
    state: "active",
    credentialVersion: 1,
    api: null,
    contextWindow: null,
    maxTokens: null,
    ...overrides,
  };
}

// -------------------------------------------------------- tests

test("UpdateAiProvider: no fields throws NoUpdateFieldsError with zero registry calls", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(() => uc.execute({ id: "cust-1" }), NoUpdateFieldsError);
  assert.deepEqual(
    registry.calls,
    [],
    "no get/update/updateCredentialCAS calls before the check",
  );
});

test("UpdateAiProvider: unknown id throws UnknownReferenceError", () => {
  const registry = new FakeRegistry();
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "missing", model: "x" }),
    UnknownReferenceError,
  );
});

test("UpdateAiProvider: logged_out row throws LoggedOutProviderError with zero writes", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow({ state: "logged_out" }));
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "cust-1", model: "new-model" }),
    LoggedOutProviderError,
  );
  assert.ok(
    !registry.calls.some(
      (c) => c.startsWith("update:") || c.startsWith("updateCredentialCAS:"),
    ),
    "no writes on logged_out refusal",
  );
});

test("UpdateAiProvider: custom row — a valid {model} patch calls registry.update once with exactly {model}", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  uc.execute({ id: "cust-1", model: "new-model" });

  const updateCalls = registry.calls.filter((c) => c.startsWith("update:"));
  assert.equal(updateCalls.length, 1);
  assert.equal(
    updateCalls[0],
    `update:${JSON.stringify({ model: "new-model" })}`,
  );
});

test("UpdateAiProvider: custom row — invalid --context-window 0 throws InvalidNumericFlagError and calls update zero times", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "cust-1", contextWindow: 0 }),
    InvalidNumericFlagError,
  );
  assert.equal(registry.calls.filter((c) => c.startsWith("update:")).length, 0);
});

test("UpdateAiProvider: custom row never consults the catalog", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  const throwingCatalog = {
    isValid(): boolean {
      throw new Error("catalog must not be consulted for a custom row");
    },
    hasProvider(): boolean {
      throw new Error("catalog must not be consulted for a custom row");
    },
    getEfforts(): string[] {
      throw new Error("catalog must not be consulted for a custom row");
    },
  };
  const uc = new UpdateAiProvider(
    registry,
    new FakeUnitOfWork(),
    throwingCatalog,
  );

  uc.execute({ id: "cust-1", model: "new-model" });
});

test("UpdateAiProvider: builtin row — api alone throws BuiltinProviderFieldError naming 'api'", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "built-1", api: "openai-completions" }),
    (err: unknown) =>
      err instanceof BuiltinProviderFieldError && err.field === "api",
  );
});

test("UpdateAiProvider: builtin row — baseUrl alone throws BuiltinProviderFieldError naming 'baseUrl'", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "built-1", baseUrl: "https://x.example.com" }),
    (err: unknown) =>
      err instanceof BuiltinProviderFieldError && err.field === "baseUrl",
  );
});

test("UpdateAiProvider: builtin row — contextWindow alone throws BuiltinProviderFieldError naming 'contextWindow'", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "built-1", contextWindow: 8192 }),
    (err: unknown) =>
      err instanceof BuiltinProviderFieldError && err.field === "contextWindow",
  );
});

test("UpdateAiProvider: builtin row — maxTokens alone throws BuiltinProviderFieldError naming 'maxTokens'", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "built-1", maxTokens: 1024 }),
    (err: unknown) =>
      err instanceof BuiltinProviderFieldError && err.field === "maxTokens",
  );
});

test("UpdateAiProvider: builtin row — several forbidden fields names 'api' (fixed order)", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () =>
      uc.execute({
        id: "built-1",
        maxTokens: 1024,
        baseUrl: "https://x.example.com",
        api: "openai-completions",
      }),
    (err: unknown) =>
      err instanceof BuiltinProviderFieldError && err.field === "api",
  );
});

test("UpdateAiProvider: builtin row model revalidation — unknown model throws UnknownModelError", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow());
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-sol" },
  ]);
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork(), catalog);

  assert.throws(
    () => uc.execute({ id: "built-1", model: "gpt-unknown" }),
    UnknownModelError,
  );
});

test("UpdateAiProvider: builtin row model revalidation — unknown provider kind throws UnknownProviderError", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow({ provider: "some-unknown-kind" }));
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-sol" },
  ]);
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork(), catalog);

  assert.throws(
    () => uc.execute({ id: "built-1", model: "whatever" }),
    UnknownProviderError,
  );
});

test("UpdateAiProvider: builtin row model revalidation — effort outside getEfforts throws InvalidEffortError", () => {
  const registry = new FakeRegistry();
  registry.seed(builtinRow());
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-sol" },
  ]);
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork(), catalog);

  assert.throws(
    () => uc.execute({ id: "built-1", effort: "not-a-real-effort" }),
    InvalidEffortError,
  );
});

test("UpdateAiProvider: secret rotation — {value} calls updateCredentialCAS once and registry.update zero times", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow({ credentialVersion: 3 }));
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  uc.execute({ id: "cust-1", value: "sk-new" });

  assert.equal(registry.calls.filter((c) => c.startsWith("update:")).length, 0);
  const casCalls = registry.calls.filter((c) =>
    c.startsWith("updateCredentialCAS:"),
  );
  assert.equal(casCalls.length, 1);
  assert.equal(casCalls[0], "updateCredentialCAS:cust-1,sk-new,3");
});

test("UpdateAiProvider: {model, value} calls both, config write before the CAS", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow({ credentialVersion: 5 }));
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  uc.execute({ id: "cust-1", model: "new-model", value: "sk-new" });

  const relevant = registry.calls.filter(
    (c) => c.startsWith("update:") || c.startsWith("updateCredentialCAS:"),
  );
  assert.equal(relevant.length, 2);
  const [first, second] = relevant;
  assert.ok(
    first !== undefined && first.startsWith("update:"),
    "config write happens first",
  );
  assert.ok(
    second !== undefined && second.startsWith("updateCredentialCAS:"),
    "CAS happens second",
  );
});

test("UpdateAiProvider: empty secret throws EmptyValueError", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(() => uc.execute({ id: "cust-1", value: "" }), EmptyValueError);
});

test("UpdateAiProvider: stale CAS ({applied:false}) throws StaleCredentialError", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  registry.setCasResult({ applied: false });
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  assert.throws(
    () => uc.execute({ id: "cust-1", value: "sk-new" }),
    StaleCredentialError,
  );
});

test("UpdateAiProvider: atomicity — invalid --max-tokens with a valid --model leaves registry.update uncalled and the transaction body threw", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  const uow = new RecordingUnitOfWork();
  const uc = new UpdateAiProvider(registry, uow);

  assert.throws(
    () => uc.execute({ id: "cust-1", model: "ok", maxTokens: 0 }),
    InvalidNumericFlagError,
  );
  assert.equal(registry.calls.filter((c) => c.startsWith("update:")).length, 0);
  assert.ok(
    uow.bodyThrew,
    "the transaction body threw — validation precedes every write",
  );
});

test("UpdateAiProvider: changed list order — {maxTokens, model, value} returns changed in fixed field order with value last", () => {
  const registry = new FakeRegistry();
  registry.seed(customRow());
  const uc = new UpdateAiProvider(registry, new FakeUnitOfWork());

  const out = uc.execute({
    id: "cust-1",
    maxTokens: 8192,
    model: "new-model",
    value: "sk-new",
  });

  assert.equal(out.id, "cust-1");
  assert.deepEqual(out.changed, ["model", "maxTokens", "value"]);
});

// BLOCKER B1 (review 20260729): the EPIC gate is explicit — "No new event
// type and no migration … A test asserts the global event count is unchanged
// by an update." UpdateAiProvider never touches the events table (Story S3
// wires no EventFeed), so this drives the real SqliteAiProviderRegistry +
// SqliteUnitOfWork end to end and reads the real `events` table's row count
// directly, before and after a successful update.
test("UpdateAiProvider: a successful update leaves the global events row count unchanged", () => {
  const dir = mkdtempSync(
    join(tmpdir(), "kanthord-update-ai-provider-events-"),
  );
  const dbPath = join(dir, "test.db");
  after(() => rmSync(dir, { recursive: true, force: true }));

  const db = openDatabase(dbPath);
  after(() => db.close());
  migrate(db, MIGRATIONS);

  const registry = new SqliteAiProviderRegistry(db);
  const uow = new SqliteUnitOfWork(db);
  const uc = new UpdateAiProvider(registry, uow);

  const created = registry.register({
    name: "events-unchanged",
    provider: "openai-codex",
    model: "model-old",
    value: "sk-secret",
  });

  const countEvents = (): number =>
    (db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;

  const before = countEvents();
  uc.execute({ id: created.id, model: "model-new" });
  const after_ = countEvents();

  assert.equal(
    after_,
    before,
    "a successful update must append zero rows to the events table",
  );
});
