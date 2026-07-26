// src/app/ai-provider/remove-ai-provider.test.ts — RemoveAiProvider
// (008.1 Story D: credential lifecycle — remove).
// S10: options-object signature (`replacement`/`confirmNoDefault`); "remove
// must act the same" as logout — allow "no default" via a second confirmation.

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  UnitOfWork,
} from "../../storage/port.ts";
import { RemoveAiProvider } from "./remove-ai-provider.ts";
import {
  LoggedOutProviderError,
  SelfReplacementError,
  UnnecessaryReplacementError,
  ConflictingDefaultChoiceError,
} from "./errors.ts";
import { UnknownReferenceError } from "../errors.ts";

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
  }): GlobalAiProvider {
    const id = `p${this.#store.size + 1}`;
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
  clearDefault(): void {
    this.#defaultId = undefined;
  }
  logout(_id: string): void {}
  remove(id: string): void {
    this.#store.delete(id);
  }

  // Test helper: directly add a pre-built provider
  add(p: GlobalAiProvider): void {
    this.#store.set(p.id, { ...p });
  }
}

const passThroughUow: UnitOfWork = {
  transaction<T>(fn: () => T): T {
    return fn();
  },
};

function makeProvider(
  id: string,
  overrides?: Partial<GlobalAiProvider>,
): GlobalAiProvider {
  return {
    id,
    name: `${id}-name`,
    provider: "openai-codex",
    model: "gpt-5.6-terra",
    baseUrl: null,
    effort: null,
    value: "sk-secret",
    state: "active",
    credentialVersion: 1,
    ...overrides,
  };
}

test("RemoveAiProvider: remove of non-default deletes the record", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p2");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  uc.execute("p1");

  assert.equal(registry.get("p1"), undefined);
  assert.equal(registry.get("p2")?.id, "p2");
});

test("RemoveAiProvider: remove of default without replacement when other active provider exists throws", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(() => uc.execute("p1"), /replacement/i);
});

test("RemoveAiProvider: remove of default with replacement deletes and repairs default", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.add(makeProvider("p3"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  uc.execute("p1", { replacement: "p2" });

  assert.equal(registry.get("p1"), undefined);
  assert.equal(registry.getDefault()?.id, "p2");
});

test("RemoveAiProvider: remove of last provider clears the default", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  uc.execute("p1");

  assert.equal(registry.get("p1"), undefined);
  assert.equal(registry.getDefault()?.id, undefined);
});

test("RemoveAiProvider: remove of unknown id throws UnknownReferenceError", () => {
  const registry = new FakeRegistry();
  const uc = new RemoveAiProvider(registry, passThroughUow);

  assert.throws(() => uc.execute("unknown-id"), UnknownReferenceError);
});

test("RemoveAiProvider: remove of default with replacement rejects logged_out replacement", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2", { state: "logged_out" }));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "p2" }),
    (err: unknown) =>
      err instanceof LoggedOutProviderError && err.message.includes("remove"),
  );
});

// ── Atomicity: remove's default-path writes (setDefault/clearDefault + remove)
// must run inside uow.transaction() (008.1 Story D: "removal + default repair
// in one transaction"). A spy proves the writes happen strictly between
// transaction's "enter" and "exit" — unlike a bare "transaction() was called"
// flag, this cannot be satisfied by a stub that opens the transaction after
// already performing its writes. Mirrors logout-ai-provider.test.ts's
// RecordingRegistry/makeSpyUow shape exactly. ──

class RecordingRegistry extends FakeRegistry {
  readonly log: string[] = [];

  setDefault(id: string): void {
    this.log.push("setDefault");
    super.setDefault(id);
  }
  clearDefault(): void {
    this.log.push("clearDefault");
    super.clearDefault();
  }
  remove(id: string): void {
    this.log.push("remove");
    super.remove(id);
  }
}

function makeSpyUow(log: string[]): { uow: UnitOfWork; calls: () => number } {
  let calls = 0;
  const uow: UnitOfWork = {
    transaction<T>(fn: () => T): T {
      calls += 1;
      log.push("enter");
      const result = fn();
      log.push("exit");
      return result;
    },
  };
  return { uow, calls: () => calls };
}

