import test from "node:test";
import assert from "node:assert/strict";
import {
  projectDecisions,
  rankDecisions,
  type QueueProjectInput,
  type QueueTaskInput,
  type QueueObjectiveInput,
  type QueueInitiativeInput,
  type DecisionItem,
} from "./decision-queue.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function task(
  id: string,
  objectiveId: string,
  status: QueueTaskInput["status"],
  dependencies: string[] = [],
): QueueTaskInput {
  return { id, title: id, objectiveId, status, dependencies };
}

function objective(
  id: string,
  initiativeId: string,
  status?: QueueObjectiveInput["status"],
  commitOid?: string,
): QueueObjectiveInput {
  return {
    id,
    name: id,
    initiativeId,
    ...(status !== undefined ? { status } : {}),
    ...(commitOid !== undefined ? { commitOid } : {}),
  };
}

function initiative(
  id: string,
  projectId: string,
  opts: {
    status?: QueueInitiativeInput["status"];
    paused?: boolean;
    publication?: QueueInitiativeInput["publication"];
  } = {},
): QueueInitiativeInput {
  return {
    id,
    name: id,
    projectId,
    paused: opts.paused ?? false,
    publication: opts.publication ?? null,
    ...(opts.status !== undefined ? { status: opts.status } : {}),
  };
}

function baseProject(
  overrides: Partial<QueueProjectInput> = {},
): QueueProjectInput {
  return {
    projectId: "p1",
    projectName: "Project One",
    tasks: [],
    objectives: [],
    initiatives: [],
    actionableEventIds: new Map(),
    evidence: new Map(),
    candidateTaskIds: new Set(),
    ...overrides,
  } as QueueProjectInput;
}

function item(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    verdicts: [],
    kindLabel: "operational-failure",
    projectId: "p1",
    projectName: "Project One",
    initiativeId: "i1",
    downstream: 0,
    actionableSince: null,
    evidence: {
      basis: "verification-and-summary",
      diffAvailable: false,
      inspect: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// projectDecisions — which elements become items
// ---------------------------------------------------------------------------

test("(017-S5-one-item-per-element) one failed task, one conflict objective, one awaiting_confirmation objective, one publishable initiative -> exactly four items with the expected kindLabels, in element order", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "failed")],
    objectives: [
      objective("o1", "i1", "building"),
      objective("o2", "i1", "conflict"),
      objective("o3", "i1", "awaiting_confirmation"),
    ],
    initiatives: [
      initiative("i1", "p1", { status: "building" }),
      initiative("i2", "p1", {
        status: "landed",
        publication: {
          repositoryId: "r1",
          branch: "main",
          state: "unpublished",
        },
      }),
    ],
  });

  const items = projectDecisions(input);
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((i) => i.kindLabel),
    [
      "operational-failure",
      "objective-conflict",
      "objective-candidate",
      "publication",
    ],
  );
});

test("(017-S5-completed-task-no-duplicate) an awaiting_confirmation objective with three completed tasks -> exactly one item, the objective's", () => {
  const input = baseProject({
    tasks: [
      task("t1", "o1", "completed"),
      task("t2", "o1", "completed"),
      task("t3", "o1", "completed"),
    ],
    objectives: [objective("o1", "i1", "awaiting_confirmation")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
  });

  const items = projectDecisions(input);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kindLabel, "objective-candidate");
  assert.equal(items[0]!.objectiveId, "o1");
});

// ---------------------------------------------------------------------------
// downstream
// ---------------------------------------------------------------------------

test("(017-S5-downstream-task) a failed root with four pending dependents -> downstream === 4", () => {
  const input = baseProject({
    tasks: [
      task("root", "o1", "failed"),
      task("d1", "o1", "pending", ["root"]),
      task("d2", "o1", "pending", ["root"]),
      task("d3", "o1", "pending", ["d1"]),
      task("d4", "o1", "pending", ["d2"]),
    ],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
  });

  const items = projectDecisions(input);
  const rootItem = items.find((i) => i.taskId === "root");
  assert.ok(rootItem, "expected an item for the root task");
  assert.equal(rootItem!.downstream, 4);
});

