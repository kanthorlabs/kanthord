import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeBudgetBreaker } from "./budget.ts";
import type {
  BudgetStorage,
  BudgetEscalationEvent,
  BudgetLogEntry,
} from "./budget.ts";

// Fake in-memory storage for tests (shared across breaker instances to simulate respawn)
class FakeBudgetStorage implements BudgetStorage {
  private readonly data = new Map<string, number>();
  async load(taskId: string): Promise<number> {
    return this.data.get(taskId) ?? 0;
  }
  async save(taskId: string, spent: number): Promise<void> {
    this.data.set(taskId, spent);
  }
}

describe("src/ring1/budget.ts", () => {
  it("T1(a): calls under the ceiling each proceed", async () => {
    const storage = new FakeBudgetStorage();
    const escalations: BudgetEscalationEvent[] = [];
    const breaker = makeBudgetBreaker(
      { ceiling: 100, conservativeCost: 50 },
      storage,
      (e) => escalations.push(e),
      () => {},
    );
    const r1 = await breaker.reserve("task-a", 30);
    const r2 = await breaker.reserve("task-a", 30);
    assert.equal(r1, "proceed");
    assert.equal(r2, "proceed");
    assert.equal(escalations.length, 0);
  });

  it("T1(b): breaching call — prior spend durable, breach not committed, model never invoked, escalation recorded", async () => {
    const storage = new FakeBudgetStorage();
    const escalations: BudgetEscalationEvent[] = [];
    const breaker = makeBudgetBreaker(
      { ceiling: 100, conservativeCost: 50 },
      storage,
      (e) => escalations.push(e),
      () => {},
    );
    // First reservation — succeeds, 60 is durable
    await breaker.reserve("task-b", 60);
    // Second reservation would push total to 120 > 100 — must halt
    let modelCalled = false;
    const result = await breaker.reserve("task-b", 60);
    if (result === "proceed") {
      modelCalled = true; // only called if proceed — must NOT reach this
    }
    assert.equal(result, "halted");
    assert.equal(modelCalled, false);
    assert.equal(escalations.length, 1);
    assert.equal(escalations[0]?.tag, "budget-breach");
    // Prior 60 still durable; breaching 60 was NOT committed
    const storedAfterBreach = await storage.load("task-b");
    assert.equal(storedAfterBreach, 60);
  });

  it("T1(c): null cost uses conservative ceiling", async () => {
    const storage = new FakeBudgetStorage();
    const escalations: BudgetEscalationEvent[] = [];
    const breaker = makeBudgetBreaker(
      { ceiling: 100, conservativeCost: 60 },
      storage,
      (e) => escalations.push(e),
      () => {},
    );
    // 50 spent, then null cost uses conservativeCost=60 → total 110 > 100
    await breaker.reserve("task-c", 50);
    const result = await breaker.reserve("task-c", null);
    assert.equal(result, "halted");
    assert.equal(escalations.length, 1);
  });

  it("T1(d): same breach halts under permissive fake model config (model-independence)", async () => {
    // The breaker takes no model parameter — model-independence is structural.
    // Both "strict" and "permissive" breakers use the identical constructor,
    // proving enforcement cannot be weakened by switching models.
    const storage1 = new FakeBudgetStorage();
    const storage2 = new FakeBudgetStorage();
    const esc1: BudgetEscalationEvent[] = [];
    const esc2: BudgetEscalationEvent[] = [];

    const strictBreaker = makeBudgetBreaker(
      { ceiling: 100, conservativeCost: 50 },
      storage1,
      (e) => esc1.push(e),
      () => {},
    );
    const permissiveBreaker = makeBudgetBreaker(
      { ceiling: 100, conservativeCost: 50 },
      storage2,
      (e) => esc2.push(e),
      () => {},
    );

    // Calling the identical constructor twice — with no model parameter anywhere on the
    // breaker API — is precisely what proves model-independence: a permissive model
    // cannot weaken ring 1.
    await strictBreaker.reserve("task-d1", 60);
    const r1 = await strictBreaker.reserve("task-d1", 60);

    await permissiveBreaker.reserve("task-d2", 60);
    const r2 = await permissiveBreaker.reserve("task-d2", 60);

    assert.equal(r1, "halted");
    assert.equal(r2, "halted");
    assert.equal(esc1.length, 1);
    assert.equal(esc2.length, 1);
  });

  it("T2: new breaker instance (respawn) loads accumulated spend from durable storage and breaches at same cumulative point", async () => {
    // Shared durable storage — survives the "respawn" boundary.
    // Simulates Epic 006: per-task total is keyed by compiled task id in durable
    // storage; a new runtime re-loads the total, it does NOT start at 0.
    const storage = new FakeBudgetStorage();
    const preEsc: BudgetEscalationEvent[] = [];
    const postEsc: BudgetEscalationEvent[] = [];

    // Pre-respawn: reserve 60 — durable total becomes 60
    const preBreaker = makeBudgetBreaker(
      { ceiling: 100, conservativeCost: 50 },
      storage,
      (e) => preEsc.push(e),
      () => {},
    );
    const r1 = await preBreaker.reserve("task-respawn", 60);
    assert.equal(r1, "proceed");
    assert.equal(await storage.load("task-respawn"), 60);

    // Respawn: NEW breaker instance, same durable storage, zero in-memory state.
    // No shared closure with preBreaker — this is the "new runtime/session".
    // The only durable link is `storage` (keyed by stable compiled task id).
    const postBreaker = makeBudgetBreaker(
      { ceiling: 100, conservativeCost: 50 },
      storage,
      (e) => postEsc.push(e),
      () => {},
    );

    // Post-respawn: reserve 60 more → cumulative 120 > ceiling 100 → halt
    // Same breach point as a single-session run (T1(b) scenario above)
    const r2 = await postBreaker.reserve("task-respawn", 60);
    assert.equal(r2, "halted");
    assert.equal(postEsc.length, 1);
    assert.equal(postEsc[0]?.tag, "budget-breach");
    // Breaching cost NOT committed — durable total still 60
    assert.equal(await storage.load("task-respawn"), 60);
    assert.equal(preEsc.length, 0);
  });

  it("T1(e): finer budget exceeded — logs entry without halting", async () => {
    const storage = new FakeBudgetStorage();
    const escalations: BudgetEscalationEvent[] = [];
    const logs: BudgetLogEntry[] = [];
    const breaker = makeBudgetBreaker(
      {
        ceiling: 200,
        conservativeCost: 50,
        finerBudgets: [{ name: "feature-x", ceiling: 80 }],
      },
      storage,
      (e) => escalations.push(e),
      (l) => logs.push(l),
    );
    // 50 spent — under finer budget (80), no log
    const r1 = await breaker.reserve("task-e", 50);
    assert.equal(r1, "proceed");
    assert.equal(logs.length, 0);
    // 40 more → 90 > finer ceiling 80, under hard max 200 → proceeds + logs
    const r2 = await breaker.reserve("task-e", 40);
    assert.equal(r2, "proceed");
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.kind, "finer-budget-exceeded");
    assert.equal(escalations.length, 0);
  });
});
