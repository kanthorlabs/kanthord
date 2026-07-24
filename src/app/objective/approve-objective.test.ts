import { test } from "node:test";
import assert from "node:assert/strict";

import { ApproveObjective } from "./approve-objective.ts";
import type { Objective, Initiative } from "../../domain/initiative.ts";
import type { Event } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { LandingCASMismatchError } from "../../landing/port.ts";

const INIT_ID = "init-1";
const HOME_DIR = "/home/repo.git";
const CLONE_DIR = "/clone/init-1";
const REF = `refs/heads/kanthord/init/${INIT_ID}`;

class FakeUow implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

class FakeFeed implements EventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    this.events.push(event);
  }
  readAfter(): Event[] {
    return [];
  }
}

interface FakeStoreOpts {
  objective: Objective | undefined;
  initiative?: Initiative;
}

class FakeStore {
  #objective: Objective | undefined;
  #initiative: Initiative | undefined;
  #siblings: Objective[];
  savedObjectives: Objective[] = [];
  savedInitiatives: Initiative[] = [];

  constructor(opts: FakeStoreOpts & { siblings?: Objective[] }) {
    this.#objective = opts.objective;
    this.#initiative = opts.initiative;
    this.#siblings = opts.siblings ?? (opts.objective ? [opts.objective] : []);
  }

  getObjective(id: string): Objective | undefined {
    if (this.savedObjectives.length > 0) {
      const last = this.savedObjectives[this.savedObjectives.length - 1]!;
      if (last.id === id) return last;
    }
    return this.#objective?.id === id ? this.#objective : undefined;
  }

  saveObjective(objective: Objective): void {
    this.savedObjectives.push(objective);
  }

  listObjectives(initiativeId: string): Objective[] {
    if (
      this.#initiative === undefined ||
      this.#initiative.id !== initiativeId
    ) {
      return [];
    }
    return this.#siblings.map((o) => {
      const saved = [...this.savedObjectives]
        .reverse()
        .find((s) => s.id === o.id);
      return saved ?? o;
    });
  }

  getInitiative(initiativeId: string): Initiative | undefined {
    if (this.#initiative?.id !== initiativeId) return undefined;
    const savedInitiative = [...this.savedInitiatives]
      .reverse()
      .find((i) => i.id === initiativeId);
    return savedInitiative ?? this.#initiative;
  }

  saveInitiative(initiative: Initiative): void {
    this.savedInitiatives.push(initiative);
  }

  resolveHomeDir(_initiativeId: string): string {
    return HOME_DIR;
  }
}

class FakeBroker {
  fetchCalls: { homeDir: string; clonePath: string; oid: string }[] = [];
  countSinceCalls: { homeDir: string; parentOid: string; oid: string }[] = [];
  casCalls: {
    homeDir: string;
    ref: string;
    oid: string;
    expectedOld: string;
  }[] = [];
  countSinceResult = 1;

  async fetch(homeDir: string, clonePath: string, oid: string): Promise<void> {
    this.fetchCalls.push({ homeDir, clonePath, oid });
  }

  async countCommitsSince(
    homeDir: string,
    parentOid: string,
    oid: string,
  ): Promise<number> {
    this.countSinceCalls.push({ homeDir, parentOid, oid });
    return this.countSinceResult;
  }

  async casUpdateRef(
    homeDir: string,
    ref: string,
    oid: string,
    expectedOld: string,
  ): Promise<void> {
    this.casCalls.push({ homeDir, ref, oid, expectedOld });
  }
}

function baseObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    id: "obj-1",
    initiativeId: INIT_ID,
    name: "O",
    status: "awaiting_confirmation",
    commitOid: "COMMIT_OID",
    parentOid: "PARENT_OID",
    ...overrides,
  };
}

function baseInitiative(overrides: Partial<Initiative> = {}): Initiative {
  return {
    id: INIT_ID,
    projectId: "proj-1",
    name: "I",
    status: "building",
    workspace: CLONE_DIR,
    ...overrides,
  };
}

test("execute throws UnknownReferenceError('objective', id) when the objective does not exist", async () => {
  const store = new FakeStore({ objective: undefined });
  const broker = new FakeBroker();
  const useCase = new ApproveObjective(
    store,
    broker,
    new FakeFeed(),
    new FakeUow(),
  );

  await assert.rejects(
    () => useCase.execute({ objectiveId: "missing" }),
    (err: unknown) =>
      err instanceof UnknownReferenceError &&
      err.kind === "objective" &&
      err.id === "missing",
  );
});

