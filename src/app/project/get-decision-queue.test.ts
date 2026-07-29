import test from "node:test";
import assert from "node:assert/strict";
import { GetDecisionQueue } from "./get-decision-queue.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type {
  TaskResultRow,
  PublicationStateName,
} from "../../storage/port.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function task(
  overrides: Partial<Task> & { id: string; objectiveId: string },
): Task {
  return {
    title: "task",
    status: "pending",
    dependencies: [],
    ...overrides,
  } as Task;
}

function objective(
  overrides: Partial<Objective> & { id: string; initiativeId: string },
): Objective {
  return {
    name: "objective",
    ...overrides,
  } as Objective;
}

function initiative(
  overrides: Partial<Initiative> & { id: string; projectId: string },
): Initiative {
  return {
    name: "initiative",
    paused: false,
    ...overrides,
  } as Initiative;
}

interface ProjectFixture {
  id: string;
  name: string;
  initiatives: Initiative[];
  objectivesByInitiative: Map<string, Objective[]>;
  tasksByInitiative: Map<string, Task[]>;
}

interface CallCounters {
  activityCalls: number;
  candidateCalls: number;
}

/**
 * Builds the seven structural sources `GetDecisionQueue`'s constructor takes,
 * in the exact order pinned by Story 6 §A.2, from a flat list of project
 * fixtures plus optional publication/evidence/candidate maps. Every source
 * also carries `save`/`append`/`transaction` methods that throw, so a test
 * that reaches `execute()` without hitting them proves the use case is
 * read-only end to end.
 */
function buildSources(
  projects: ProjectFixture[],
  opts: {
    publications?: Map<
      string,
      { state: PublicationStateName; remoteOID: string | null }
    >;
    taskResults?: Map<string, TaskResultRow>;
    homeDirs?: Map<string, string>;
    initiativeRepos?: Map<string, string>;
    candidateTaskIds?: Set<string>;
    /** OIDs the commit-presence probe reports as NOT present in the home. */
    absentOids?: Set<string>;
  } = {},
) {
  const counters: CallCounters = { activityCalls: 0, candidateCalls: 0 };
  const poison = {
    save: () => {
      throw new Error("must not write");
    },
    append: () => {
      throw new Error("must not write");
    },
    transaction: () => {
      throw new Error("must not write");
    },
  };

  const projectSource = {
    ...poison,
    listProjects: () => projects.map((p) => ({ id: p.id, name: p.name })),
  };

  const initiativeSource = {
    ...poison,
    listInitiatives: (projectId: string) =>
      projects.find((p) => p.id === projectId)?.initiatives ?? [],
    listObjectives: (initiativeId: string) => {
      for (const p of projects) {
        const found = p.objectivesByInitiative.get(initiativeId);
        if (found !== undefined) return found;
      }
      return [];
    },
  };

  const taskSource = {
    ...poison,
    listByInitiative: (initiativeId: string) => {
      for (const p of projects) {
        const found = p.tasksByInitiative.get(initiativeId);
        if (found !== undefined) return found;
      }
      return [];
    },
  };

  const publicationSource = {
    ...poison,
    getLatestPublication: (repoId: string) => opts.publications?.get(repoId),
  };

  const activitySource = {
    ...poison,
    latestActionableEventIds: (_ids: readonly string[]) => {
      counters.activityCalls++;
      return new Map<string, string>();
    },
  };

  const evidenceSource = {
    ...poison,
    getTaskResult: (taskId: string) => opts.taskResults?.get(taskId),
    resolveHomeDir: (repoId: string) =>
      opts.homeDirs?.get(repoId) ?? "/homes/" + repoId,
    resolveInitiativeRepository: (initiativeId: string) =>
      opts.initiativeRepos?.get(initiativeId),
  };

  const candidateSource = {
    ...poison,
    getCandidateByTask: (taskId: string) => {
      counters.candidateCalls++;
      return opts.candidateTaskIds?.has(taskId)
        ? { id: "cand-" + taskId }
        : undefined;
    },
  };

  // Review blocker S3 — the new commit-presence probe seam. Defaults every
  // OID to "present" so existing tests are unaffected; `opts.absentOids`
  // names OIDs the probe reports as missing from the home.
  // Review blocker S3-batch — the seam is now batched: one call per
  // distinct homeDir carrying every OID that home needs, returning a
  // same-length, same-order array of booleans.
  const commitPresenceSource = {
    ...poison,
    hasCommits: async (_homeDir: string, oids: readonly string[]) =>
      oids.map((oid) => !(opts.absentOids?.has(oid) ?? false)),
  };

  return {
    counters,
    sources: {
      projectSource,
      initiativeSource,
      taskSource,
      publicationSource,
      activitySource,
      evidenceSource,
      candidateSource,
      commitPresenceSource,
    },
    args: [
      projectSource,
      initiativeSource,
      taskSource,
      publicationSource,
      activitySource,
      evidenceSource,
      candidateSource,
      commitPresenceSource,
    ] as const,
  };
}

