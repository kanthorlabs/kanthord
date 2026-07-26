// src/app/ai-provider/register-ai-provider.test.ts — RegisterAiProvider
// (008.1 Story B: register use case + transactional first-wins default).

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  UnitOfWork,
} from "../../storage/port.ts";
import { RegisterAiProvider } from "./register-ai-provider.ts";
import { DuplicateNameError, UnknownModelError } from "../errors.ts";
import {
  EmptyValueError,
  InsecureEndpointError,
  InvalidApiFlavorError,
  InvalidBaseUrlError,
  InvalidEffortError,
  MissingBaseUrlError,
  MissingCustomProviderIdError,
  UnknownProviderError,
} from "./errors.ts";
import { EmbeddedCredentialError } from "../errors.ts";
import { FakeModelCatalog } from "../../model-catalog/fake.ts";

// ------------------------------------------------------------------ fakes

class FakeRegistry implements AiProviderRegistry {
  readonly #store = new Map<string, GlobalAiProvider>();
  #defaultId: string | undefined = undefined;

  register(input: {
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    effort?: string;
    value: string;
    api?: "openai-completions" | "openai-responses";
    contextWindow?: number;
    maxTokens?: number;
  }): GlobalAiProvider {
    for (const p of this.#store.values()) {
      if (p.name === input.name) {
        if (p.state === "active") {
          throw new DuplicateNameError("ai_provider", "global", input.name);
        }
        // Reactivate logged_out — keep existing config, update value/state/version
        const updated: GlobalAiProvider = {
          ...p,
          value: input.value,
          state: "active",
          credentialVersion: p.credentialVersion + 1,
        };
        this.#store.set(p.id, updated);
        return { ...updated };
      }
    }
    // New provider
    const id = `fake-${this.#store.size + 1}`;
    const record: GlobalAiProvider = {
      id,
      name: input.name,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? null,
      effort: input.effort ?? null,
      value: input.value,
      state: "active",
      credentialVersion: 1,
      api: input.api ?? null,
      contextWindow: input.contextWindow ?? null,
      maxTokens: input.maxTokens ?? null,
    };
    this.#store.set(id, record);
    return { ...record };
  }

  get(id: string): GlobalAiProvider | undefined {
    return this.#store.get(id);
  }

  list(): GlobalAiProvider[] {
    return Array.from(this.#store.values()).map((p) => ({ ...p }));
  }

  getDefault(): GlobalAiProvider | undefined {
    if (this.#defaultId === undefined) return undefined;
    const p = this.#store.get(this.#defaultId);
    return p ? { ...p } : undefined;
  }

  setDefault(id: string): void {
    this.#defaultId = id;
  }

  logout(id: string): void {
    const p = this.#store.get(id);
    if (p) {
      p.state = "logged_out";
      p.credentialVersion += 1;
      p.value = null;
    }
  }

  remove(_id: string): void {}

  updateCredentialCAS(
    _id: string,
    _value: string,
    _expectedVersion: number,
  ): { applied: true; newVersion: number } | { applied: false } {
    return { applied: false };
  }

  clearDefault(): void {
    this.#defaultId = undefined;
  }

  // 008.2 Story A — project→provider assignment (required by port)
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

// -------------------------------------------------------- helpers + tests

function makeInput(
  overrides: Partial<{
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    effort: string;
    value: string;
  }> = {},
) {
  return {
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret-value",
    ...overrides,
  };
}

test("RegisterAiProvider: first provider creates record and auto-becomes default", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  const input = makeInput();
  const id = uc.execute(input);

  assert.ok(id, "returns an id");

  const stored = registry.get(id);
  assert.ok(stored, "provider is stored in registry");
  assert.equal(stored!.name, "alpha");
  assert.equal(stored!.provider, "openai-codex");
  assert.equal(stored!.model, "gpt-5.6-terra");
  assert.equal(stored!.value, "sk-secret-value");
  assert.equal(stored!.state, "active");
  assert.equal(stored!.credentialVersion, 1);

  assert.equal(
    registry.getDefault()?.id,
    id,
    "first provider is the sole default",
  );
});

test("RegisterAiProvider: second provider does NOT become the default", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  const firstId = uc.execute(makeInput({ name: "alpha" }));
  assert.equal(registry.getDefault()?.id, firstId, "first is default");

  const secondId = uc.execute(
    makeInput({ name: "beta", provider: "openai-codex", model: "gpt-5.6-sol" }),
  );
  assert.ok(secondId, "second returns an id");
  assert.notEqual(secondId, firstId, "different id");

  assert.equal(
    registry.getDefault()?.id,
    firstId,
    "default is still the first provider",
  );
  const second = registry.get(secondId);
  assert.equal(second!.name, "beta");
  assert.equal(second!.state, "active");
});

test("RegisterAiProvider: duplicate name for active provider throws DuplicateNameError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  uc.execute(makeInput({ name: "alpha" }));

  assert.throws(
    () => uc.execute(makeInput({ name: "alpha" })),
    (err: unknown) =>
      err instanceof DuplicateNameError &&
      err.errorName === "alpha" &&
      err.kind === "ai_provider",
  );
});

