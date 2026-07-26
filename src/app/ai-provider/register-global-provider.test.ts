/**
 * RegisterGlobalProvider — shared registry-insert helper (008.3 Story E).
 *
 * BLOCKER 3 (phantom-id): the function must return the registry's generated id,
 * not the injected params.id. Tests verify the return value and add an
 * integration test against real SQLite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../storage/sqlite/open.ts";
import { registerGlobalProvider } from "./register-global-provider.ts";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  UnitOfWork,
} from "../../storage/port.ts";
import { SqliteAiProviderRegistry } from "../../storage/sqlite/ai-provider-registry.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";

const UOW: UnitOfWork = {
  transaction: <T>(fn: () => T) => fn(),
};

function makeFakeRegistry(): {
  registry: AiProviderRegistry;
  lastInput: Record<string, unknown> | undefined;
} {
  let lastInput: Record<string, unknown> | undefined;
  return {
    registry: {
      register(input: Record<string, unknown>) {
        lastInput = { ...input };
        return {
          id: "reg-generated-id",
          name: input.name as string,
          provider: input.provider as string,
          model: input.model as string,
          baseUrl: (input.baseUrl as string) ?? null,
          effort: (input.effort as string) ?? null,
          value: input.value as string,
          state: "active",
          credentialVersion: 1,
          api: null,
          contextWindow: null,
          maxTokens: null,
        } as GlobalAiProvider;
      },
      list: () => [],
      get: () => undefined,
      getDefault: () => undefined,
      setDefault: () => {},
      clearDefault: () => {},
      logout: () => {},
      remove: () => {},
      updateCredentialCAS: () => ({ applied: false as const }),
      assign: () => {},
      unassign: () => {},
      listAssigned: () => [],
      maxRank: () => undefined,
      shiftRanksFrom: () => {},
      compactRanks: () => {},
      getAssignment: () => undefined,
      listProjectsAssigning: () => [],
    } as AiProviderRegistry,
    get lastInput() {
      return lastInput;
    },
  };
}

test("(BLOCKER 3) registerGlobalProvider returns the registry-generated id", () => {
  const { registry } = makeFakeRegistry();

  const result = registerGlobalProvider(registry, {
    name: "phantom-test",
    provider: "opencode",
    model: "big-pickle",
    value: "test-key",
  });

  assert.equal(
    result,
    "reg-generated-id",
    "must return the id from registry.register",
  );
});

test("(BLOCKER 3 integration) registerGlobalProvider with real SQLite registry returns retrievable id", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-0083-phantom-"));
  const dbPath = join(dir, "test.db");
  try {
    const db = openDatabase(dbPath);
    migrate(db, MIGRATIONS);
    const registry: AiProviderRegistry = new SqliteAiProviderRegistry(db);

    const result = registerGlobalProvider(registry, {
      name: "phantom-integration",
      provider: "opencode",
      model: "big-pickle",
      value: "test-api-key",
    });

    assert.ok(
      result.startsWith("01"),
      `returned id must be a valid ULID (starts with "01"), got: ${result}`,
    );

    const saved = registry.get(result);
    assert.ok(
      saved,
      "registered provider must be retrievable by the returned id",
    );
    assert.equal(saved!.name, "phantom-integration");

    // BLOCKER 8: after register on fresh DB, the default must resolve to the
    // registered provider (first-wins convention in registerGlobalProvider).
    const defaultProvider = registry.getDefault();
    assert.ok(
      defaultProvider,
      "registerGlobalProvider on fresh DB must set a resolvable default",
    );
    assert.equal(
      defaultProvider!.id,
      result,
      "the default provider must be the same as the registered one",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