function chain(taskCount: number, prefix: string, objectiveId: string): Task[] {
  const tasks: Task[] = [
    task({ id: `${prefix}0`, objectiveId, status: "failed" }),
  ];
  for (let i = 1; i < taskCount; i++) {
    tasks.push(
      task({
        id: `${prefix}${i}`,
        objectiveId,
        status: "pending",
        dependencies: [`${prefix}${i - 1}`],
      }),
    );
  }
  return tasks;
}

function oneFailedProject(
  id: string,
  name: string,
  dependentCount: number,
): ProjectFixture {
  const initiativeId = `i-${id}`;
  const objectiveId = `o-${id}`;
  return {
    id,
    name,
    initiatives: [
      initiative({ id: initiativeId, projectId: id, status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initiativeId,
        [objective({ id: objectiveId, initiativeId, status: "building" })],
      ],
    ]),
    tasksByInitiative: new Map([
      [initiativeId, chain(dependentCount + 1, `t-${id}-`, objectiveId)],
    ]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("(017-S6-cross-project) two projects, one decision each -> both appear, higher-downstream item first", async () => {
  const projectA = oneFailedProject("p1", "Alpha", 1);
  const projectB = oneFailedProject("p2", "Beta", 3);
  const { args } = buildSources([projectA, projectB]);
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({});
  assert.equal(output.items.length, 2);
  assert.equal(output.items[0]!.projectId, "p2");
  assert.equal(output.items[1]!.projectId, "p1");
});

test("(017-S6-ranked-once) project B's item outranks project A's when its downstream is higher, proving ranking happens after concatenation", async () => {
  const projectA = oneFailedProject("p1", "Alpha", 0);
  const projectB = oneFailedProject("p2", "Beta", 2);
  const { args } = buildSources([projectA, projectB]);
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({});
  assert.equal(output.items.length, 2);
  assert.equal(output.items[0]!.projectId, "p2");
  assert.ok(output.items[0]!.downstream > output.items[1]!.downstream);
});

test("(017-S6-counts-before-truncation) nine items with limit:2 -> items capped, counts.total===9, byKind sums to 9, truncated===true", async () => {
  const initiativeId = "i1";
  const objectiveId = "o1";
  const tasks: Task[] = [];
  for (let i = 0; i < 9; i++) {
    tasks.push(task({ id: `t${i}`, objectiveId, status: "failed" }));
  }
  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: initiativeId, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initiativeId,
        [objective({ id: objectiveId, initiativeId, status: "building" })],
      ],
    ]),
    tasksByInitiative: new Map([[initiativeId, tasks]]),
  };
  const { args } = buildSources([project]);
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({ limit: 2 });
  assert.equal(output.items.length, 2);
  assert.equal(output.counts.total, 9);
  assert.equal(
    Object.values(output.counts.byKind).reduce((a, b) => a + b, 0),
    9,
  );
  assert.equal(output.truncated, true);
});

test("(017-S6-not-truncated) limit above the item count -> truncated===false", async () => {
  const project = oneFailedProject("p1", "P", 0);
  const { args } = buildSources([project]);
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({ limit: 100 });
  assert.equal(output.truncated, false);
});

test("(017-S6-no-writes) sources whose save/append/transaction methods throw -> execute resolves", async () => {
  const project = oneFailedProject("p1", "P", 0);
  const { args } = buildSources([project]);
  const queue = new GetDecisionQueue(...args);

  await assert.doesNotReject(() => queue.execute({}));
});