test("RegisterAiProvider: register name of logged_out provider reactivates it", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  const firstId = uc.execute(makeInput({ name: "alpha", value: "sk-old" }));
  registry.logout(firstId);

  const reactivatedId = uc.execute(
    makeInput({ name: "alpha", value: "sk-new" }),
  );

  assert.equal(
    reactivatedId,
    firstId,
    "reactivation returns the same id (record reused)",
  );

  const stored = registry.get(reactivatedId);
  assert.equal(stored!.name, "alpha");
  assert.equal(stored!.value, "sk-new");
  assert.equal(stored!.state, "active");
  assert.equal(
    stored!.credentialVersion,
    3,
    "credentialVersion is bumped (was 2, now 3)",
  );
});

test("RegisterAiProvider: reactivation keeps name and config unchanged", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  const firstId = uc.execute(
    makeInput({
      name: "alpha",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      baseUrl: "https://original.api.com",
      effort: "low",
      value: "sk-old",
    }),
  );
  registry.logout(firstId);

  // Re-register with same name; different value only.
  uc.execute(makeInput({ name: "alpha", value: "sk-new" }));

  const stored = registry.get(firstId);
  assert.equal(stored!.provider, "openai-codex", "provider unchanged");
  assert.equal(stored!.model, "gpt-5.6-terra", "model unchanged");
  assert.equal(
    stored!.baseUrl,
    "https://original.api.com",
    "baseUrl unchanged",
  );
  assert.equal(stored!.effort, "low", "effort unchanged");
});

test("RegisterAiProvider: optional baseUrl and effort are stored when provided", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  const id = uc.execute(
    makeInput({
      name: "gamma",
      baseUrl: "https://custom.api.com",
      effort: "high",
    }),
  );

  const stored = registry.get(id);
  assert.equal(stored!.baseUrl, "https://custom.api.com");
  assert.equal(stored!.effort, "high");
});

test("RegisterAiProvider: error rolls back the insert (UnitOfWork guard)", () => {
  const registry = new FakeRegistry();
  const uow = {
    transaction<T>(_fn: () => T): T {
      throw new Error("db connection lost");
    },
  } satisfies UnitOfWork;
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () => uc.execute(makeInput({ name: "alpha" })),
    /db connection lost/,
  );

  // Nothing was stored because the transaction threw.
  assert.equal(registry.list().length, 0);
  assert.equal(registry.getDefault()?.id, undefined);
});

// ── B4: provider/model validation ──
test("RegisterAiProvider: rejects unknown provider kind", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog();
  const uc = new RegisterAiProvider(registry, uow, catalog);

  assert.throws(
    () => uc.execute(makeInput({ provider: "not-a-real-provider" })),
    UnknownProviderError,
  );
});

test("RegisterAiProvider: rejects unknown model for known provider", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-terra" },
  ]);
  const uc = new RegisterAiProvider(registry, uow, catalog);

  assert.throws(
    () =>
      uc.execute(
        makeInput({ provider: "openai-codex", model: "no-such-model" }),
      ),
    UnknownModelError,
  );
});

