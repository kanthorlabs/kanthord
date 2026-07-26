// src/app/ai-provider/logout-ai-provider.test.ts — LogoutAiProvider
// (008.1 Story D: credential lifecycle — logout).
// S10: options-object signature (`replacement`/`confirmNoDefault`); allow
// "no default" via a second confirmation.

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AiProviderRegistry,
  GlobalAiProvider,
  UnitOfWork,
} from "../../storage/port.ts";
import { LogoutAiProvider } from "./logout-ai-provider.ts";
import {
  CorruptDefaultPointerError,
  LoggedOutProviderError,
  SelfReplacementError,
  UnnecessaryReplacementError,
  DefaultNeedsReplacementError,
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
      api: null,
      contextWindow: null,
      maxTokens: null,
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
  logout(id: string): void {
    const p = this.#store.get(id);
    if (p !== undefined) {
      p.state = "logged_out";
      p.credentialVersion += 1;
      p.value = null;
    }
  }
  remove(id: string): void {
    this.#store.delete(id);
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
    api: null,
    contextWindow: null,
    maxTokens: null,
    ...overrides,
  } as GlobalAiProvider;
}

test("LogoutAiProvider: logout flips state to logged_out, keeps name/config, bumps credentialVersion", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  const uc = new LogoutAiProvider(registry, passThroughUow);

  uc.execute("p1");

  const p = registry.get("p1")!;
  assert.equal(p.state, "logged_out");
  assert.equal(p.credentialVersion, 2);
  assert.equal(p.name, "p1-name");
  assert.equal(p.provider, "openai-codex");
  assert.equal(p.model, "gpt-5.6-terra");
});

test("LogoutAiProvider: logout of non-default works without replacement", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p2");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  uc.execute("p1");

  const p = registry.get("p1")!;
  assert.equal(p.state, "logged_out");
  assert.equal(registry.getDefault()?.id, "p2");
});

test("LogoutAiProvider: logout of the default without replacement throws", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1"),
    /requires.*replacement|replacement.*required/i,
  );
});

test("LogoutAiProvider: logout of the default with replacement succeeds and flips default", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  uc.execute("p1", { replacement: "p2" });

  const p = registry.get("p1")!;
  assert.equal(p.state, "logged_out");
  assert.equal(registry.getDefault()?.id, "p2");
});

test("LogoutAiProvider: logout is idempotent on already logged_out provider", () => {
  const registry = new FakeRegistry();
  registry.add(
    makeProvider("p1", { state: "logged_out", credentialVersion: 3 }),
  );
  const uc = new LogoutAiProvider(registry, passThroughUow);

  uc.execute("p1");

  const p = registry.get("p1")!;
  assert.equal(p.state, "logged_out");
  assert.equal(p.credentialVersion, 3);
});

test("LogoutAiProvider: logout of unknown id throws UnknownReferenceError", () => {
  const registry = new FakeRegistry();
  const uc = new LogoutAiProvider(registry, passThroughUow);

  assert.throws(() => uc.execute("unknown-id"), UnknownReferenceError);
});

test("LogoutAiProvider: logout of the default with replacement rejects logged_out replacement", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2", { state: "logged_out" }));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "p2" }),
    (err: unknown) =>
      err instanceof LoggedOutProviderError && err.message.includes("logout"),
  );
});

test("LogoutAiProvider: logout of the default with self-replacement throws and does not change state or default", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "p1" }),
    SelfReplacementError,
  );

  // Assert the provider is still active and default is unchanged
  const p = registry.get("p1")!;
  assert.equal(p.state, "active");
  assert.equal(p.credentialVersion, 1);
  assert.equal(registry.getDefault()?.id, "p1");
});

test("logout of an already-logged_out non-default provider is a silent success (idempotent)", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");
  registry.add(makeProvider("p2"));
  const uc = new LogoutAiProvider(registry, passThroughUow);

  // First logout of non-default p2 — succeeds, flips to logged_out
  uc.execute("p2");
  let p2 = registry.get("p2")!;
  assert.equal(p2.state, "logged_out");
  assert.equal(p2.credentialVersion, 2);

  // Second logout of same already-logged_out non-default — idempotent, no error
  uc.execute("p2");
  p2 = registry.get("p2")!;
  assert.equal(p2.state, "logged_out");
  assert.equal(p2.credentialVersion, 2); // unchanged
  assert.equal(registry.getDefault()?.id, "p1"); // default untouched
});

