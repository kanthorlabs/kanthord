import { test } from "node:test";
import assert from "node:assert/strict";

import { ApproveObjective } from "./approve-objective.ts";
import { StaleCandidateError } from "../../domain/initiative.ts";
import type { Objective, Initiative } from "../../domain/initiative.ts";
import type { Event } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import { UnknownReferenceError } from "../errors.ts";
import { ObjectiveNotAwaitingConfirmationError } from "../errors.ts";
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
    paused: false,
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
    () =>
      useCase.execute({ objectiveId: "missing", expectedCommit: "COMMIT_OID" }),
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

  await assert.rejects(() =>
    useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" }),
  );
  assert.equal(
    broker.fetchCalls.length,
    0,
    "must not touch git before validating status",
  );
});

test("execute throws ObjectiveNotAwaitingConfirmationError (not a silent no-op) when the objective is already integrated (Story 03 A)", async () => {
  const objective = baseObjective({ status: "integrated" });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await assert.rejects(
    () =>
      useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" }),
    (err: unknown) =>
      err instanceof ObjectiveNotAwaitingConfirmationError &&
      err.status === "integrated",
  );

  assert.equal(
    broker.fetchCalls.length,
    0,
    "already-integrated must not touch git before reporting the conflict",
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

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" });

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

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" });

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

test("execute transitions the initiative to landed and appends initiative.landed when this was the last building objective to integrate (Story F delivery hook)", async () => {
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

  await useCase.execute({ objectiveId: "obj-b", expectedCommit: "COMMIT_OID" });

  assert.equal(
    store.savedInitiatives.length,
    1,
    "must persist the initiative status transition",
  );
  assert.equal(store.savedInitiatives[0]?.status, "landed");

  const landedEvent = feed.events.find((e) => e.type === "initiative.landed");
  assert.ok(landedEvent, "must append an initiative.landed event");
  assert.equal(
    feed.events.some((e) => (e.type as string) === "initiative.awaiting_pr"),
    false,
    "must never append the removed initiative.awaiting_pr event",
  );
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

  await useCase.execute({ objectiveId: "obj-b", expectedCommit: "COMMIT_OID" });

  assert.equal(
    store.savedInitiatives.length,
    0,
    "must not touch initiative status while a sibling objective is still building",
  );
  assert.equal(
    feed.events.some((e) => e.type === "initiative.landed"),
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

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" });

  assert.equal(store.savedObjectives.length, 1);
  assert.equal(store.savedObjectives[0]?.status, "conflict");

  const conflictEvent = feed.events.find(
    (e) => e.type === "objective.conflict",
  );
  assert.ok(conflictEvent, "must append an objective.conflict event");
  assert.equal(conflictEvent?.objectiveId, "obj-1");
});

// e2e 20260727-141944 — an objective whose tasks left no net diff carries
// commitOid === parentOid (squashObjective reports the parent rather than
// creating an empty commit). Counting commits since the parent yields 0, so the
// commitCount !== 1 branch recorded a conflict; `retry objective` re-squashed to
// the same empty result and the run livelocked until the round budget ran out.
test("execute integrates an empty objective (commitOid === parentOid) as a no-op instead of recording a conflict", async () => {
  const objective = baseObjective({
    commitOid: "SAME_OID",
    parentOid: "SAME_OID",
  });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  broker.countSinceResult = 0;
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "SAME_OID" });

  assert.equal(store.savedObjectives.length, 1);
  assert.equal(
    store.savedObjectives[0]?.status,
    "integrated",
    "an empty objective integrates; it must never land in conflict",
  );
  assert.ok(
    feed.events.some((e) => e.type === "objective.integrated"),
    "must append objective.integrated",
  );
  assert.equal(
    feed.events.some((e) => e.type === "objective.conflict"),
    false,
    "must NOT append objective.conflict",
  );

  // Nothing to move: the branch already points at that oid.
  assert.deepEqual(broker.fetchCalls, [], "no fetch for an empty objective");
  assert.deepEqual(
    broker.casCalls,
    [],
    "no ref advance for an empty objective",
  );
});

test("execute lands the initiative when the last objective is an empty no-op", async () => {
  const done = baseObjective({ id: "obj-0", status: "integrated" });
  const empty = baseObjective({
    id: "obj-1",
    commitOid: "SAME_OID",
    parentOid: "SAME_OID",
  });
  const store = new FakeStore({
    objective: empty,
    initiative: baseInitiative(),
    siblings: [done, empty],
  });
  const broker = new FakeBroker();
  broker.countSinceResult = 0;
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "SAME_OID" });

  assert.equal(store.savedInitiatives.at(-1)?.status, "landed");
  assert.ok(
    feed.events.some((e) => e.type === "initiative.landed"),
    "the initiative must land even though the last objective added nothing",
  );
});