// ── S2: reactivation warns on config mismatch ──
test("RegisterAiProvider: reactivation warns on provider/model config mismatch", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const warnMessages: string[] = [];
  const uc = new RegisterAiProvider(registry, uow, undefined, (msg: string) =>
    warnMessages.push(msg),
  );

  const firstId = uc.execute(
    makeInput({
      name: "alpha",
      provider: "openai-codex",
      model: "gpt-5.6-terra",
      value: "sk-old",
    }),
  );
  registry.logout(firstId);

  // Re-register with different provider/model
  uc.execute(
    makeInput({
      name: "alpha",
      provider: "anthropic-claude",
      model: "claude-4-opus",
      value: "sk-new",
    }),
  );

  // Stored config is unchanged
  const stored = registry.get(firstId);
  assert.equal(stored!.provider, "openai-codex", "provider unchanged");
  assert.equal(stored!.model, "gpt-5.6-terra", "model unchanged");

  // Warning should have been emitted about config retention
  assert.ok(warnMessages.length > 0, "should emit warning when config differs");
  const warning = warnMessages.join(" ");
  assert.match(warning, /config|retained|ignored/i);
});

// ── S3: reactivation sets the default pointer when default is empty ──
test("RegisterAiProvider: reactivation sets the default pointer when default is empty", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  const firstId = uc.execute(makeInput({ name: "alpha", value: "sk-old" }));
  // Clear the default pointer
  registry.clearDefault();
  assert.equal(
    registry.getDefault()?.id,
    undefined,
    "default should be cleared",
  );

  // Logout the provider
  registry.logout(firstId);

  // Reactivate — should set the default pointer
  uc.execute(makeInput({ name: "alpha", value: "sk-new" }));

  assert.equal(
    registry.getDefault()?.id,
    firstId,
    "reactivation should set the default pointer when default is empty",
  );
});

// ── S9: input validation ──
test("RegisterAiProvider: rejects invalid effort value", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-terra" },
  ]);
  const uc = new RegisterAiProvider(registry, uow, catalog);

  assert.throws(
    () => uc.execute(makeInput({ effort: "banana" })),
    InvalidEffortError,
  );
});

test("RegisterAiProvider: rejects invalid baseUrl value", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () => uc.execute(makeInput({ baseUrl: "not-a-url" })),
    InvalidBaseUrlError,
  );
});

// ── B1 (auto-review): empty value rejection ──
test("RegisterAiProvider: rejects empty value string", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(() => uc.execute(makeInput({ value: "" })), EmptyValueError);

  // Nothing was inserted.
  assert.equal(registry.list().length, 0);
  assert.equal(registry.getDefault()?.id, undefined);
});

// ═══════════════════════════════════════════════════════════════════
// Story B — custom OpenAI-compatible provider path
// ═══════════════════════════════════════════════════════════════════

test("RegisterAiProvider: custom with api inserts custom record with defaults, first-wins default, and skips catalog", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([]); // empty = nothing valid
  const uc = new RegisterAiProvider(registry, uow, catalog);

  const id = uc.execute({
    name: "custom-qwen",
    provider: "ignored-provider", // custom must use customProviderId instead
    model: "qwen-max",
    baseUrl: "https://api.example.com/v1",
    value: "sk-key",
    api: "openai-completions",
    customProviderId: "qwen-token-plan",
  });

  const stored = registry.get(id)!;
  // Custom fields stored with defaults
  assert.equal(stored.api, "openai-completions");
  assert.equal(stored.contextWindow, 32768);
  assert.equal(stored.maxTokens, 4096);
  // provider is customProviderId, not the input.provider
  assert.equal(stored.provider, "qwen-token-plan");
  // Model passed through
  assert.equal(stored.model, "qwen-max");
  // Catalog validation was skipped despite empty catalog
  assert.equal(stored.name, "custom-qwen");
  assert.equal(stored.state, "active");
  // First-wins default
  assert.equal(registry.getDefault()?.id, id, "first custom becomes default");
});

test("RegisterAiProvider: custom branch skips catalog validation even with real catalog", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([]); // nothing is valid
  const uc = new RegisterAiProvider(registry, uow, catalog);

  // Should NOT throw UnknownProviderError — catalog is skipped
  assert.doesNotThrow(() =>
    uc.execute({
      name: "custom-skip",
      provider: "nonexistent",
      model: "phantom-model",
      baseUrl: "https://api.example.com/v1",
      value: "sk-key",
      api: "openai-completions",
      customProviderId: "custom-one",
    }),
  );
});