test("RemoveAiProvider: default + --replacement performs setDefault and remove inside uow.transaction()", () => {
  const registry = new RecordingRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");
  registry.log.length = 0; // drop the setup-time setDefault noise

  const { uow, calls } = makeSpyUow(registry.log);
  const uc = new RemoveAiProvider(registry, uow);

  uc.execute("p1", { replacement: "p2" });

  assert.equal(calls(), 1, "transaction() must be called exactly once");
  assert.deepEqual(
    registry.log,
    ["enter", "setDefault", "remove", "exit"],
    "setDefault and remove must both run strictly between transaction's enter and exit",
  );
});

test("RemoveAiProvider: default + --confirm-no-default performs clearDefault and remove inside uow.transaction()", () => {
  const registry = new RecordingRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");
  registry.log.length = 0; // drop the setup-time setDefault noise

  const { uow, calls } = makeSpyUow(registry.log);
  const uc = new RemoveAiProvider(registry, uow);

  uc.execute("p1", { confirmNoDefault: true });

  assert.equal(calls(), 1, "transaction() must be called exactly once");
  assert.deepEqual(
    registry.log,
    ["enter", "clearDefault", "remove", "exit"],
    "clearDefault and remove must both run strictly between transaction's enter and exit",
  );
});

test("RemoveAiProvider: remove of the default with self-replacement throws and does not delete or change default", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "p1" }),
    SelfReplacementError,
  );

  // Assert the provider still exists and default is unchanged
  assert.notEqual(registry.get("p1"), undefined);
  const p = registry.get("p1")!;
  assert.equal(p.state, "active");
  assert.equal(p.credentialVersion, 1);
  assert.equal(registry.getDefault()?.id, "p1");
});

test("remove of non-default with --replacement throws UnnecessaryReplacementError", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1"); // p1 is default

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p2", { replacement: "p1" }), // p2 is NOT default, --replacement is unnecessary
    UnnecessaryReplacementError,
  );

  // State unchanged
  assert.ok(registry.get("p2") !== undefined, "p2 still exists");
  assert.equal(registry.get("p2")!.state, "active");
  assert.equal(registry.getDefault()?.id, "p1");
});

// ── S10: allow "no default" via a second confirmation — "remove must act the same" ──

test("RemoveAiProvider: default + others remain + confirmNoDefault deletes the record, clears the pointer, siblings untouched", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  uc.execute("p1", { confirmNoDefault: true });

  assert.equal(registry.get("p1"), undefined);
  assert.equal(registry.getDefault(), undefined);
  const p2 = registry.get("p2")!;
  assert.notEqual(p2, undefined);
  assert.equal(p2.state, "active");
});

test("RemoveAiProvider: default + both replacement and confirmNoDefault throws ConflictingDefaultChoiceError; nothing mutated", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "p2", confirmNoDefault: true }),
    ConflictingDefaultChoiceError,
  );

  assert.notEqual(registry.get("p1"), undefined);
  assert.equal(registry.getDefault()?.id, "p1");
  assert.notEqual(registry.get("p2"), undefined);
});

test("RemoveAiProvider: non-default + confirmNoDefault throws UnnecessaryReplacementError naming the flag", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p2", { confirmNoDefault: true }),
    (err: unknown) =>
      err instanceof UnnecessaryReplacementError &&
      err.flag === "--confirm-no-default",
  );

  assert.notEqual(registry.get("p2"), undefined);
  assert.equal(registry.getDefault()?.id, "p1");
});

test("RemoveAiProvider: removing the last provider with --replacement is rejected as unnecessary (newly closed hole)", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "bogus" }),
    UnnecessaryReplacementError,
  );

  assert.notEqual(registry.get("p1"), undefined);
  assert.equal(registry.getDefault()?.id, "p1");
});

test("RemoveAiProvider: removing the last provider with --confirm-no-default is rejected as unnecessary (newly closed hole)", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { confirmNoDefault: true }),
    UnnecessaryReplacementError,
  );

  assert.notEqual(registry.get("p1"), undefined);
  assert.equal(registry.getDefault()?.id, "p1");
});