// ── B2 (Ulrich decision): flag validation precedes idempotency. A flag that
// cannot apply to an already-logged_out target is an operator mistake and is
// rejected, never swallowed by the idempotent no-op — logout is idempotent
// only when called with NO flags. ──

test("LogoutAiProvider: already-logged_out non-default target + confirmNoDefault throws UnnecessaryReplacementError naming the flag; nothing mutated", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");
  registry.add(
    makeProvider("p2", { state: "logged_out", credentialVersion: 2 }),
  );

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p2", { confirmNoDefault: true }),
    (err: unknown) =>
      err instanceof UnnecessaryReplacementError &&
      err.flag === "--confirm-no-default",
  );

  const p2 = registry.get("p2")!;
  assert.equal(p2.state, "logged_out");
  assert.equal(
    p2.credentialVersion,
    2,
    "credentialVersion must not bump — no write happened",
  );
  assert.equal(registry.getDefault()?.id, "p1", "default pointer untouched");
});

test("LogoutAiProvider: already-logged_out non-default target + --replacement throws UnnecessaryReplacementError naming --replacement; nothing mutated", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");
  registry.add(
    makeProvider("p2", { state: "logged_out", credentialVersion: 2 }),
  );

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p2", { replacement: "p1" }),
    (err: unknown) =>
      err instanceof UnnecessaryReplacementError &&
      err.flag === "--replacement",
  );

  const p2 = registry.get("p2")!;
  assert.equal(p2.state, "logged_out");
  assert.equal(
    p2.credentialVersion,
    2,
    "credentialVersion must not bump — no write happened",
  );
  assert.equal(registry.getDefault()?.id, "p1", "default pointer untouched");
});

test("LogoutAiProvider: already-logged_out non-default target + NO flags is still a silent no-op (idempotency survives the ordering change)", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");
  registry.add(
    makeProvider("p2", { state: "logged_out", credentialVersion: 2 }),
  );

  const uc = new LogoutAiProvider(registry, passThroughUow);

  // No flags at all — must still succeed silently, exit 0, nothing mutated.
  assert.doesNotThrow(() => uc.execute("p2"));

  const p2 = registry.get("p2")!;
  assert.equal(p2.state, "logged_out");
  assert.equal(p2.credentialVersion, 2, "unchanged — no-op");
  assert.equal(registry.getDefault()?.id, "p1", "default pointer untouched");
});

test("logout of an already-logged_out default provider throws a corrupt-state error", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");

  // Force-set p1's state to logged_out directly (simulates invariant corruption)
  const p1 = registry.get("p1")!;
  p1.state = "logged_out";

  const uc = new LogoutAiProvider(registry, passThroughUow);

  // Must throw — default must not point at a logged_out provider
  assert.throws(() => uc.execute("p1"), CorruptDefaultPointerError);

  // Neither the state nor the default pointer is mutated
  assert.equal(registry.get("p1")!.state, "logged_out");
  assert.equal(registry.getDefault()?.id, "p1");
});

test("logout of non-default with --replacement throws UnnecessaryReplacementError", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1"); // p1 is default

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p2", { replacement: "p1" }), // p2 is NOT default, --replacement is unnecessary
    UnnecessaryReplacementError,
  );

  // State unchanged
  assert.equal(registry.get("p2")!.state, "active");
  assert.equal(registry.getDefault()?.id, "p1");
});

// ── S10: allow "no default" via a second confirmation ──

test("LogoutAiProvider: default + confirmNoDefault logs out and clears the default, siblings untouched", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  uc.execute("p1", { confirmNoDefault: true });

  const p1 = registry.get("p1")!;
  assert.equal(p1.state, "logged_out");
  assert.equal(registry.getDefault(), undefined);
  // record still exists, other providers untouched
  assert.notEqual(registry.get("p1"), undefined);
  const p2 = registry.get("p2")!;
  assert.equal(p2.state, "active");
  assert.equal(p2.credentialVersion, 1);
});

test("LogoutAiProvider: default + both replacement and confirmNoDefault throws ConflictingDefaultChoiceError; nothing mutated", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "p2", confirmNoDefault: true }),
    ConflictingDefaultChoiceError,
  );

  const p1 = registry.get("p1")!;
  assert.equal(p1.state, "active");
  assert.equal(p1.credentialVersion, 1);
  assert.equal(registry.getDefault()?.id, "p1");
  const p2 = registry.get("p2")!;
  assert.equal(p2.state, "active");
});