test("execute throws when the objective is not awaiting_confirmation", async () => {
  const objective = baseObjective({ status: "building" });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  const useCase = new ApproveObjective(
    store,
    broker,
    new FakeFeed(),
    new FakeUow(),
  );

  await assert.rejects(() => useCase.execute({ objectiveId: "obj-1" }));
  assert.equal(
    broker.fetchCalls.length,
    0,
    "must not touch git before validating status",
  );
});

test("execute is a no-op success when the objective is already integrated", async () => {
  const objective = baseObjective({ status: "integrated" });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1" });

  assert.equal(
    broker.fetchCalls.length,
    0,
    "already-integrated must not re-broker",
  );
  assert.equal(
    store.savedObjectives.length,
    0,
    "already-integrated must not re-save",
  );
  assert.equal(
    feed.events.length,
    0,
    "already-integrated must not re-append the integrated event",
  );
});

test("execute happy path: fetches the objective commit, validates exactly one commit ahead of the recorded parent, CAS-advances the initiative branch in home, and records integrated", async () => {
  const objective = baseObjective();
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1" });

  assert.deepEqual(broker.fetchCalls, [
    { homeDir: HOME_DIR, clonePath: CLONE_DIR, oid: "COMMIT_OID" },
  ]);
  assert.deepEqual(broker.countSinceCalls, [
    { homeDir: HOME_DIR, parentOid: "PARENT_OID", oid: "COMMIT_OID" },
  ]);
  assert.deepEqual(broker.casCalls, [
    {
      homeDir: HOME_DIR,
      ref: REF,
      oid: "COMMIT_OID",
      expectedOld: "PARENT_OID",
    },
  ]);

  assert.equal(store.savedObjectives.length, 1);
  assert.equal(store.savedObjectives[0]?.status, "integrated");

  const integratedEvent = feed.events.find(
    (e) => e.type === "objective.integrated",
  );
  assert.ok(integratedEvent, "must append an objective.integrated event");
  assert.equal(integratedEvent?.objectiveId, "obj-1");
});

test("execute moves the objective to conflict (no CAS attempt) when more than one commit was fetched since the recorded parent", async () => {
  const objective = baseObjective();
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  broker.countSinceResult = 2;
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1" });

  assert.equal(
    broker.casCalls.length,
    0,
    "must not CAS-advance home when the fetch validated more than one commit",
  );
  assert.equal(store.savedObjectives.length, 1);
  assert.equal(store.savedObjectives[0]?.status, "conflict");

  const conflictEvent = feed.events.find(
    (e) => e.type === "objective.conflict",
  );
  assert.ok(conflictEvent, "must append an objective.conflict event");
  assert.equal(conflictEvent?.objectiveId, "obj-1");
});

test("execute transitions the initiative to awaiting_pr and appends initiative.awaiting_pr when this was the last building objective to integrate (Story F delivery hook)", async () => {
  const objA = baseObjective({ id: "obj-a", status: "integrated" });
  const objB = baseObjective({ id: "obj-b" });
  const store = new FakeStore({
    objective: objB,
    initiative: baseInitiative(),
    siblings: [objA, objB],
  });
  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-b" });

  assert.equal(
    store.savedInitiatives.length,
    1,
    "must persist the initiative status transition",
  );
  assert.equal(store.savedInitiatives[0]?.status, "awaiting_pr");

  const awaitingPrEvent = feed.events.find(
    (e) => e.type === "initiative.awaiting_pr",
  );
  assert.ok(awaitingPrEvent, "must append an initiative.awaiting_pr event");
});

test("execute does NOT transition the initiative when another sibling objective is still building (delivery hook only fires when ALL objectives are integrated)", async () => {
  const objA = baseObjective({ id: "obj-a", status: "building" });
  const objB = baseObjective({ id: "obj-b" });
  const store = new FakeStore({
    objective: objB,
    initiative: baseInitiative(),
    siblings: [objA, objB],
  });
  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-b" });

  assert.equal(
    store.savedInitiatives.length,
    0,
    "must not touch initiative status while a sibling objective is still building",
  );
  assert.equal(
    feed.events.some((e) => e.type === "initiative.awaiting_pr"),
    false,
  );
});

test("execute moves the objective to conflict when the CAS ref-advance rejects a stale parent (home branch moved)", async () => {
  const objective = baseObjective();
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  broker.casUpdateRef = async () => {
    throw new LandingCASMismatchError("SOME_OTHER_OID");
  };
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1" });

  assert.equal(store.savedObjectives.length, 1);
  assert.equal(store.savedObjectives[0]?.status, "conflict");

  const conflictEvent = feed.events.find(
    (e) => e.type === "objective.conflict",
  );
  assert.ok(conflictEvent, "must append an objective.conflict event");
  assert.equal(conflictEvent?.objectiveId, "obj-1");
});