test("RegisterAiProvider: custom rejects missing customProviderId", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-no-id",
        provider: "some-provider",
        model: "qwen-max",
        baseUrl: "http://localhost:8080/v1",
        value: "sk-key",
        api: "openai-completions",
        // no customProviderId
      }),
    MissingCustomProviderIdError,
  );
});

test("RegisterAiProvider: custom rejects missing baseUrl", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-no-url",
        provider: "some-provider",
        model: "qwen-max",
        value: "sk-key",
        api: "openai-completions",
        customProviderId: "qwen-token-plan",
        // no baseUrl
      }),
    MissingBaseUrlError,
  );
});

test("RegisterAiProvider: custom rejects bogus api flavor", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-bogus",
        provider: "qwen-token-plan",
        model: "qwen-max",
        baseUrl: "http://localhost:8080/v1",
        value: "sk-key",
        // @ts-expect-error — testing runtime InvalidApiFlavorError; the strict union rejects "bogus" at compile time
        api: "bogus",
        customProviderId: "qwen-token-plan",
      }),
    InvalidApiFlavorError,
  );
});

test("RegisterAiProvider: builtin branch (no api) still catalog-validates", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([]); // empty = nothing valid
  const uc = new RegisterAiProvider(registry, uow, catalog);

  // Builtin path without api must still validate against the catalog
  assert.throws(
    () =>
      uc.execute(
        makeInput({ provider: "openai-codex", model: "gpt-5.6-terra" }),
      ),
    UnknownProviderError,
  );
});

// ═══════════════════════════════════════════════════════════════════
// Story E — endpoint trust controls
// ═══════════════════════════════════════════════════════════════════

function customInput(
  overrides: Partial<{
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    value: string;
    api: "openai-completions" | "openai-responses";
    customProviderId: string;
    allowInsecure?: boolean;
  }> = {},
): {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  value: string;
  api: "openai-completions" | "openai-responses";
  customProviderId: string;
  allowInsecure?: boolean;
} {
  return {
    name: "custom-e",
    provider: "ignored",
    model: "qwen-max",
    baseUrl: "https://api.example.com/v1",
    value: "sk-key",
    api: "openai-completions",
    customProviderId: "custom-one",
    ...overrides,
  };
}

test("RegisterAiProvider: custom rejects plain http:// without allowInsecure", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () => uc.execute(customInput({ baseUrl: "http://localhost:8080/v1" })),
    InsecureEndpointError,
  );
});

test("RegisterAiProvider: custom rejects 127.0.0.1 loopback without allowInsecure", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () => uc.execute(customInput({ baseUrl: "http://127.0.0.1:8080/v1" })),
    InsecureEndpointError,
  );
});

test("RegisterAiProvider: custom allows http:// with allowInsecure:true", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([]);
  const uc = new RegisterAiProvider(registry, uow, catalog);

  assert.doesNotThrow(() =>
    uc.execute(
      customInput({
        baseUrl: "http://localhost:8080/v1",
        allowInsecure: true,
      }),
    ),
  );
});

test("RegisterAiProvider: custom rejects baseUrl with embedded userinfo", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute(
        customInput({
          baseUrl: "https://user:pass@api.example.com/v1",
        }),
      ),
    EmbeddedCredentialError,
  );
});

test("RegisterAiProvider: custom allows public https:// host without allowInsecure", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([]);
  const uc = new RegisterAiProvider(registry, uow, catalog);

  assert.doesNotThrow(() =>
    uc.execute(
      customInput({
        baseUrl: "https://api.openai.com/v1",
      }),
    ),
  );
});

// ═══════════════════════════════════════════════════════════════════
// B3 — Custom path base-url shape validation
// ═══════════════════════════════════════════════════════════════════

test("RegisterAiProvider: custom rejects garbage baseUrl with InvalidBaseUrlError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () => uc.execute(customInput({ baseUrl: "not-a-url" })),
    InvalidBaseUrlError,
  );
});

