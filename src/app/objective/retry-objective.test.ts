import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RetryObjective,
  ObjectiveNotRetryableError,
} from "./retry-objective.ts";
import type { Objective, Initiative } from "../../domain/initiative.ts";
import { newEvent } from "../../domain/event.ts";
import type { Event } from "../../domain/event.ts";
import { UnknownReferenceError } from "../errors.ts";

// ---------------------------------------------------------------------------
// Narrow interface the use case depends on
// ---------------------------------------------------------------------------

interface ObjectiveStore {
  getObjective(id: string): Objective | undefined;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveObjective(objective: Objective): void;
  resolveHomeDir(initiativeId: string): string;
}

// ---------------------------------------------------------------------------
// Fake
// ---------------------------------------------------------------------------

class FakeObjectiveStore implements ObjectiveStore {
  readonly #objectives: Objective[];
  readonly #initiative: Initiative | undefined;
  readonly savedObjectives: Objective[] = [];

  constructor(objectives: Objective[], initiative?: Initiative) {
    this.#objectives = objectives;
    this.#initiative = initiative;
  }

  getObjective(id: string): Objective | undefined {
    return this.#objectives.find((o) => o.id === id);
  }

  listObjectives(initiativeId: string): Objective[] {
    return this.#objectives.filter((o) => o.initiativeId === initiativeId);
  }

  getInitiative(_initiativeId: string): Initiative | undefined {
    return this.#initiative;
  }

  saveObjective(objective: Objective): void {
    this.savedObjectives.push(objective);
  }

  resolveHomeDir(_initiativeId: string): string {
    return "/home/init-1.git";
  }
}

class FakeBroker {
  readonly currentTipCalls: Array<{ homeDir: string; ref: string }> = [];
  readonly #tip: string;

  constructor(tip: string) {
    this.#tip = tip;
  }

  async currentTip(homeDir: string, ref: string): Promise<string> {
    this.currentTipCalls.push({ homeDir, ref });
    return this.#tip;
  }
}

class FakeSquasher {
  readonly calls: Array<{ dir: string; parentOid: string; message: string }> =
    [];
  readonly #oid: string;

  constructor(oid: string) {
    this.#oid = oid;
  }

  async squashObjective(
    dir: string,
    parentOid: string,
    message: string,
  ): Promise<{ oid: string }> {
    this.calls.push({ dir, parentOid, message });
    return { oid: this.#oid };
  }
}

class FakeGate {
  readonly calls: string[] = [];
  readonly #result: { passed: boolean; reason?: string };

  constructor(result: { passed: boolean; reason?: string }) {
    this.#result = result;
  }

  async verify(dir: string): Promise<{ passed: boolean; reason?: string }> {
    this.calls.push(dir);
    return this.#result;
  }
}

class RecordingEventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    this.events.push(event);
  }
}

const noopUow = { transaction: <T>(fn: () => T): T => fn() };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("execute throws UnknownReferenceError('objective', id) when the objective does not exist", async () => {
  const store = new FakeObjectiveStore([]);
  const useCase = new RetryObjective(store);

  await assert.rejects(
    () => useCase.execute({ objectiveId: "missing-obj" }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      assert.equal(err.kind, "objective");
      assert.equal(err.id, "missing-obj");
      return true;
    },
  );
});

test("execute refuses retry on a non-tip integrated objective, guiding to a corrective objective or restart", async () => {
  // OBJ_A integrated first, OBJ_B integrated after it (tip) — mirrors the
  // epic Proof's Story D scenario: `retry objective --id $OBJ_A` after both
  // objectives have already been brokered into the initiative branch.
  const OBJ_A: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "integrated",
  };
  const OBJ_B: Objective = {
    id: "obj-b",
    initiativeId: "init-1",
    name: "frontend",
    status: "integrated",
  };
  const store = new FakeObjectiveStore([OBJ_A, OBJ_B]);
  const useCase = new RetryObjective(store);

  await assert.rejects(
    () => useCase.execute({ objectiveId: OBJ_A.id }),
    (err: unknown) => {
      assert.ok(err instanceof ObjectiveNotRetryableError);
      assert.match(
        err.message,
        /non-tip|corrective|restart|not rewritable|already integrated/i,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Story E — conflict resolution: re-squash onto the current initiative tip,
// re-run the verification gate in the clone, and only return the objective to
// `awaiting_confirmation` when the gate passes (fail → stays `conflict` with a
// recorded reason).
// ---------------------------------------------------------------------------

test("execute resolves a conflict objective when the gate passes: re-squashes onto the current tip, records the new commitOid/parentOid, and transitions to awaiting_confirmation", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "STALE_OID",
    parentOid: "OLD_TIP",
  };
  const store = new FakeObjectiveStore([OBJ], initiative);
  const broker = new FakeBroker("NEW_TIP");
  const squasher = new FakeSquasher("RESQUASHED_OID");
  const gate = new FakeGate({ passed: true });
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await useCase.execute({ objectiveId: OBJ.id });

  assert.equal(
    broker.currentTipCalls.length,
    1,
    "must read the current initiative tip in home",
  );
  assert.deepEqual(squasher.calls, [
    {
      dir: "/clones/init-1",
      parentOid: "NEW_TIP",
      message: squasher.calls[0]!.message,
    },
  ]);
  assert.deepEqual(
    gate.calls,
    ["/clones/init-1"],
    "gate must run in the clone",
  );

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(saved.status, "awaiting_confirmation");
  assert.equal(saved.commitOid, "RESQUASHED_OID");
  assert.equal(saved.parentOid, "NEW_TIP");

  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0]!.type, "objective.awaiting_confirmation");
});

test("execute resolves a conflict objective when the gate fails: stays conflict, records the failure reason, does not transition", async () => {
  const initiative: Initiative = {
    id: "init-1",
    projectId: "proj-1",
    name: "init",
    status: "building",
    workspace: "/clones/init-1",
  };
  const OBJ: Objective = {
    id: "obj-a",
    initiativeId: "init-1",
    name: "backend",
    status: "conflict",
    commitOid: "STALE_OID",
    parentOid: "OLD_TIP",
  };
  const store = new FakeObjectiveStore([OBJ], initiative);
  const broker = new FakeBroker("NEW_TIP");
  const squasher = new FakeSquasher("RESQUASHED_OID");
  const gate = new FakeGate({ passed: false, reason: "tests failed: 2 red" });
  const feed = new RecordingEventFeed();
  const useCase = new RetryObjective(
    store,
    broker,
    squasher,
    gate,
    feed,
    noopUow,
  );

  await useCase.execute({ objectiveId: OBJ.id });

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(
    saved.status,
    "conflict",
    "must stay conflict when the gate fails",
  );
  assert.equal(saved.conflictReason, "tests failed: 2 red");

  assert.equal(
    feed.events.some((e) => e.type === "objective.awaiting_confirmation"),
    false,
    "must not surface awaiting_confirmation when the gate failed",
  );
});