test("(017-S6-one-activity-call) a counting activity source -> exactly one call", async () => {
  const projectA = oneFailedProject("p1", "Alpha", 2);
  const projectB = oneFailedProject("p2", "Beta", 2);
  const { args, counters } = buildSources([projectA, projectB]);
  const queue = new GetDecisionQueue(...args);

  await queue.execute({});
  assert.equal(counters.activityCalls, 1);
});

test("(017-S6-empty) no projects -> items:[], counts.total:0, byKind:{}, truncated:false", async () => {
  const { args } = buildSources([]);
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({});
  assert.deepEqual(output.items, []);
  assert.equal(output.counts.total, 0);
  assert.deepEqual(output.counts.byKind, {});
  assert.equal(output.truncated, false);
});

test("(017-S6-cause-source) an awaiting_confirmation task with a candidate row -> cause:candidate; without one -> escalation; queried only for awaiting_confirmation tasks", async () => {
  const initiativeId = "i1";
  const objectiveId = "o1";
  const tasks: Task[] = [
    task({ id: "t-candidate", objectiveId, status: "awaiting_confirmation" }),
    task({ id: "t-escalation", objectiveId, status: "awaiting_confirmation" }),
    task({ id: "t-failed", objectiveId, status: "failed" }),
    task({ id: "t-pending", objectiveId, status: "pending" }),
  ];
  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: initiativeId, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initiativeId,
        [objective({ id: objectiveId, initiativeId, status: "building" })],
      ],
    ]),
    tasksByInitiative: new Map([[initiativeId, tasks]]),
  };
  const { args, counters } = buildSources([project], {
    candidateTaskIds: new Set(["t-candidate"]),
  });
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({});
  const candidateItem = output.items.find((i) => i.taskId === "t-candidate");
  const escalationItem = output.items.find((i) => i.taskId === "t-escalation");
  assert.ok(candidateItem, "expected an item for t-candidate");
  assert.ok(escalationItem, "expected an item for t-escalation");
  assert.equal(candidateItem!.cause, "candidate");
  assert.equal(escalationItem!.cause, "escalation");
  // Only the two awaiting_confirmation tasks may trigger a candidate lookup —
  // never the failed or pending ones.
  assert.equal(counters.candidateCalls, 2);
});

test("(017-S6-evidence-identity) task inspect uses baseCommit..commitSha, objective inspect uses parentOid..commitOid, publication inspect is null", async () => {
  const initiativeId = "i1";
  const objectiveId = "o1";
  const repoId = "repo-1";
  const homeDir = "/homes/repo-1";
  const tasks: Task[] = [task({ id: "t1", objectiveId, status: "failed" })];
  const obj = objective({
    id: objectiveId,
    initiativeId,
    status: "conflict",
    parentOid: "ccccccc",
    commitOid: "ddddddd",
  });

  const publicationInitiativeId = "i2";
  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: initiativeId, projectId: "p1", status: "building" }),
      initiative({
        id: publicationInitiativeId,
        projectId: "p1",
        status: "landed",
      }),
    ],
    objectivesByInitiative: new Map([
      [initiativeId, [obj]],
      [publicationInitiativeId, []],
    ]),
    tasksByInitiative: new Map([
      [initiativeId, tasks],
      [publicationInitiativeId, []],
    ]),
  };

  const { args } = buildSources([project], {
    taskResults: new Map([
      [
        "t1",
        {
          workspace: null,
          branch: null,
          baseCommit: "aaaaaaa",
          proposalCommit: null,
          commitSha: "bbbbbbb",
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
    ]),
    initiativeRepos: new Map([
      [initiativeId, repoId],
      [publicationInitiativeId, "repo-2"],
    ]),
    homeDirs: new Map([[repoId, homeDir]]),
    publications: new Map([
      ["repo-2", { state: "unpublished", remoteOID: null }],
    ]),
  });
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({});
  const taskItem = output.items.find((i) => i.taskId === "t1");
  const objectiveItem = output.items.find((i) => i.objectiveId === objectiveId);
  const publicationItem = output.items.find(
    (i) => i.kindLabel === "publication",
  );

  assert.ok(taskItem, "expected a task item");
  assert.deepEqual(taskItem!.evidence.inspect, {
    executable: "git",
    args: ["-C", homeDir, "diff", "aaaaaaa..bbbbbbb"],
  });

  assert.ok(objectiveItem, "expected an objective item");
  assert.deepEqual(objectiveItem!.evidence.inspect, {
    executable: "git",
    args: ["-C", homeDir, "diff", "ccccccc..ddddddd"],
  });

  assert.ok(publicationItem, "expected a publication item");
  assert.equal(publicationItem!.evidence.inspect, null);
});