// ---------------------------------------------------------------------------
// Story 1 (017) — persist the objective conflict cause, not just the status.
// ---------------------------------------------------------------------------

test("(017-S1-cause-non-single-commit) execute records conflictCause 'non-single-commit' and no observedTipOid when more than one commit was fetched since the recorded parent", async () => {
  const objective = baseObjective();
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  broker.countSinceResult = 2;
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" });

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(saved.status, "conflict");
  assert.equal(saved.conflictCause, "non-single-commit");
  assert.equal(
    "observedTipOid" in saved,
    false,
    "no observed tip is read on the commitCount path, so none must be invented",
  );
});

test("(017-S1-cause-cas-mismatch) execute records conflictCause 'cas-mismatch' and observedTipOid from LandingCASMismatchError.newTargetOID", async () => {
  const objective = baseObjective();
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  broker.casUpdateRef = async () => {
    throw new LandingCASMismatchError("abc123");
  };
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" });

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(saved.status, "conflict");
  assert.equal(saved.conflictCause, "cas-mismatch");
  assert.equal(saved.observedTipOid, "abc123");
});

test("(017-S1-integrated-no-cause) the happy path leaves conflictCause and observedTipOid absent", async () => {
  const objective = baseObjective();
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" });

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(saved.status, "integrated");
  assert.equal("conflictCause" in saved, false);
  assert.equal("observedTipOid" in saved, false);
});

test("(017-S1-stale-reason-dropped) an objective carrying a conflictReason from an earlier gate run, driven into a new conflict, has no conflictReason key", async () => {
  const objective = baseObjective({ conflictReason: "old gate failure" });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FakeBroker();
  broker.countSinceResult = 2;
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await useCase.execute({ objectiveId: "obj-1", expectedCommit: "COMMIT_OID" });

  assert.equal(store.savedObjectives.length, 1);
  const saved = store.savedObjectives[0]!;
  assert.equal(saved.status, "conflict");
  assert.equal(
    "conflictReason" in saved,
    false,
    "a stale reason from an earlier gate run must not attach to this ref-update failure",
  );
});

// ---------------------------------------------------------------------------
// Story 4 (012) — Required `--expected-commit` on objective verdicts.
//
// (a) the early guard runs BEFORE any broker call (SQLite cannot roll back a
//     moved ref, so the refusal must be cheaper than git work).
// (b) the in-transaction re-check fires when the persisted commitOid changes
//     between the early guard and the write transaction.
// (c) a matching `expectedCommit` integrates even when the store still
//     diverges on later reads (interleaving reads return the same oid).
// (d) the empty-objective shortcut (`commitOid === parentOid`) is reached
//     only AFTER the early guard; a stale `expectedCommit` is still refused.
// ---------------------------------------------------------------------------

class FailIfCalledBroker {
  async fetch(
    _homeDir: string,
    _clonePath: string,
    _oid: string,
  ): Promise<void> {
    throw new Error("broker reached: fetch");
  }
  async countCommitsSince(
    _homeDir: string,
    _parentOid: string,
    _oid: string,
  ): Promise<number> {
    throw new Error("broker reached: countCommitsSince");
  }
  async casUpdateRef(
    _homeDir: string,
    _ref: string,
    _oid: string,
    _expectedOld: string,
  ): Promise<void> {
    throw new Error("broker reached: casUpdateRef");
  }
}

