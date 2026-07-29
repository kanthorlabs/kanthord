// src/app/ai-provider/config-validation-drift.test.ts — 018 S1 drift guard.
//
// BLOCKER B2 (review 20260729): the EPIC gate requires "a table over the
// nine validation rules executed against BOTH RegisterAiProvider.execute and
// UpdateAiProvider.execute, asserting the same typed error class per row" —
// so the two use cases cannot silently drift apart. `config-validation.test.ts`
// only drives the extracted validator function directly, which proves the
// rules work but never proves that BOTH use cases actually call it the same
// way for the same bad value. This file closes that gap.
//
// Rules 3 and 4 (customProviderId/baseUrl PRESENCE) are register-only by
// design: `UpdateAiProviderInput` has no `customProviderId` field, and Story
// S3 always calls the validator with `{customProviderId: false, baseUrl:
// false}` on the update path (a patch omits what it does not change). Those
// two rows assert against RegisterAiProvider only, with the reason recorded
// in the table.

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  UnitOfWork,
} from "../../storage/port.ts";
import { RegisterAiProvider } from "./register-ai-provider.ts";
import { UpdateAiProvider } from "./update-ai-provider.ts";
import {
  InvalidApiFlavorError,
  InvalidEffortError,
  MissingCustomProviderIdError,
  MissingBaseUrlError,
  InvalidBaseUrlError,
  InvalidNumericFlagError,
  InsecureEndpointError,
} from "./errors.ts";
import { EmbeddedCredentialError } from "../errors.ts";

// -------------------------------------------------------- fakes

class FakeRegistry implements AiProviderRegistry {
  readonly #store = new Map<string, GlobalAiProvider>();

  seed(p: GlobalAiProvider): void {
    this.#store.set(p.id, p);
  }

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
    const provider: GlobalAiProvider = {
      id: "generated-id",
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
    this.#store.set(provider.id, provider);
    return { ...provider };
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
    const current = this.#store.get(id);
    if (current === undefined) throw new Error("not seeded");
    const merged = { ...current, ...patch };
    this.#store.set(id, merged);
    return { ...merged };
  }

  get(id: string): GlobalAiProvider | undefined {
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
  updateCredentialCAS():
    { applied: true; newVersion: number } | { applied: false } {
    return { applied: true, newVersion: 2 };
  }
  assign(): void {}
  unassign(): void {}
  listAssigned(): GlobalAiProvider[] {
    return [];
  }
  maxRank(): number | undefined {
    return undefined;
  }
  shiftRanksFrom(): void {}
  compactRanks(): void {}
  getAssignment(): { rank: number } | undefined {
    return undefined;
  }
  listProjectsAssigning(): string[] {
    return [];
  }
}

class FakeUnitOfWork implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

function customRow(): GlobalAiProvider {
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
  };
}

function validRegisterInput() {
  return {
    name: "drift-test",
    provider: "custom-one",
    model: "qwen-max",
    value: "sk-test",
    api: "openai-completions" as const,
    customProviderId: "custom-one",
    baseUrl: "https://api.example.com/v1",
    effort: "medium",
    contextWindow: 32768,
    maxTokens: 4096,
  };
}

// -------------------------------------------------------- the table

type Row = {
  rule: string;
  errorClass: new (...args: never[]) => Error;
  /** Overrides applied on top of a valid custom-path RegisterAiProviderInput. */
  registerOverride: Record<string, unknown>;
  /** Overrides applied on top of a valid custom-path UpdateAiProviderInput patch. */
  updateOverride: Record<string, unknown> | undefined;
  /** Set when the rule cannot be reached on the update path by design. */
  updateNotApplicableReason?: string;
};

const ROWS: Row[] = [
  {
    rule: "1 — invalid api flavor",
    errorClass: InvalidApiFlavorError,
    registerOverride: { api: "not-a-flavor" },
    updateOverride: { api: "not-a-flavor" },
  },
  {
    rule: "2 — invalid effort",
    errorClass: InvalidEffortError,
    registerOverride: { effort: "not-an-effort" },
    updateOverride: { effort: "not-an-effort" },
  },
  {
    rule: "3 — missing customProviderId",
    errorClass: MissingCustomProviderIdError,
    registerOverride: { customProviderId: "" },
    updateOverride: undefined,
    updateNotApplicableReason:
      "UpdateAiProviderInput has no customProviderId field; Story S3 always validates with {customProviderId: false}",
  },
  {
    rule: "4 — missing baseUrl",
    errorClass: MissingBaseUrlError,
    registerOverride: { baseUrl: "" },
    updateOverride: undefined,
    updateNotApplicableReason:
      "Story S3 always validates the update path with {baseUrl: false} — a patch omits what it does not change",
  },
  {
    rule: "5 — malformed baseUrl",
    errorClass: InvalidBaseUrlError,
    registerOverride: { baseUrl: "not a url" },
    updateOverride: { baseUrl: "not a url" },
  },
  {
    rule: "6 — non-positive-integer contextWindow",
    errorClass: InvalidNumericFlagError,
    registerOverride: { contextWindow: 0 },
    updateOverride: { contextWindow: 0 },
  },
  {
    rule: "7 — non-positive-integer maxTokens",
    errorClass: InvalidNumericFlagError,
    registerOverride: { maxTokens: -1 },
    updateOverride: { maxTokens: -1 },
  },
  {
    rule: "8 — embedded userinfo in baseUrl",
    errorClass: EmbeddedCredentialError,
    registerOverride: { baseUrl: "https://user:pass@example.com/v1" },
    updateOverride: { baseUrl: "https://user:pass@example.com/v1" },
  },
  {
    rule: "9 — insecure endpoint without allowInsecure",
    errorClass: InsecureEndpointError,
    registerOverride: { baseUrl: "http://192.168.1.5/v1" },
    updateOverride: { baseUrl: "http://192.168.1.5/v1" },
  },
];

for (const row of ROWS) {
  test(`config-validation drift — rule ${row.rule} — RegisterAiProvider.execute throws ${row.errorClass.name}`, () => {
    const registry = new FakeRegistry();
    const uow = new FakeUnitOfWork();
    const uc = new RegisterAiProvider(registry, uow);

    assert.throws(
      () => uc.execute({ ...validRegisterInput(), ...row.registerOverride }),
      row.errorClass,
    );
  });

  if (row.updateOverride === undefined) {
    test(`config-validation drift — rule ${row.rule} — register-only by design (${row.updateNotApplicableReason})`, () => {
      assert.ok(true, row.updateNotApplicableReason);
    });
    continue;
  }

  test(`config-validation drift — rule ${row.rule} — UpdateAiProvider.execute throws ${row.errorClass.name} for the SAME bad value`, () => {
    const registry = new FakeRegistry();
    registry.seed(customRow());
    const uow = new FakeUnitOfWork();
    const uc = new UpdateAiProvider(registry, uow);

    assert.throws(
      () => uc.execute({ id: "cust-1", ...row.updateOverride }),
      row.errorClass,
    );
  });
}