test("RegisterAiProvider: custom rejects scheme-less loopback with InvalidBaseUrlError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () => uc.execute(customInput({ baseUrl: "localhost:8080/v1" })),
    InvalidBaseUrlError,
  );
});

// ═══════════════════════════════════════════════════════════════════
// S1 — Custom path: reasoning-effort validation
// ═══════════════════════════════════════════════════════════════════

test("RegisterAiProvider: custom rejects bogus effort value with InvalidEffortError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-s1",
        provider: "ignored",
        model: "qwen-max",
        baseUrl: "https://api.example.com/v1",
        value: "sk-key",
        api: "openai-completions",
        customProviderId: "custom-one",
        effort: "bogus",
      }),
    InvalidEffortError,
  );
});

// ═══════════════════════════════════════════════════════════════════
// S2 — Numeric flag validation (NaN / negative)
// ═══════════════════════════════════════════════════════════════════

test("RegisterAiProvider: custom rejects NaN contextWindow with InvalidNumericFlagError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-s2a",
        provider: "ignored",
        model: "qwen-max",
        baseUrl: "https://api.example.com/v1",
        value: "sk-key",
        api: "openai-completions",
        customProviderId: "custom-one",
        contextWindow: NaN,
      }),
    (err: unknown) => (err as Error).name === "InvalidNumericFlagError",
  );
});

test("RegisterAiProvider: custom rejects NaN maxTokens with InvalidNumericFlagError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-s2b",
        provider: "ignored",
        model: "qwen-max",
        baseUrl: "https://api.example.com/v1",
        value: "sk-key",
        api: "openai-completions",
        customProviderId: "custom-one",
        maxTokens: NaN,
      }),
    (err: unknown) => (err as Error).name === "InvalidNumericFlagError",
  );
});

test("RegisterAiProvider: custom rejects negative contextWindow with InvalidNumericFlagError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-s2c",
        provider: "ignored",
        model: "qwen-max",
        baseUrl: "https://api.example.com/v1",
        value: "sk-key",
        api: "openai-completions",
        customProviderId: "custom-one",
        contextWindow: -1,
      }),
    (err: unknown) => (err as Error).name === "InvalidNumericFlagError",
  );
});

test("RegisterAiProvider: custom rejects negative maxTokens with InvalidNumericFlagError", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const uc = new RegisterAiProvider(registry, uow);

  assert.throws(
    () =>
      uc.execute({
        name: "custom-s2d",
        provider: "ignored",
        model: "qwen-max",
        baseUrl: "https://api.example.com/v1",
        value: "sk-key",
        api: "openai-completions",
        customProviderId: "custom-one",
        maxTokens: -1,
      }),
    (err: unknown) => (err as Error).name === "InvalidNumericFlagError",
  );
});

// ═══════════════════════════════════════════════════════════════════
// BLOCKER 9 — builtin path must route through registerGlobalProvider
// ═══════════════════════════════════════════════════════════════════

test("(BLOCKER 9) RegisterAiProvider builtin path calls registerGlobalProvider instead of inline register", () => {
  const registry = new FakeRegistry();
  const uow = new FakeUnitOfWork();
  const catalog = new FakeModelCatalog([
    { provider: "openai-codex", model: "gpt-5.6-terra" },
  ]);
  let helperCalled = false;
  let helperParams: Record<string, unknown> | undefined;

  const registerProviderSpy = (
    _reg: AiProviderRegistry,
    params: {
      name: string;
      provider: string;
      model: string;
      value: string;
      baseUrl?: string;
      effort?: string;
    },
  ): string => {
    helperCalled = true;
    helperParams = params as unknown as Record<string, unknown>;
    return registry.register(params).id;
  };

  // RegisterAiProvider does NOT currently accept registerProviderSpy — this will fail at runtime
  const uc = new (RegisterAiProvider as any)(
    registry,
    uow,
    catalog,
    undefined,
    registerProviderSpy,
  );

  const id = uc.execute({
    name: "alpha",
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    value: "sk-secret",
  });

  // The builtin path must go through registerGlobalProvider, not inline registry.register
  assert.ok(
    helperCalled,
    "registerProvider helper (registerGlobalProvider) must be called for builtin path",
  );
  assert.ok(id, "returns a provider id");
});