test("execute stale approve (a): FailIfCalledBroker is never reached; rejects with StaleCandidateError; no save; no event", async () => {
  const objective = baseObjective(); // commitOid: "COMMIT_OID"
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FailIfCalledBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await assert.rejects(
    () =>
      useCase.execute({
        objectiveId: "obj-1",
        expectedCommit: "0".repeat(40),
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}: ${(err as Error).message}`,
      );
      assert.equal(err.name, "StaleCandidateError");
      return true;
    },
  );

  assert.equal(
    store.savedObjectives.length,
    0,
    "stale approve must not save the objective",
  );
  assert.equal(
    feed.events.length,
    0,
    "stale approve must not append objective.integrated or objective.conflict",
  );
});

test("execute stale approve on the empty-objective shortcut (d): commitOid === parentOid; stale expectedCommit is still refused before the shortcut integrates", async () => {
  const objective = baseObjective({
    commitOid: "SAME_OID",
    parentOid: "SAME_OID",
  });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  const broker = new FailIfCalledBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await assert.rejects(
    () =>
      useCase.execute({
        objectiveId: "obj-1",
        expectedCommit: "0".repeat(40),
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
  );

  assert.equal(
    store.savedObjectives.length,
    0,
    "stale approve must not save even when the empty shortcut would otherwise integrate",
  );
  assert.equal(
    feed.events.length,
    0,
    "stale approve must not append any event",
  );
});

test("execute stale approve (b): in-transaction interleaving — early guard sees 'AAA', the uow re-check sees 'BBB'; rejects with StaleCandidateError; no save; no event", async () => {
  const objective = baseObjective({ commitOid: "AAA" });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  // Override getObjective: first call returns the reviewed oid ("AAA"), every
  // later call returns the persisted oid after a concurrent writer moved it
  // ("BBB"). The early guard (outside the transaction) is the first call, so
  // it passes; the uow re-check (inside the transaction) is the second call,
  // so it must throw.
  let callIndex = 0;
  const originalGet = store.getObjective.bind(store);
  store.getObjective = (id: string) => {
    callIndex += 1;
    if (callIndex === 1) {
      return baseObjective({ commitOid: "AAA" });
    }
    return baseObjective({ commitOid: "BBB" });
  };
  // Touch `originalGet` to satisfy "no unused" lint without changing the
  // override contract (keeps the original signature available if a future
  // assertion needs it).
  void originalGet;

  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  await assert.rejects(
    () => useCase.execute({ objectiveId: "obj-1", expectedCommit: "AAA" }),
    (err: unknown) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
  );

  assert.equal(
    store.savedObjectives.length,
    0,
    "interleaved stale approve must not save",
  );
  assert.equal(
    feed.events.some((e) => e.type === "objective.integrated"),
    false,
    "interleaved stale approve must not append objective.integrated",
  );
  assert.equal(
    feed.events.some((e) => e.type === "initiative.landed"),
    false,
    "interleaved stale approve must not append initiative.landed",
  );
});

test("execute matching approve (c): interleaving reads return 'AAA' on every call; integrates and appends objective.integrated", async () => {
  const objective = baseObjective({ commitOid: "AAA" });
  const store = new FakeStore({
    objective,
    initiative: baseInitiative(),
  });
  store.getObjective = (id: string) => baseObjective({ commitOid: "AAA" });

  const broker = new FakeBroker();
  const feed = new FakeFeed();
  const useCase = new ApproveObjective(store, broker, feed, new FakeUow());

  const result = await useCase.execute({
    objectiveId: "obj-1",
    expectedCommit: "AAA",
  });

  assert.deepEqual(result, { outcome: "integrated" });
  assert.equal(store.savedObjectives.length, 1);
  assert.equal(store.savedObjectives[0]?.status, "integrated");
  assert.ok(
    feed.events.some((e) => e.type === "objective.integrated"),
    "must append objective.integrated",
  );
});