test("(017-S5-downstream-objective) an objective whose two tasks have three downstream dependents -> downstream counts each id once", () => {
  const input = baseProject({
    tasks: [
      task("a", "o1", "pending"),
      task("b", "o1", "pending"),
      task("c", "o2", "pending", ["a"]),
      task("d", "o2", "pending", ["b"]),
      task("e", "o2", "pending", ["c"]),
    ],
    objectives: [
      objective("o1", "i1", "conflict"),
      objective("o2", "i1", "building"),
    ],
    initiatives: [initiative("i1", "p1", { status: "building" })],
  });

  const items = projectDecisions(input);
  const objItem = items.find((i) => i.objectiveId === "o1");
  assert.ok(objItem, "expected an item for objective o1");
  // 2 own tasks (a, b) + 3 distinct external dependents (c, d, e), each counted once.
  assert.equal(objItem!.downstream, 5);
});

// ---------------------------------------------------------------------------
// evidence / inspect
// ---------------------------------------------------------------------------

test("(017-S5-inspect-structured) a valid homeDir + two valid OIDs -> inspect.executable === 'git' and args deep-equals the -C diff command", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "failed")],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
    evidence: new Map([
      ["t1", { homeDir: "/home/x", baseOid: "aaaaaaa", headOid: "bbbbbbb" }],
    ]),
  });

  const items = projectDecisions(input);
  const t1 = items.find((i) => i.taskId === "t1")!;
  assert.equal(t1.evidence.inspect?.executable, "git");
  assert.deepEqual(t1.evidence.inspect?.args, [
    "-C",
    "/home/x",
    "diff",
    "aaaaaaa..bbbbbbb",
  ]);
});

test("(017-S5-inspect-null) missing homeDir, missing baseOid, missing headOid, and a malformed OID each yield inspect === null", () => {
  function projectWithEvidence(evidence: {
    homeDir: string | null;
    baseOid: string | null;
    headOid: string | null;
  }) {
    return baseProject({
      tasks: [task("t1", "o1", "failed")],
      objectives: [objective("o1", "i1", "building")],
      initiatives: [initiative("i1", "p1", { status: "building" })],
      evidence: new Map([["t1", evidence]]),
    });
  }

  const cases: {
    homeDir: string | null;
    baseOid: string | null;
    headOid: string | null;
  }[] = [
    { homeDir: null, baseOid: "aaaaaaa", headOid: "bbbbbbb" },
    { homeDir: "/home/x", baseOid: null, headOid: "bbbbbbb" },
    { homeDir: "/home/x", baseOid: "aaaaaaa", headOid: null },
    { homeDir: "/home/x", baseOid: "not-an-oid", headOid: "bbbbbbb" },
  ];

  for (const c of cases) {
    const items = projectDecisions(projectWithEvidence(c));
    const t1 = items.find((i) => i.taskId === "t1")!;
    assert.equal(
      t1.evidence.inspect,
      null,
      `expected inspect null for evidence ${JSON.stringify(c)}`,
    );
  }
});

test("(017-S5-inspect-no-shell-string) inspect.args is a real array, never a joined shell string", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "failed")],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
    evidence: new Map([
      ["t1", { homeDir: "/home/x", baseOid: "aaaaaaa", headOid: "bbbbbbb" }],
    ]),
  });

  const items = projectDecisions(input);
  const t1 = items.find((i) => i.taskId === "t1")!;
  assert.equal(typeof t1.evidence.inspect, "object");
  assert.ok(Array.isArray(t1.evidence.inspect?.args));
});

test("(017-S5-diff-unavailable) every produced item has diffAvailable === false and basis === 'verification-and-summary'", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "failed")],
    objectives: [
      objective("o1", "i1", "building"),
      objective("o2", "i1", "conflict"),
      objective("o3", "i1", "awaiting_confirmation"),
    ],
    initiatives: [
      initiative("i1", "p1", { status: "building" }),
      initiative("i2", "p1", {
        status: "landed",
        publication: { repositoryId: "r1", branch: "main", state: "diverged" },
      }),
    ],
  });

  const items = projectDecisions(input);
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.equal(it.evidence.diffAvailable, false);
    assert.equal(it.evidence.basis, "verification-and-summary");
  }
});

// ---------------------------------------------------------------------------
// cause
// ---------------------------------------------------------------------------