test("LogoutAiProvider: non-default + confirmNoDefault throws UnnecessaryReplacementError naming the flag; nothing mutated", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p2", { confirmNoDefault: true }),
    (err: unknown) =>
      err instanceof UnnecessaryReplacementError &&
      err.flag === "--confirm-no-default",
  );

  const p2 = registry.get("p2")!;
  assert.equal(p2.state, "active");
  assert.equal(registry.getDefault()?.id, "p1");
});

test("LogoutAiProvider: single-provider case — is the default, confirmNoDefault succeeds; without the flag it still requires a replacement", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);

  // Without the flag: still rejected.
  assert.throws(() => uc.execute("p1"), DefaultNeedsReplacementError);
  assert.equal(registry.get("p1")!.state, "active");
  assert.equal(registry.getDefault()?.id, "p1");

  // With confirmNoDefault: succeeds — the single-provider case that motivated this.
  uc.execute("p1", { confirmNoDefault: true });

  assert.equal(registry.list().length, 1);
  const p1 = registry.get("p1")!;
  assert.equal(p1.state, "logged_out");
  assert.equal(registry.getDefault(), undefined);
});

test("LogoutAiProvider: DefaultNeedsReplacementError names both escapes (--replacement and --confirm-no-default)", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");

  const uc = new LogoutAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1"),
    (err: unknown) =>
      err instanceof DefaultNeedsReplacementError &&
      err.message.includes("--replacement") &&
      err.message.includes("--confirm-no-default"),
  );
});

// ── Atomicity: logout's default-path writes (setDefault/clearDefault + logout)
// must run inside uow.transaction() (008.1 Story D §6: LogoutAiProvider needs
// a UnitOfWork). A spy proves the writes happen strictly between transaction's
// "enter" and "exit" — unlike a rollback assertion, this cannot be satisfied by
// merely reordering the production writes. ──

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
  logout(id: string): void {
    this.log.push("logout");
    super.logout(id);
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

test("LogoutAiProvider: default + --replacement performs setDefault and logout inside uow.transaction()", () => {
  const registry = new RecordingRegistry();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");
  registry.log.length = 0; // drop the setup-time setDefault noise

  const { uow, calls } = makeSpyUow(registry.log);
  const uc = new LogoutAiProvider(registry, uow);

  uc.execute("p1", { replacement: "p2" });

  assert.equal(calls(), 1, "transaction() must be called exactly once");
  assert.deepEqual(
    registry.log,
    ["enter", "setDefault", "logout", "exit"],
    "setDefault and logout must both run strictly between transaction's enter and exit",
  );
});

test("LogoutAiProvider: default + --confirm-no-default performs clearDefault and logout inside uow.transaction()", () => {
  const registry = new RecordingRegistry();
  registry.add(makeProvider("p1"));
  registry.setDefault("p1");
  registry.log.length = 0; // drop the setup-time setDefault noise

  const { uow, calls } = makeSpyUow(registry.log);
  const uc = new LogoutAiProvider(registry, uow);

  uc.execute("p1", { confirmNoDefault: true });

  assert.equal(calls(), 1, "transaction() must be called exactly once");
  assert.deepEqual(
    registry.log,
    ["enter", "clearDefault", "logout", "exit"],
    "clearDefault and logout must both run strictly between transaction's enter and exit",
  );
});

test("LogoutAiProvider: uow is a required constructor parameter, not optional (compile guard)", () => {
  // The two spy tests above already pass today because production already
  // wraps every write in `this.#uow.transaction()` — that wrapping predates
  // this blocker. The actual deviation (AGENTS.md: "never weaken a
  // spec-required field to optional") is a *type-level* fact a runtime spy
  // cannot observe: today `uow` is optional with an internal pass-through
  // default, so a 1-arg construction still typechecks. This @ts-expect-error
  // is therefore intentionally unused right now (TS2578), which fails
  // `npm run typecheck` for the right reason; it starts suppressing a real
  // "expected 2 arguments" error — and typecheck turns green — only once the
  // software-engineer makes `uow: UnitOfWork` a required second parameter and
  // deletes the pass-through default.
  const registry = new FakeRegistry();
  // @ts-expect-error — uow must be required; a 1-arg construction must be a type error
  const _guard = new LogoutAiProvider(registry);
  void _guard;
});