// ---------------------------------------------------------------------------
// Review blocker S3 — `inspect` must be `null` exactly when an OID is
// missing, malformed, OR absent from the named home (epic:543-544). Today
// the queue only format-checks (`OID_PATTERN.test` in
// `src/domain/decision-queue.ts`'s `buildInspect`), never asking whether the
// commit actually exists in `homeDir`. The pure projection must stay pure —
// the presence probe belongs in this use case, as a new eighth constructor
// dependency (the seam exercised below via `commitPresenceSource`), backed
// by a new small capability port (`CommitPresence` /
// `src/commit-presence/port.ts`, adapter `GitCommitPresence`) wired through
// the composition root.
// ---------------------------------------------------------------------------

test("(017-S3-inspect-absent-from-home) a well-formed head OID absent from the named home yields evidence.inspect:null", async () => {
  const initiativeId = "i1";
  const objectiveId = "o1";
  const repoId = "repo-1";
  const homeDir = "/homes/repo-1";
  const tasks: Task[] = [task({ id: "t1", objectiveId, status: "failed" })];
  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: initiativeId, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initiativeId,
        [objective({ id: objectiveId, initiativeId, status: "building" })],
      ],
    ]),
    tasksByInitiative: new Map([[initiativeId, tasks]]),
  };

  const { args } = buildSources([project], {
    taskResults: new Map([
      [
        "t1",
        {
          workspace: null,
          branch: null,
          baseCommit: "aaaaaaa",
          proposalCommit: null,
          commitSha: "bbbbbbb",
          summary: null,
          reason: null,
          rejectionResolution: null,
          rejectionReason: null,
          evidence: null,
        },
      ],
    ]),
    initiativeRepos: new Map([[initiativeId, repoId]]),
    homeDirs: new Map([[repoId, homeDir]]),
    // bbbbbbb is well-formed hex but reported absent from the home.
    absentOids: new Set(["bbbbbbb"]),
  });
  const queue = new GetDecisionQueue(...args);

  const output = await queue.execute({});
  const taskItem = output.items.find((i) => i.taskId === "t1");
  assert.ok(taskItem, "expected an item for t1");
  assert.equal(
    taskItem!.evidence.inspect,
    null,
    "commitSha 'bbbbbbb' is well-formed hex but absent from the home; inspect must be null, not merely format-checked",
  );
});

// ---------------------------------------------------------------------------
// Review blocker S5 — `src/app/project/get-decision-queue.ts:114,209` shares
// ONE `candidateTaskIds` Set across every project's `QueueProjectInput` and
// keeps mutating it after pushing. By the time `projectDecisions` runs (after
// the whole `for (const p of projects)` loop completes), every
// `QueueProjectInput.candidateTaskIds` reference the SAME final Set,
// containing every candidate id observed across every project — not just
// that project's own. The fix must build a fresh Set per project inside the
// loop.
// ---------------------------------------------------------------------------