test("(017-S5-cause-candidate) an awaiting_confirmation task whose id is in candidateTaskIds -> cause === 'candidate'", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "awaiting_confirmation")],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
    candidateTaskIds: new Set(["t1"]),
  });

  const items = projectDecisions(input);
  const t1 = items.find((i) => i.taskId === "t1")!;
  assert.equal(t1.cause, "candidate");
});

test("(017-S5-cause-escalation) an awaiting_confirmation task not in candidateTaskIds -> cause === 'escalation'", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "awaiting_confirmation")],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
    candidateTaskIds: new Set(),
  });

  const items = projectDecisions(input);
  const t1 = items.find((i) => i.taskId === "t1")!;
  assert.equal(t1.cause, "escalation");
});

test("(017-S5-cause-absent-other-kinds) a failed task item and an objective item each have no cause key", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "failed")],
    objectives: [
      objective("o1", "i1", "building"),
      objective("o2", "i1", "conflict"),
    ],
    initiatives: [initiative("i1", "p1", { status: "building" })],
  });

  const items = projectDecisions(input);
  const t1 = items.find((i) => i.taskId === "t1")!;
  const o2 = items.find((i) => i.objectiveId === "o2")!;
  assert.equal("cause" in t1, false);
  assert.equal("cause" in o2, false);
});

test("(017-S5-cause-same-verdicts) both causes produce deepEqual verdicts, proving cause never enters decisionActions", () => {
  const candidateInput = baseProject({
    tasks: [task("t1", "o1", "awaiting_confirmation")],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
    candidateTaskIds: new Set(["t1"]),
  });
  const escalationInput = baseProject({
    tasks: [task("t1", "o1", "awaiting_confirmation")],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
    candidateTaskIds: new Set(),
  });

  const candidateItem = projectDecisions(candidateInput).find(
    (i) => i.taskId === "t1",
  )!;
  const escalationItem = projectDecisions(escalationInput).find(
    (i) => i.taskId === "t1",
  )!;

  assert.equal(candidateItem.cause, "candidate");
  assert.equal(escalationItem.cause, "escalation");
  assert.deepEqual(candidateItem.verdicts, escalationItem.verdicts);
});

test("(017-S5-candidate-actionable-since-null) a cause:'candidate' item with no actionableEventIds entry -> actionableSince === null, and it sorts after an equal-downstream item that has one", () => {
  const input = baseProject({
    tasks: [task("t1", "o1", "awaiting_confirmation")],
    objectives: [objective("o1", "i1", "building")],
    initiatives: [initiative("i1", "p1", { status: "building" })],
    candidateTaskIds: new Set(["t1"]),
  });

  const candidateItem = projectDecisions(input).find((i) => i.taskId === "t1")!;
  assert.equal(candidateItem.cause, "candidate");
  assert.equal(candidateItem.actionableSince, null);

  const otherItem = item({
    kindLabel: "operational-failure",
    taskId: "other",
    downstream: candidateItem.downstream,
    actionableSince: 12345,
  });

  const ranked = rankDecisions([candidateItem, otherItem]);
  assert.deepEqual(
    ranked.map((i) => i.taskId),
    ["other", "t1"],
  );
});

// ---------------------------------------------------------------------------
// expectedCommit
// ---------------------------------------------------------------------------

test("(017-S5-expected-commit) an objective with commitOid has expectedCommit equal to it; without commitOid the key is absent", () => {
  const input = baseProject({
    objectives: [
      objective("o1", "i1", "conflict", "abc123"),
      objective("o2", "i1", "awaiting_confirmation"),
    ],
    initiatives: [initiative("i1", "p1", { status: "building" })],
  });

  const items = projectDecisions(input);
  const o1 = items.find((i) => i.objectiveId === "o1")!;
  const o2 = items.find((i) => i.objectiveId === "o2")!;
  assert.equal(o1.expectedCommit, "abc123");
  assert.equal("expectedCommit" in o2, false);
});

// ---------------------------------------------------------------------------
// rankDecisions — pure ranking over plain DecisionItem fixtures
// ---------------------------------------------------------------------------

