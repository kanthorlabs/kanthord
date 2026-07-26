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
  DefaultNeedsReplacementError,
  AssignedProviderError,
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
  logout(_id: string): void {}
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
});

// ── 008.2 Story E — assignment-aware removal ──────────────────────────

class FakeRegistryWithAssignments extends FakeRegistry {
  readonly #assignments = new Map<string, Map<string, number>>();

  assign(projectId: string, providerId: string, rank: number): void {
    let project = this.#assignments.get(projectId);
    if (!project) {
      project = new Map();
      this.#assignments.set(projectId, project);
    }
    project.set(providerId, rank);
  }
  unassign(projectId: string, providerId: string): void {
    this.#assignments.get(projectId)?.delete(providerId);
  }
  listAssigned(
    projectId: string,
  ): import("../../storage/port.ts").GlobalAiProvider[] {
    const project = this.#assignments.get(projectId);
    if (!project) return [];
    return Array.from(project.entries())
      .sort(([, a], [, b]) => a - b)
      .map(([id]) => this.get(id)!)
      .filter(
        (p): p is import("../../storage/port.ts").GlobalAiProvider =>
          p !== undefined,
      );
  }
  compactRanks(_projectId: string): void {}
  getAssignment(
    projectId: string,
    providerId: string,
  ): { rank: number } | undefined {
    const project = this.#assignments.get(projectId);
    if (!project) return undefined;
    const rank = project.get(providerId);
    return rank !== undefined ? { rank } : undefined;
  }
  maxRank(projectId: string): number | undefined {
    const project = this.#assignments.get(projectId);
    if (!project || project.size === 0) return undefined;
    return Math.max(...project.values());
  }
  listProjectsAssigning(providerId: string): string[] {
    const result: string[] = [];
    for (const [projectId, project] of this.#assignments) {
      if (project.has(providerId)) result.push(projectId);
    }
    return result;
  }
}

test("RemoveAiProvider: remove of assigned provider with no flag throws AssignedProviderError", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p2");
  registry.assign("proj-1", "p1", 0);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1"),
    (err: unknown) =>
      err instanceof AssignedProviderError &&
      err.id === "p1" &&
      err.assignedCount === 1,
  );
});

test("RemoveAiProvider: cascade drops assignment rows and removes the provider", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p2");
  registry.assign("proj-1", "p1", 0);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  uc.execute("p1", { cascade: true });

  assert.equal(registry.get("p1"), undefined, "p1 removed");
  assert.deepEqual(
    registry.listProjectsAssigning("p1"),
    [],
    "no projects assign p1 after cascade",
  );
  assert.equal(registry.getDefault()?.id, "p2", "default unchanged");
});

test("RemoveAiProvider: cascade on provider that is also the default throws DefaultNeedsReplacementError", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p1");
  registry.assign("proj-1", "p1", 0);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { cascade: true }),
    (err: unknown) => err instanceof DefaultNeedsReplacementError,
  );
});

test("RemoveAiProvider: replacement rewrites assignments, dedups, and removes the provider", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.add(makeProvider("p3"));
  registry.setDefault("p2");
  // proj-1: p1 at rank 0, p3 at rank 1
  registry.assign("proj-1", "p1", 0);
  registry.assign("proj-1", "p3", 1);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  uc.execute("p1", { replacement: "p3" });

  assert.equal(registry.get("p1"), undefined, "p1 removed");
  // proj-1 chain should be [p3] after dedup + removal
  const chain = registry.listAssigned("proj-1");
  assert.equal(chain.length, 1);
  assert.equal(chain[0]!.id, "p3");
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

test("RemoveAiProvider: non-default provider with --replacement and no assignments throws UnnecessaryReplacementError", () => {
  const registry = new FakeRegistry();
  registry.add(makeProvider("p1")); // default
  registry.add(makeProvider("p2")); // target — non-default, no assignments
  registry.setDefault("p1");

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p2", { replacement: "p1" }),
    UnnecessaryReplacementError,
  );

  assert.notEqual(registry.get("p2"), undefined);
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

// ── HUMAN_REVIEW: B1 — replacement to unknown id must not crash with raw SQLite error ──

test("RemoveAiProvider: non-default assigned provider with --replacement to unknown id throws UnknownReferenceError", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p2");
  registry.assign("proj-1", "p1", 0);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "unknown" }),
    (err: unknown) =>
      err instanceof UnknownReferenceError && err.kind === "ai_provider",
  );

  // State unchanged — nothing was committed
  assert.ok(registry.get("p1") !== undefined, "p1 still exists");
  assert.equal(
    registry.listProjectsAssigning("p1").length,
    1,
    "assignment preserved",
  );
});

// ── HUMAN_REVIEW: B2 — replacement must occupy the removed provider's rank, not maxRank+1 ──

test("RemoveAiProvider: replacement occupies the removed provider's rank slot (not maxRank+1)", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1")); // A
  registry.add(makeProvider("p2")); // B
  registry.add(makeProvider("p3")); // C — replacement
  registry.setDefault("p2");
  registry.assign("proj-1", "p1", 0);
  registry.assign("proj-1", "p2", 1);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  uc.execute("p1", { replacement: "p3" });

  const chain = registry.listAssigned("proj-1");
  assert.equal(
    chain.length,
    2,
    "chain must have 2 items: p3 at rank 0, p2 at rank 1",
  );
  assert.equal(
    chain[0]!.id,
    "p3",
    "replacement p3 must occupy rank 0 (the removed provider's slot)",
  );
  assert.equal(chain[1]!.id, "p2", "original p2 stays at rank 1");
});

// ── HUMAN_REVIEW: S1 — --cascade and --replacement together must be rejected ──

test("RemoveAiProvider: cascade and replacement together throw ambiguous-flags error", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.add(makeProvider("p3"));
  registry.setDefault("p2");
  registry.assign("proj-1", "p1", 0);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { cascade: true, replacement: "p3" }),
    (err: unknown) =>
      err instanceof Error &&
      (/\bcascade\b/i.test(err.message) ||
        /\bmutually exclusive\b/i.test(err.message)),
  );

  // State unchanged
  assert.ok(registry.get("p1") !== undefined, "p1 still exists");
  assert.equal(
    registry.listProjectsAssigning("p1").length,
    1,
    "assignment preserved",
  );
});

// ── HUMAN_REVIEW: S2 — self-replacement rejected even for non-default assigned provider ──

test("RemoveAiProvider: self-replacement on non-default assigned provider throws SelfReplacementError", () => {
  const registry = new FakeRegistryWithAssignments();
  registry.add(makeProvider("p1"));
  registry.add(makeProvider("p2"));
  registry.setDefault("p2");
  registry.assign("proj-1", "p1", 0);

  const uc = new RemoveAiProvider(registry, passThroughUow);
  assert.throws(
    () => uc.execute("p1", { replacement: "p1" }),
    (err: unknown) => err instanceof SelfReplacementError,
  );

  // State unchanged
  assert.ok(registry.get("p1") !== undefined, "p1 still exists");
  assert.equal(
    registry.listProjectsAssigning("p1").length,
    1,
    "assignment preserved",
  );
});