test("(017-S5-per-project-candidate-set) a task id that collides across two projects does not leak 'candidate' cause from one project into the other", async () => {
  const initA = "i-a";
  const objA = "o-a";
  const initB = "i-b";
  const objB = "o-b";
  const collidingId = "dup";

  const projectA: ProjectFixture = {
    id: "p1",
    name: "Alpha",
    initiatives: [
      initiative({ id: initA, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initA,
        [objective({ id: objA, initiativeId: initA, status: "building" })],
      ],
    ]),
    tasksByInitiative: new Map([
      [
        initA,
        [
          task({
            id: collidingId,
            objectiveId: objA,
            status: "awaiting_confirmation",
          }),
        ],
      ],
    ]),
  };
  const projectB: ProjectFixture = {
    id: "p2",
    name: "Beta",
    initiatives: [
      initiative({ id: initB, projectId: "p2", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initB,
        [objective({ id: objB, initiativeId: initB, status: "building" })],
      ],
    ]),
    tasksByInitiative: new Map([
      [
        initB,
        [
          task({
            id: collidingId,
            objectiveId: objB,
            status: "awaiting_confirmation",
          }),
        ],
      ],
    ]),
  };

  // Order-dependent candidate source: the FIRST call (project A's "dup")
  // reports a persisted candidate row; the SECOND call (project B's "dup",
  // same id, different project) reports none. A correct implementation
  // isolates each project's candidate ids so project B's own answer (no
  // candidate -> "escalation") cannot be overwritten by project A's earlier
  // "candidate" answer for the same id string.
  let calls = 0;
  const candidateSource = {
    save: () => {
      throw new Error("must not write");
    },
    append: () => {
      throw new Error("must not write");
    },
    transaction: () => {
      throw new Error("must not write");
    },
    getCandidateByTask: (taskId: string) => {
      calls++;
      return calls === 1 ? { id: "cand-" + taskId } : undefined;
    },
  };

  const { sources } = buildSources([projectA, projectB]);
  const queue = new GetDecisionQueue(
    sources.projectSource,
    sources.initiativeSource,
    sources.taskSource,
    sources.publicationSource,
    sources.activitySource,
    sources.evidenceSource,
    candidateSource,
    sources.commitPresenceSource,
  );

  const output = await queue.execute({});
  const itemA = output.items.find(
    (i) => i.projectId === "p1" && i.taskId === collidingId,
  );
  const itemB = output.items.find(
    (i) => i.projectId === "p2" && i.taskId === collidingId,
  );
  assert.ok(itemA, "expected an item for project A's task");
  assert.ok(itemB, "expected an item for project B's task");
  assert.equal(
    itemA!.cause,
    "candidate",
    "project A's own candidate row must report cause:candidate",
  );
  assert.equal(
    itemB!.cause,
    "escalation",
    "project B has no candidate row for its own 'dup' task; a shared/mutated candidateTaskIds Set must not leak project A's answer for the same id string into project B's item",
  );
});

// ---------------------------------------------------------------------------
// Review blocker S3-batch — the commit-presence probe must become ONE
// batched call per distinct homeDir instead of one process per OID inside
// the per-initiative loop (`#withPresence`, invoked once per failed/awaiting
// task and once per conflict/awaiting objective). These tests assert the use
// case makes exactly one `hasCommits(homeDir, oids)` call per distinct
// homeDir — batching every OID that home needs across ALL initiatives that
// resolve to it, never one call per OID and never one call per initiative —
// and that `inspect` is still nulled for an OID the batched probe reports
// absent, exactly as with the old scalar port.
// ---------------------------------------------------------------------------

interface FakeBatchedCommitPresenceSource {
  hasCommits(
    homeDir: string,
    oids: readonly string[],
  ): Promise<readonly boolean[]>;
}

function recordingBatchedProbe(
  absentOids: Set<string> = new Set(),
): FakeBatchedCommitPresenceSource & {
  calls: Array<{ homeDir: string; oids: readonly string[] }>;
} {
  const calls: Array<{ homeDir: string; oids: readonly string[] }> = [];
  return {
    calls,
    hasCommits: async (homeDir: string, oids: readonly string[]) => {
      calls.push({ homeDir, oids });
      return oids.map((oid) => !absentOids.has(oid));
    },
  };
}