test("(017-S5-actionable-since) ranking uses actionableSince, not task-id recency", () => {
  // itemOld has the numerically earlier (older) actionableSince timestamp;
  // itemNew has the later one. Their task ids are deliberately the opposite
  // of what a (wrong) id-based ordering would produce.
  const itemOld = item({ taskId: "zzz-newer-id", actionableSince: 1_000 });
  const itemNew = item({ taskId: "aaa-older-id", actionableSince: 9_000 });

  const ranked = rankDecisions([itemNew, itemOld]);
  assert.deepEqual(
    ranked.map((i) => i.taskId),
    ["zzz-newer-id", "aaa-older-id"],
    "the item with the earlier actionableSince must rank first regardless of task id",
  );
});

test("(017-S5-actionable-since-null-last) an item with no actionableSince sorts last among equal downstream", () => {
  const withTime = item({ taskId: "a", actionableSince: 500 });
  const withoutTime = item({ taskId: "b", actionableSince: null });

  const ranked = rankDecisions([withoutTime, withTime]);
  assert.deepEqual(
    ranked.map((i) => i.taskId),
    ["a", "b"],
  );
});

test("(017-S5-rank-order) downstream desc, then actionableSince asc, then id asc — one deliberate tie at each level", () => {
  const items: DecisionItem[] = [
    item({ taskId: "high", downstream: 10, actionableSince: 100 }),
    item({ taskId: "mid-late", downstream: 3, actionableSince: 200 }),
    item({ taskId: "mid-early", downstream: 3, actionableSince: 100 }),
    item({ taskId: "low-b", downstream: 1, actionableSince: 50 }),
    item({ taskId: "low-a", downstream: 1, actionableSince: 50 }),
  ];

  const ranked = rankDecisions(items);
  assert.deepEqual(
    ranked.map((i) => i.taskId),
    ["high", "mid-early", "mid-late", "low-a", "low-b"],
  );
});

test("(017-S5-kind-not-a-sort-key) a publication item with downstream:5 outranks an objective-candidate with downstream:1", () => {
  const publicationItem = item({
    kindLabel: "publication",
    initiativeId: "i1",
    downstream: 5,
  });
  const objectiveCandidateItem = item({
    kindLabel: "objective-candidate",
    objectiveId: "o1",
    downstream: 1,
  });

  const ranked = rankDecisions([objectiveCandidateItem, publicationItem]);
  assert.equal(ranked[0]!.kindLabel, "publication");
  assert.equal(ranked[1]!.kindLabel, "objective-candidate");
});

test("(017-S5-rank-pure) rankDecisions does not mutate its argument and is idempotent", () => {
  const items: DecisionItem[] = [
    item({ taskId: "a", downstream: 1 }),
    item({ taskId: "b", downstream: 5 }),
    item({ taskId: "c", downstream: 3 }),
  ];
  const clone = structuredClone(items);

  const ranked = rankDecisions(items);
  assert.deepEqual(items, clone, "the input array/items must not be mutated");

  const rankedTwice = rankDecisions(ranked);
  assert.deepEqual(
    rankedTwice.map((i) => i.taskId),
    ranked.map((i) => i.taskId),
    "ranking an already-ranked list must be idempotent",
  );
});

// ---------------------------------------------------------------------------
// Review blocker S5 — a task whose objective row is missing must never
// surface `initiativeId: ""` in the public queue contract: an empty string is
// indistinguishable from a real (if oddly-named) id, so a consumer cannot
// tell "unknown" from "empty". The item must either be skipped, or carry an
// explicitly nullable/absent initiativeId — never "".
// ---------------------------------------------------------------------------

test("(017-S5-missing-objective-no-empty-initiative-id) a failed task whose objectiveId names no row in `objectives` never yields initiativeId === '' in the queue output", () => {
  const input = baseProject({
    tasks: [task("t1", "missing-objective", "failed")],
    objectives: [],
    initiatives: [],
  });

  const items = projectDecisions(input);
  const orphanItem = items.find((i) => i.taskId === "t1");

  assert.ok(
    orphanItem === undefined || orphanItem.initiativeId !== "",
    `a task with no matching objective must either be skipped from the queue, or carry a non-empty/nullable initiativeId — never the empty string a real id could also be; got: ${JSON.stringify(orphanItem)}`,
  );
});