test("(017-S3-batch-usecase) GetDecisionQueue makes exactly one hasCommits call per distinct homeDir, batching every OID that home needs across initiatives", async () => {
  const repoId = "repo-shared";
  const homeDir = "/homes/repo-shared";
  const otherRepoId = "repo-other";
  const otherHomeDir = "/homes/repo-other";

  const initiativeId1 = "i1";
  const initiativeId2 = "i2";
  const initiativeId3 = "i3";

  const objectiveId1 = "o1";
  const objectiveId2 = "o2";
  const objectiveId3 = "o3";

  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: initiativeId1, projectId: "p1", status: "building" }),
      initiative({ id: initiativeId2, projectId: "p1", status: "building" }),
      initiative({ id: initiativeId3, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initiativeId1,
        [
          objective({
            id: objectiveId1,
            initiativeId: initiativeId1,
            status: "conflict",
            parentOid: "aaaaaaa",
            commitOid: "bbbbbbb",
          }),
        ],
      ],
      [
        initiativeId2,
        [
          objective({
            id: objectiveId2,
            initiativeId: initiativeId2,
            status: "conflict",
            parentOid: "ccccccc",
            commitOid: "ddddddd",
          }),
        ],
      ],
      [
        initiativeId3,
        [
          objective({
            id: objectiveId3,
            initiativeId: initiativeId3,
            status: "conflict",
            parentOid: "eeeeeee",
            commitOid: "fffffff",
          }),
        ],
      ],
    ]),
    tasksByInitiative: new Map([
      [initiativeId1, []],
      [initiativeId2, []],
      [initiativeId3, []],
    ]),
  };

  const { sources } = buildSources([project], {
    initiativeRepos: new Map([
      [initiativeId1, repoId],
      [initiativeId2, repoId],
      [initiativeId3, otherRepoId],
    ]),
    homeDirs: new Map([
      [repoId, homeDir],
      [otherRepoId, otherHomeDir],
    ]),
  });

  const probe = recordingBatchedProbe();
  const queue = new GetDecisionQueue(
    sources.projectSource,
    sources.initiativeSource,
    sources.taskSource,
    sources.publicationSource,
    sources.activitySource,
    sources.evidenceSource,
    sources.candidateSource,
    probe,
  );

  await queue.execute({});

  assert.equal(
    probe.calls.length,
    2,
    "expected exactly one hasCommits call per distinct homeDir (2 distinct homes: repo-shared, repo-other) — not one per initiative and not one per OID",
  );

  const sharedCall = probe.calls.find((c) => c.homeDir === homeDir);
  assert.ok(sharedCall, "expected a batched call for the shared homeDir");
  assert.deepEqual(
    [...sharedCall!.oids].sort(),
    ["aaaaaaa", "bbbbbbb", "ccccccc", "ddddddd"].sort(),
    "the shared home's single call must carry every OID needed across BOTH initiatives that resolve to it",
  );

  const otherCall = probe.calls.find((c) => c.homeDir === otherHomeDir);
  assert.ok(otherCall, "expected a batched call for the other homeDir");
  assert.deepEqual([...otherCall!.oids].sort(), ["eeeeeee", "fffffff"].sort());
});

test("(017-S3-batch-usecase-inspect) inspect is still nulled for an OID the batched probe reports absent", async () => {
  const initiativeId = "i1";
  const objectiveId = "o1";
  const repoId = "repo-1";
  const homeDir = "/homes/repo-1";
  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: initiativeId, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initiativeId,
        [
          objective({
            id: objectiveId,
            initiativeId,
            status: "conflict",
            parentOid: "aaaaaaa",
            commitOid: "bbbbbbb",
          }),
        ],
      ],
    ]),
    tasksByInitiative: new Map([[initiativeId, []]]),
  };

  const { sources } = buildSources([project], {
    initiativeRepos: new Map([[initiativeId, repoId]]),
    homeDirs: new Map([[repoId, homeDir]]),
  });

  const probe = recordingBatchedProbe(new Set(["bbbbbbb"]));
  const queue = new GetDecisionQueue(
    sources.projectSource,
    sources.initiativeSource,
    sources.taskSource,
    sources.publicationSource,
    sources.activitySource,
    sources.evidenceSource,
    sources.candidateSource,
    probe,
  );

  const output = await queue.execute({});
  const item = output.items.find((i) => i.objectiveId === objectiveId);
  assert.ok(item, "expected an item for o1");
  assert.equal(
    item!.evidence.inspect,
    null,
    "commitOid 'bbbbbbb' reported absent by the batched probe must still null the inspect command",
  );
});

// ---------------------------------------------------------------------------
// Review blocker R3-S3 (HUMAN DECISION) — a single failing home must NOT fail
// the whole cross-project `queue`. `#resolvePresence` must catch a per-home
// `hasCommits` rejection, treat only THAT home's OIDs as absent (inspect
// nulled for its items), and continue with the remaining homes. The failure
// must not be silent: it must surface as a `warnings: string[]` entry on
// `GetDecisionQueueOutput` (the use case stays read-only and must not print;
// `src/apps/cli/queue.ts` is the one that writes to stderr). Each warning
// reads exactly:
//   `warning: commit probe failed for <homeDir> (<reason>); inspect omitted for <N> affected element(s)`
// where <reason> is the rejection's `.message` and <N> is the count of
// DecisionItems (not OIDs) whose `inspect` ended up null because of that
// home's failure. The adapter itself (`GitCommitPresence`) still throws —
// covered separately by git.test.ts's "not-a-repository" case.
// ---------------------------------------------------------------------------

function partialFailureProbe(
  failingHomeDir: string,
  reason: string,
): FakeBatchedCommitPresenceSource {
  return {
    hasCommits: async (homeDir: string, oids: readonly string[]) => {
      if (homeDir === failingHomeDir) throw new Error(reason);
      return oids.map(() => true);
    },
  };
}

test("(017-R3-S3-usecase-degrade) one failing home degrades only its own items; the other home's inspect stays intact; a warning names the failing home and the item count", async () => {
  const okInitiative = "i-ok";
  const okObjective = "o-ok";
  const okRepo = "repo-ok";
  const okHome = "/homes/repo-ok";

  const failInitiativeA = "i-fail-a";
  const failObjectiveA = "o-fail-a";
  const failInitiativeB = "i-fail-b";
  const failObjectiveB = "o-fail-b";
  const failRepo = "repo-fail";
  const failHome = "/homes/repo-fail";

  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: okInitiative, projectId: "p1", status: "building" }),
      initiative({ id: failInitiativeA, projectId: "p1", status: "building" }),
      initiative({ id: failInitiativeB, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        okInitiative,
        [
          objective({
            id: okObjective,
            initiativeId: okInitiative,
            status: "conflict",
            parentOid: "aaaaaaa",
            commitOid: "bbbbbbb",
          }),
        ],
      ],
      [
        failInitiativeA,
        [
          objective({
            id: failObjectiveA,
            initiativeId: failInitiativeA,
            status: "conflict",
            parentOid: "ccccccc",
            commitOid: "ddddddd",
          }),
        ],
      ],
      [
        failInitiativeB,
        [
          objective({
            id: failObjectiveB,
            initiativeId: failInitiativeB,
            status: "conflict",
            parentOid: "eeeeeee",
            commitOid: "fffffff",
          }),
        ],
      ],
    ]),
    tasksByInitiative: new Map([
      [okInitiative, []],
      [failInitiativeA, []],
      [failInitiativeB, []],
    ]),
  };

  const { sources } = buildSources([project], {
    initiativeRepos: new Map([
      [okInitiative, okRepo],
      [failInitiativeA, failRepo],
      [failInitiativeB, failRepo],
    ]),
    homeDirs: new Map([
      [okRepo, okHome],
      [failRepo, failHome],
    ]),
  });

  const probe = partialFailureProbe(failHome, "boom");
  const queue = new GetDecisionQueue(
    sources.projectSource,
    sources.initiativeSource,
    sources.taskSource,
    sources.publicationSource,
    sources.activitySource,
    sources.evidenceSource,
    sources.candidateSource,
    probe,
  );

  const output = await queue.execute({});

  const okItem = output.items.find((i) => i.objectiveId === okObjective);
  const failItemA = output.items.find((i) => i.objectiveId === failObjectiveA);
  const failItemB = output.items.find((i) => i.objectiveId === failObjectiveB);
  assert.ok(
    okItem && failItemA && failItemB,
    "expected all three objective items to render — a failing home must not hide the rest of the queue",
  );

  assert.notEqual(
    okItem!.evidence.inspect,
    null,
    "the healthy home's inspect must stay intact despite the other home's failure",
  );
  assert.equal(
    failItemA!.evidence.inspect,
    null,
    "the failing home's items must have inspect nulled, not left to throw out of execute()",
  );
  assert.equal(failItemB!.evidence.inspect, null);

  assert.deepEqual(
    output.warnings,
    [
      `warning: commit probe failed for ${failHome} (boom); inspect omitted for 2 affected element(s)`,
    ],
    "exactly one warning naming the failing homeDir and the count of items that lost inspect",
  );
});

test("(017-R3-S3-usecase-no-throw) a failing home degrades instead of rejecting queue.execute", async () => {
  const initiativeId = "i1";
  const objectiveId = "o1";
  const repoId = "repo-1";
  const homeDir = "/homes/repo-1";
  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: initiativeId, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        initiativeId,
        [
          objective({
            id: objectiveId,
            initiativeId,
            status: "conflict",
            parentOid: "aaaaaaa",
            commitOid: "bbbbbbb",
          }),
        ],
      ],
    ]),
    tasksByInitiative: new Map([[initiativeId, []]]),
  };
  const { sources } = buildSources([project], {
    initiativeRepos: new Map([[initiativeId, repoId]]),
    homeDirs: new Map([[repoId, homeDir]]),
  });
  const probe = partialFailureProbe(homeDir, "not a repository");
  const queue = new GetDecisionQueue(
    sources.projectSource,
    sources.initiativeSource,
    sources.taskSource,
    sources.publicationSource,
    sources.activitySource,
    sources.evidenceSource,
    sources.candidateSource,
    probe,
  );

  await assert.doesNotReject(
    () => queue.execute({}),
    "a probe rejection for one home must degrade, not reject execute()",
  );
});

// ---------------------------------------------------------------------------
// Review blocker R4-S2 — the degrade path in `#resolvePresence` narrows a
// caught rejection to `(err as Error).message`, which throws a TypeError
// from inside the `catch` block itself when the rejection is not an `Error`
// (e.g. a bare `Promise.reject()`/`Promise.reject(undefined)`). That inner
// throw defeats the whole R3-S3 degrade contract: `execute()` must still
// resolve, the other home's inspect must survive, and a warning must still
// be produced — even when a probe rejects with a non-Error value.
// ---------------------------------------------------------------------------

function nonErrorRejectionProbe(
  failingHomeDir: string,
): FakeBatchedCommitPresenceSource {
  return {
    hasCommits: async (homeDir: string, oids: readonly string[]) => {
      if (homeDir === failingHomeDir) return Promise.reject(undefined);
      return oids.map(() => true);
    },
  };
}

test("(017-R4-S2) a non-Error rejection (e.g. Promise.reject(undefined)) from one home still degrades that home, keeps the other home's inspect, and still produces a warning", async () => {
  const okInitiative = "i-ok";
  const okObjective = "o-ok";
  const okRepo = "repo-ok";
  const okHome = "/homes/repo-ok";

  const failInitiative = "i-fail";
  const failObjective = "o-fail";
  const failRepo = "repo-fail";
  const failHome = "/homes/repo-fail";

  const project: ProjectFixture = {
    id: "p1",
    name: "P",
    initiatives: [
      initiative({ id: okInitiative, projectId: "p1", status: "building" }),
      initiative({ id: failInitiative, projectId: "p1", status: "building" }),
    ],
    objectivesByInitiative: new Map([
      [
        okInitiative,
        [
          objective({
            id: okObjective,
            initiativeId: okInitiative,
            status: "conflict",
            parentOid: "aaaaaaa",
            commitOid: "bbbbbbb",
          }),
        ],
      ],
      [
        failInitiative,
        [
          objective({
            id: failObjective,
            initiativeId: failInitiative,
            status: "conflict",
            parentOid: "ccccccc",
            commitOid: "ddddddd",
          }),
        ],
      ],
    ]),
    tasksByInitiative: new Map([
      [okInitiative, []],
      [failInitiative, []],
    ]),
  };

  const { sources } = buildSources([project], {
    initiativeRepos: new Map([
      [okInitiative, okRepo],
      [failInitiative, failRepo],
    ]),
    homeDirs: new Map([
      [okRepo, okHome],
      [failRepo, failHome],
    ]),
  });

  const probe = nonErrorRejectionProbe(failHome);
  const queue = new GetDecisionQueue(
    sources.projectSource,
    sources.initiativeSource,
    sources.taskSource,
    sources.publicationSource,
    sources.activitySource,
    sources.evidenceSource,
    sources.candidateSource,
    probe,
  );

  await assert.doesNotReject(
    () => queue.execute({}),
    "a non-Error rejection for one home must still degrade, not throw a TypeError out of the catch block",
  );
  const output = await queue.execute({});

  const okItem = output.items.find((i) => i.objectiveId === okObjective);
  const failItem = output.items.find((i) => i.objectiveId === failObjective);
  assert.ok(okItem && failItem, "both objective items must still render");
  assert.notEqual(
    okItem!.evidence.inspect,
    null,
    "the healthy home's inspect must survive a non-Error rejection on the other home",
  );
  assert.equal(
    failItem!.evidence.inspect,
    null,
    "the failing home's item must have inspect nulled",
  );
  assert.equal(
    output.warnings.length,
    1,
    "a warning must still be produced for the failing home",
  );
  assert.match(
    output.warnings[0]!,
    new RegExp(
      `^warning: commit probe failed for ${failHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `,
    ),
    "the warning must still name the failing homeDir even when the rejection carries no .message",
  );
});
