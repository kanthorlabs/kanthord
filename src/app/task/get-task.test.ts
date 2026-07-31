/**
 * Story 06 T2 — GetTask use case
 *
 * Unit tests that verify GetTask.execute({ id }) returns task data combined
 * with an optional task result (workspace/branch/commitSha/summary/evidence),
 * and throws UnknownReferenceError for unknown ids.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GetTask } from "./get-task.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Task } from "../../domain/task.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import type { ChangeCandidate } from "../../domain/landing.ts";
import type { ObjectiveStatus } from "../../domain/initiative.ts";
import type { Action } from "../../domain/actionability.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZGSK1";

// NullContextSource: returns empty map — used in tests that don't inspect context
const nullContextSource = {
  getTaskContext: (_id: string): Record<string, string> => ({}),
};

const FAKE_TASK: Task = {
  id: TASK_ID,
  objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ1",
  title: "add a title line to README",
  status: "completed",
  dependencies: [],
  agent: "generic@1",
  instructions: "Edit README.md",
  ac: ["README.md begins with H1"],
};

const FAKE_RESULT: TaskResultRow = {
  workspace: "/ws/task-001",
  branch: "kanthord/task-001",
  baseCommit: "base123",
  proposalCommit: null,
  commitSha: "deadbeef",
  summary: "agent wrote the heading",
  reason: null,
  rejectionResolution: null,
  rejectionReason: null,
  evidence: [
    { command: "head -1 README.md | grep -q '^# '", exitCode: 0, output: "" },
  ],
};

interface FakeTaskSource {
  get(id: string): Task | undefined;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
}

interface FakeResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}

// (016 B2) `TaskSource.listByInitiative`/`getInitiativeId` are a REQUIRED
// part of the production seam, not optional — see the compile-guard test
// below. This is the pre-Story-7 fake every non-Story-7 test constructs
// `GetTask` with; it has no initiative scope of its own, so it reports
// `getInitiativeId` as always `undefined` and `listByInitiative` as always
// `[]` — the exact degraded default those tests already exercise, so this
// satisfies the required interface with zero behavior change.
class MemTaskSource implements FakeTaskSource {
  readonly #tasks: Map<string, Task>;
  constructor(tasks: Task[]) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
  }
  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }
  listByInitiative(_initiativeId: string): Task[] {
    return [];
  }
  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }
}

/**
 * (016 B2) A deliberately non-conforming task source — implements only
 * `get`, exactly like the pre-016 `MemTaskSource` used to. Exists solely to
 * pin, at the type level, that `TaskSource.listByInitiative` /
 * `getInitiativeId` are required constructor-seam methods, not optional.
 */
class MemTaskSourceGetOnly {
  readonly #tasks: Map<string, Task>;
  constructor(tasks: Task[]) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
  }
  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }
}

class MemResultSource implements FakeResultSource {
  readonly #results: Map<string, TaskResultRow>;
  constructor(results: Map<string, TaskResultRow>) {
    this.#results = results;
  }
  getTaskResult(taskId: string): TaskResultRow | undefined {
    return this.#results.get(taskId);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("(016 B2) GetTask: TaskSource.listByInitiative/getInitiativeId are required, not optional (compile guard)", () => {
  // AGENTS.md: "never weaken a spec-required field to optional". Story 7 §A
  // pins `listByInitiative`/`getInitiativeId` as required members of
  // `TaskSource`. `MemTaskSourceGetOnly` implements only `get`, so it must
  // NOT satisfy `TaskSource` — the `@ts-expect-error` below asserts exactly
  // that, and typecheck passing proves the directive is suppressing a real
  // "Property 'listByInitiative' is missing" error.
  //
  // Mark BOTH methods optional (`?`) again and the get-only source starts
  // satisfying `TaskSource` structurally: the error disappears, the directive
  // becomes unused, and `npm run typecheck` fails with TS2578. That is the
  // regression signal this test exists for. Weakening only ONE method leaves
  // the other required, so this guard stays used — but `execute` calls both
  // unconditionally, so typecheck still fails, there with TS2722 at the call
  // site. Both signals were verified by hand on 2026-07-28.
  //
  // Keep the directive on the argument line, not above `new GetTask(`:
  // `@ts-expect-error` guards only the following line, and prettier keeps this
  // call split across lines.
  const results = new MemResultSource(new Map());
  const _guard = new GetTask(
    // @ts-expect-error — listByInitiative/getInitiativeId must be required on TaskSource; a get-only source must be a type error
    new MemTaskSourceGetOnly([FAKE_TASK]),
    results,
    nullContextSource,
  );
  void _guard;
});

test("GetTask returns task data and task_results row for a known task with a result", async () => {
  const tasks = new MemTaskSource([FAKE_TASK]);
  const results = new MemResultSource(new Map([[TASK_ID, FAKE_RESULT]]));
  const uc = new GetTask(tasks, results, nullContextSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(output.id, TASK_ID, "id must match");
  assert.equal(output.title, FAKE_TASK.title, "title must match");
  assert.equal(output.status, "completed", "status must match");
  assert.equal(output.agent, "generic@1", "agent must match");

  assert.ok(output.result !== undefined, "result must be present");
  assert.equal(output.result!.workspace, "/ws/task-001", "workspace");
  assert.equal(output.result!.branch, "kanthord/task-001", "branch");
  assert.equal(output.result!.commitSha, "deadbeef", "commitSha");
  assert.equal(output.result!.summary, "agent wrote the heading", "summary");
  assert.ok(
    Array.isArray(output.result!.evidence),
    "evidence must be an array",
  );
  assert.equal(output.result!.evidence!.length, 1, "one evidence entry");
  assert.equal(output.result!.evidence![0]!.exitCode, 0, "evidence exit code");
});

test("GetTask returns task data with undefined result for a task with no task_results row", async () => {
  const tasks = new MemTaskSource([FAKE_TASK]);
  const results = new MemResultSource(new Map()); // no result stored
  const uc = new GetTask(tasks, results, nullContextSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(output.id, TASK_ID);
  assert.equal(output.status, "completed");
  assert.equal(
    output.result,
    undefined,
    "result must be undefined when absent",
  );
});

test("GetTask throws UnknownReferenceError for an unknown task id", async () => {
  const tasks = new MemTaskSource([]); // empty store
  const results = new MemResultSource(new Map());
  const uc = new GetTask(tasks, results, nullContextSource);

  await assert.rejects(
    () => uc.execute({ id: "01JZZZZZZZZZZZZZZZZZZZUNK1" }),
    (err: unknown) => {
      assert.ok(
        err instanceof UnknownReferenceError,
        "must be UnknownReferenceError",
      );
      return true;
    },
    "unknown id must throw UnknownReferenceError",
  );
});

// Story 07 T2 (k) — dependency status: GetTask shows each dep's id + status
test("GetTask returns dependencyStatus listing each dependency id and its status (k)", async () => {
  const DISCARDED_DEP_ID = "01JZZZZZZZZZZZZZZZZZZZDISC1";
  const DEPENDENT_TASK_ID = "01JZZZZZZZZZZZZZZZZZZZDEPC1";

  const discardedDep: Task = {
    id: DISCARDED_DEP_ID,
    objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ2k",
    title: "discarded dependency",
    status: "discarded",
    dependencies: [],
  };
  const dependentTask: Task = {
    id: DEPENDENT_TASK_ID,
    objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ2k",
    title: "blocked dependent",
    status: "pending",
    dependencies: [DISCARDED_DEP_ID],
  };

  const tasks = new MemTaskSource([discardedDep, dependentTask]);
  const results = new MemResultSource(new Map());
  const uc = new GetTask(tasks, results, nullContextSource);

  const output = await uc.execute({ id: DEPENDENT_TASK_ID });

  // dependencyStatus must be present and contain the discarded dep with its status
  assert.ok(
    output.dependencyStatus !== undefined,
    "dependencyStatus must be present on GetTaskOutput when task has dependencies",
  );
  assert.equal(
    output.dependencyStatus!.length,
    1,
    "one dependency status entry",
  );
  assert.equal(
    output.dependencyStatus![0]!.id,
    DISCARDED_DEP_ID,
    "dependency id must match the discarded task",
  );
  assert.equal(
    output.dependencyStatus![0]!.status,
    "discarded",
    "dependency status must be 'discarded'",
  );
});

// ---------------------------------------------------------------------------
// Story 08 T1 — A5: GetTask loads task_context via ContextSource (3rd arg)
// ---------------------------------------------------------------------------

test("GetTask context: output.context equals the map returned by ContextSource when non-empty", async () => {
  const ctxSource = {
    getTaskContext: (_id: string): Record<string, string> => ({
      repository: "REPO-1",
      ai_provider: "AIP-1",
    }),
  };
  const tasks = new MemTaskSource([FAKE_TASK]);
  const results = new MemResultSource(new Map());
  const uc = new GetTask(tasks, results, ctxSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.deepEqual(
    output.context,
    { repository: "REPO-1", ai_provider: "AIP-1" },
    "context must deep-equal the map from ContextSource",
  );
});

test("GetTask context: output.context is undefined when ContextSource returns empty map", async () => {
  const emptyCtxSource = {
    getTaskContext: (_id: string): Record<string, string> => ({}),
  };
  const tasks = new MemTaskSource([FAKE_TASK]);
  const results = new MemResultSource(new Map());
  const uc = new GetTask(tasks, results, emptyCtxSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.context,
    undefined,
    "context must be undefined when ContextSource returns empty map",
  );
});

// ---------------------------------------------------------------------------
// 007.8 S2 regression — `note` surfaces on get task --json.
//
// `retry task --note "…"` persists the note on the task; get task --json MUST
// project it (a rebuild-guidance value, readable by the prompt hook). The prior
// S2 test used a MOCK RetryTask that only checked the flag was forwarded, so it
// could not catch GetTask dropping the field. These assert the projection
// directly, mirroring the epic Proof's `get task --json | grep "<note>"`.
// ---------------------------------------------------------------------------

test("(S2-note-projection) GetTask projects `note` when the task carries one", async () => {
  const withNote: Task = { ...FAKE_TASK, note: "merge at anchor" };
  const tasks = new MemTaskSource([withNote]);
  const results = new MemResultSource(new Map());
  const uc = new GetTask(tasks, results, nullContextSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.note,
    "merge at anchor",
    "note must surface on get task output so `get task --json` shows it",
  );
});

test("(S2-note-absent) GetTask omits `note` when the task has none", async () => {
  const tasks = new MemTaskSource([FAKE_TASK]); // FAKE_TASK has no note
  const results = new MemResultSource(new Map());
  const uc = new GetTask(tasks, results, nullContextSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(output.note, undefined, "note must be absent when unset");
});

// ---------------------------------------------------------------------------
// Story A (007.10 F1) — landingCandidate projection sourced from the landing
// read path (a fake implementing the same shape as
// SqliteLandingRepository.getCandidateByTask).
// ---------------------------------------------------------------------------

interface FakeLandingSource {
  getCandidateByTask(taskId: string): ChangeCandidate | undefined;
}

class MemLandingSource implements FakeLandingSource {
  readonly #byTask: Map<string, ChangeCandidate>;
  constructor(candidates: ChangeCandidate[]) {
    this.#byTask = new Map(
      candidates
        .filter((c) => c.taskId !== null)
        .map((c) => [c.taskId as string, c]),
    );
  }
  getCandidateByTask(taskId: string): ChangeCandidate | undefined {
    return this.#byTask.get(taskId);
  }
}

const PENDING_CANDIDATE: ChangeCandidate = {
  id: "01JZZZZZZZZZZZZZZZZZZZCAN1",
  taskId: TASK_ID,
  repoId: "01JZZZZZZZZZZZZZZZZZZZREP1",
  baseSHA: "base111",
  candidateSHA: "cand111",
  ref: "refs/kanthord/cand1",
  target: "main",
  state: "pending",
};

const LANDED_CANDIDATE: ChangeCandidate = {
  ...PENDING_CANDIDATE,
  id: "01JZZZZZZZZZZZZZZZZZZZCAN2",
  state: "landed",
};

test("(Story A) GetTask projects landingCandidate{state,baseSHA,candidateSHA,target} for a pending candidate", async () => {
  const tasks = new MemTaskSource([FAKE_TASK]);
  const results = new MemResultSource(new Map());
  const landing = new MemLandingSource([PENDING_CANDIDATE]);
  const uc = new GetTask(tasks, results, nullContextSource, landing);

  const output = await uc.execute({ id: TASK_ID });

  assert.ok(
    output.landingCandidate !== null && output.landingCandidate !== undefined,
    "landingCandidate must be present when a candidate row exists",
  );
  assert.equal(output.landingCandidate!.state, "pending");
  assert.equal(output.landingCandidate!.baseSHA, "base111");
  assert.equal(output.landingCandidate!.candidateSHA, "cand111");
  assert.equal(output.landingCandidate!.target, "main");
});

test("(Story A) GetTask projects landingCandidate.state as 'landed' for a landed candidate", async () => {
  const tasks = new MemTaskSource([FAKE_TASK]);
  const results = new MemResultSource(new Map());
  const landing = new MemLandingSource([LANDED_CANDIDATE]);
  const uc = new GetTask(tasks, results, nullContextSource, landing);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(output.landingCandidate!.state, "landed");
});

test("(Story A) GetTask.landingCandidate is null when the task has no candidate row", async () => {
  const tasks = new MemTaskSource([FAKE_TASK]);
  const results = new MemResultSource(new Map());
  const landing = new MemLandingSource([]); // no candidates
  const uc = new GetTask(tasks, results, nullContextSource, landing);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.landingCandidate,
    null,
    "landingCandidate must be null, not undefined, when absent",
  );
});

// ---------------------------------------------------------------------------
// EPIC 013 Story 6 — `abandoning` field on GetTaskOutput
//
// `abandoning` is a marker on a `running` task whose lease has been revoked.
// The use case reads it from a narrow `RunningJobSource` consumer
// (default: undefined → `abandoning: false`). `TASK_STATUSES` is NOT widened
// — the task itself stays at `status: "running"`, only the marker flips.
// ---------------------------------------------------------------------------

interface FakeRunningJobSource {
  listRunningJobsForTask(taskId: string): Array<{ revoked: boolean }>;
}

class MemRunningJobSource implements FakeRunningJobSource {
  readonly #byTask: Map<string, Array<{ revoked: boolean }>>;
  constructor(byTask: Record<string, Array<{ revoked: boolean }>>) {
    this.#byTask = new Map(Object.entries(byTask));
  }
  listRunningJobsForTask(taskId: string): Array<{ revoked: boolean }> {
    return this.#byTask.get(taskId) ?? [];
  }
}

test("(013 S6) GetTask output.abandoning is false when no RunningJobSource is wired (default)", async () => {
  const RUNNING_TASK: Task = { ...FAKE_TASK, status: "running" };
  const tasks = new MemTaskSource([RUNNING_TASK]);
  const results = new MemResultSource(new Map());
  // 4-arg ctor: no jobs source wired.
  const uc = new GetTask(tasks, results, nullContextSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.abandoning,
    false,
    "abandoning must default to false when no RunningJobSource is wired",
  );
});

test("(013 S6) GetTask output.abandoning is false when the source reports no running jobs for the task", async () => {
  const RUNNING_TASK: Task = { ...FAKE_TASK, status: "running" };
  const tasks = new MemTaskSource([RUNNING_TASK]);
  const results = new MemResultSource(new Map());
  const jobs = new MemRunningJobSource({}); // empty — no running jobs
  const uc = new GetTask(tasks, results, nullContextSource, undefined, jobs);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.abandoning,
    false,
    "abandoning must be false when the source reports no running jobs",
  );
});

test("(013 S6) GetTask output.abandoning is true when the source reports a revoked running job, while status stays 'running'", async () => {
  const RUNNING_TASK: Task = { ...FAKE_TASK, status: "running" };
  const tasks = new MemTaskSource([RUNNING_TASK]);
  const results = new MemResultSource(new Map());
  const jobs = new MemRunningJobSource({
    [TASK_ID]: [{ revoked: true }],
  });
  const uc = new GetTask(tasks, results, nullContextSource, undefined, jobs);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.abandoning,
    true,
    "abandoning must be true when the source reports a revoked running job",
  );
  // Status is NOT widened — it stays at `running`. The marker is on a
  // running task, not a new lifecycle state.
  assert.equal(
    output.status,
    "running",
    "status must stay 'running' — abandoning is a marker, not a status",
  );
});

// ---------------------------------------------------------------------------
// EPIC 016 Story 7 — `get task` reuses the graph functions (no second copy).
//
// The four new fields (`waiting`, `blockedForever`, `downstream`, `action`)
// must be sourced from the same domain functions Story 3's `GetInitiativeGraph`
// uses (`unsatisfiedTaskEdges`, `permanentlyBlockedTasks`, `dependentClosure`,
// `nodeAction`). The assembly is pinned in the Story 7 §Change.A spec:
//   1. `getInitiativeId(id)` → read initiative scope; `undefined` means no
//      scope, no throw, all four fields default to the empty / zero / null shape.
//   2. Otherwise compute against the sibling task list for that initiative.
//   3. `action` = `nodeAction({ taskId, status, objectiveId, objectiveStatus,
//      blockedForever, deadDependencyId })` where `deadDependencyId` is the
//      first `waiting` entry with `neverSatisfies === true`, else null.
//   4. Optional `objectives` source omitted → `objectiveStatus === undefined`,
//      which keeps `nodeAction` from firing rule 4 / 5; the documented degraded
//      shape for a completed task under an awaiting objective is `action: null`.
// ---------------------------------------------------------------------------

interface TaskSourceWithSiblings {
  get(id: string): Task | undefined;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
}

class MemTaskSourceWithSiblings implements TaskSourceWithSiblings {
  readonly #byId: Map<string, Task>;
  readonly #byInitiative: Map<string, Task[]>;
  readonly #initiativeIdByTaskId: Map<string, string>;
  constructor(
    byId: Task[],
    byInitiative: Map<string, Task[]> = new Map(),
    initiativeIdByTaskId: Map<string, string> = new Map(),
  ) {
    this.#byId = new Map(byId.map((t) => [t.id, t]));
    this.#byInitiative = byInitiative;
    this.#initiativeIdByTaskId = initiativeIdByTaskId;
  }
  get(id: string): Task | undefined {
    return this.#byId.get(id);
  }
  listByInitiative(initiativeId: string): Task[] {
    return this.#byInitiative.get(initiativeId) ?? [];
  }
  getInitiativeId(taskId: string): string | undefined {
    return this.#initiativeIdByTaskId.get(taskId);
  }
}

interface ObjectiveStatusSource {
  getObjective(id: string): { status?: ObjectiveStatus } | undefined;
}

class MemObjectiveStatusSource implements ObjectiveStatusSource {
  readonly #byId: Map<string, { status?: ObjectiveStatus }>;
  constructor(byId: Map<string, { status?: ObjectiveStatus }>) {
    this.#byId = byId;
  }
  getObjective(id: string): { status?: ObjectiveStatus } | undefined {
    return this.#byId.get(id);
  }
}

const S7_INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINITS7";
const S7_OBJ_AWAIT = "01JZZZZZZZZZZZZZZZZZZZOBJS7A";
const S7_OBJ_BUILD = "01JZZZZZZZZZZZZZZZZZZZOBJS7B";
const S7_DEP_COMPLETED = "01JZZZZZZZZZZZZZZZZZZZS7DC1";
const S7_DEP_PENDING = "01JZZZZZZZZZZZZZZZZZZZS7DP1";
const S7_DEP_DISCARDED = "01JZZZZZZZZZZZZZZZZZZZS7DD1";

const S7_DEP_COMPLETED_TASK: Task = {
  id: S7_DEP_COMPLETED,
  objectiveId: S7_OBJ_BUILD,
  title: "completed dep",
  status: "completed",
  dependencies: [],
};
const S7_DEP_PENDING_TASK: Task = {
  id: S7_DEP_PENDING,
  objectiveId: S7_OBJ_BUILD,
  title: "pending dep",
  status: "pending",
  dependencies: [],
};
const S7_DEP_DISCARDED_TASK: Task = {
  id: S7_DEP_DISCARDED,
  objectiveId: S7_OBJ_BUILD,
  title: "discarded dep",
  status: "discarded",
  dependencies: [],
};

function makeS7Sources(
  siblingList: Task[],
  initiativeId: string = S7_INIT_ID,
  objectiveById: Map<string, { status?: ObjectiveStatus }> = new Map(),
): {
  tasks: TaskSourceWithSiblings;
  results: MemResultSource;
  objectives: ObjectiveStatusSource;
} {
  // Build the byInitiative map from the sibling list (all siblings share one
  // initiative in the test fixtures). Track initiative ids from siblings so
  // `getInitiativeId(<sibling.id>)` resolves to that initiative.
  const byInitiative = new Map<string, Task[]>([[initiativeId, siblingList]]);
  const initiativeIdByTaskId = new Map<string, string>();
  for (const t of siblingList) initiativeIdByTaskId.set(t.id, initiativeId);
  const tasks = new MemTaskSourceWithSiblings(
    siblingList,
    byInitiative,
    initiativeIdByTaskId,
  );
  return {
    tasks,
    results: new MemResultSource(new Map()),
    objectives: new MemObjectiveStatusSource(objectiveById),
  };
}

test("(016 S7) GetTask: pending task with completed dep reports waiting:[] blockedForever:false action:null", async () => {
  const pending: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "pending with completed dep",
    status: "pending",
    dependencies: [S7_DEP_COMPLETED],
  };
  const siblings = [S7_DEP_COMPLETED_TASK, pending];
  const { tasks, results, objectives } = makeS7Sources(siblings);
  const uc = new GetTask(
    tasks,
    results,
    nullContextSource,
    undefined,
    undefined,
    objectives,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.deepEqual(
    output.waiting,
    [],
    "waiting must be empty when every dep is completed",
  );
  assert.equal(
    output.blockedForever,
    false,
    "blockedForever must be false when every dep is completed",
  );
  assert.equal(
    output.action,
    null,
    "action must be null for a runnable pending task",
  );
});

test("(016 S7) GetTask: pending task with pending dep reports one waiting entry neverSatisfies:false blockedForever:false", async () => {
  const pending: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "pending with pending dep",
    status: "pending",
    dependencies: [S7_DEP_PENDING],
  };
  const siblings = [S7_DEP_PENDING_TASK, pending];
  const { tasks, results, objectives } = makeS7Sources(siblings);
  const uc = new GetTask(
    tasks,
    results,
    nullContextSource,
    undefined,
    undefined,
    objectives,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(output.waiting.length, 1, "exactly one waiting entry");
  assert.equal(
    output.waiting[0]!.id,
    S7_DEP_PENDING,
    "waiting entry names the dep",
  );
  assert.equal(
    output.waiting[0]!.neverSatisfies,
    false,
    "neverSatisfies must be false (a pending dep can become completed)",
  );
  assert.equal(
    output.blockedForever,
    false,
    "blockedForever must be false — pending is not terminal",
  );
});

test("(016 S7) GetTask: pending task with discarded dep reports neverSatisfies:true blockedForever:true action.kind='remove-dependency' with targetDependencyId", async () => {
  const pending: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "pending with discarded dep",
    status: "pending",
    dependencies: [S7_DEP_DISCARDED],
  };
  const siblings = [S7_DEP_DISCARDED_TASK, pending];
  const { tasks, results, objectives } = makeS7Sources(siblings);
  const uc = new GetTask(
    tasks,
    results,
    nullContextSource,
    undefined,
    undefined,
    objectives,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(output.waiting.length, 1, "one waiting entry");
  assert.equal(
    output.waiting[0]!.neverSatisfies,
    true,
    "neverSatisfies must be true for a discarded dep (terminal)",
  );
  assert.equal(
    output.blockedForever,
    true,
    "blockedForever must be true — discarded is terminal",
  );
  assert.ok(
    output.action !== null,
    "action must be non-null when blockedForever",
  );
  assert.equal(output.action!.kind, "remove-dependency");
  assert.equal(output.action!.targetDependencyId, S7_DEP_DISCARDED);
});

test("(016 S7) GetTask: failed task reports action.kind='retry' targeting the task", async () => {
  const failed: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "failed task",
    status: "failed",
    dependencies: [],
  };
  const siblings = [failed];
  const { tasks, results, objectives } = makeS7Sources(siblings);
  const uc = new GetTask(
    tasks,
    results,
    nullContextSource,
    undefined,
    undefined,
    objectives,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.ok(
    output.action !== null,
    "action must be non-null for a failed task",
  );
  assert.equal(output.action!.kind, "retry");
  assert.equal(output.action!.target.type, "task");
  assert.equal(output.action!.target.id, TASK_ID);
});

test("(016 S7) GetTask: completed task under awaiting_confirmation objective reports action.kind='approve' targeting the OBJECTIVE (not the task)", async () => {
  const completed: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_AWAIT,
    title: "completed task under awaiting objective",
    status: "completed",
    dependencies: [],
  };
  const siblings = [completed];
  const objectiveById = new Map<string, { status?: ObjectiveStatus }>([
    [S7_OBJ_AWAIT, { status: "awaiting_confirmation" }],
  ]);
  const { tasks, results, objectives } = makeS7Sources(
    siblings,
    S7_INIT_ID,
    objectiveById,
  );
  const uc = new GetTask(
    tasks,
    results,
    nullContextSource,
    undefined,
    undefined,
    objectives,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.ok(
    output.action !== null,
    "action must be non-null for completed+awaiting",
  );
  assert.equal(output.action!.kind, "approve");
  assert.equal(
    output.action!.target.type,
    "objective",
    "target must be the objective, not the task (node rule 4)",
  );
  assert.equal(output.action!.target.id, S7_OBJ_AWAIT);
});

test("(016 S7) GetTask: downstream equals dependentClosure(siblings, id).length — a root with three direct dependents reports 3", async () => {
  const root: Task = {
    id: "01JZZZZZZZZZZZZZZZZZZZS7R01",
    objectiveId: S7_OBJ_BUILD,
    title: "root",
    status: "completed",
    dependencies: [],
  };
  const d1: Task = {
    id: "01JZZZZZZZZZZZZZZZZZZZS7D01",
    objectiveId: S7_OBJ_BUILD,
    title: "dep1",
    status: "pending",
    dependencies: [root.id],
  };
  const d2: Task = {
    id: "01JZZZZZZZZZZZZZZZZZZZS7D02",
    objectiveId: S7_OBJ_BUILD,
    title: "dep2",
    status: "pending",
    dependencies: [root.id],
  };
  const d3: Task = {
    id: "01JZZZZZZZZZZZZZZZZZZZS7D03",
    objectiveId: S7_OBJ_BUILD,
    title: "dep3",
    status: "pending",
    dependencies: [root.id],
  };
  const siblings = [root, d1, d2, d3];
  const { tasks, results, objectives } = makeS7Sources(siblings);
  const uc = new GetTask(
    tasks,
    results,
    nullContextSource,
    undefined,
    undefined,
    objectives,
  );

  const output = await uc.execute({ id: root.id });

  assert.equal(
    output.downstream,
    3,
    "downstream must equal the dependent-closure size of the root",
  );
});

test("(016 S7) GetTask: getInitiativeId returning undefined → waiting:[] blockedForever:false downstream:0, no throw", async () => {
  // The task itself exists in the source, but the source's `getInitiativeId`
  // returns undefined for it. Story 7 §Change.A rule 1: degraded shape, no throw.
  const orphan: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "orphan task",
    status: "pending",
    dependencies: [S7_DEP_DISCARDED],
  };
  // byInitiative is empty AND getInitiativeId returns undefined.
  const tasks = new MemTaskSourceWithSiblings([orphan], new Map(), new Map());
  const uc = new GetTask(
    tasks,
    new MemResultSource(new Map()),
    nullContextSource,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.deepEqual(output.waiting, [], "waiting must default to []");
  assert.equal(
    output.blockedForever,
    false,
    "blockedForever must default to false",
  );
  assert.equal(output.downstream, 0, "downstream must default to 0");
  assert.equal(
    output.action,
    null,
    "action must be null in the degraded shape",
  );
  assert.equal(
    output.initiativeId,
    null,
    "initiativeId must be null when getInitiativeId returns undefined",
  );
});

test("GetTask: initiativeId is the resolved initiative", async () => {
  const task: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "task with initiative",
    status: "pending",
    dependencies: [],
  };
  const byInitiative = new Map<string, Task[]>();
  byInitiative.set("i1", [task]);
  const initiativeIdByTaskId = new Map<string, string>();
  initiativeIdByTaskId.set(TASK_ID, "i1");
  const tasks = new MemTaskSourceWithSiblings(
    [task],
    byInitiative,
    initiativeIdByTaskId,
  );
  const uc = new GetTask(
    tasks,
    new MemResultSource(new Map()),
    nullContextSource,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.initiativeId,
    "i1",
    "initiativeId must be the resolved initiative",
  );
});

test("GetTask: initiativeId is null when the initiative cannot be resolved (degraded defaults hold)", async () => {
  const orphan: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "orphan task",
    status: "pending",
    dependencies: [],
  };
  // byInitiative is empty AND getInitiativeId returns undefined.
  const tasks = new MemTaskSourceWithSiblings([orphan], new Map(), new Map());
  const uc = new GetTask(
    tasks,
    new MemResultSource(new Map()),
    nullContextSource,
  );

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(output.initiativeId, null);
  assert.deepEqual(output.waiting, []);
  assert.equal(output.blockedForever, false);
  assert.equal(output.downstream, 0);
});

test("(016 S7) GetTask: optional `objectives` source omitted → completed task under awaiting objective yields action:null (degraded shape)", async () => {
  // No objectives source wired (the 5th arg is undefined). nodeAction rules
  // 4 and 5 require `objectiveStatus`; without it, the action is null even
  // when the underlying Task would carry an awaiting_confirmation objective.
  const completed: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_AWAIT,
    title: "completed task",
    status: "completed",
    dependencies: [],
  };
  const { tasks, results } = makeS7Sources([completed]);
  // 4-arg ctor: no `objectives` source wired.
  const uc = new GetTask(tasks, results, nullContextSource);

  const output = await uc.execute({ id: TASK_ID });

  assert.equal(
    output.action,
    null,
    "action must be null when objectives source is absent (documented degraded shape)",
  );
});

// ---------------------------------------------------------------------------
// EPIC 016 Story 7 — pre-existing assertions stay green, including
// `dependencyStatus`. This is the regression guard the Story's Verify block
// names. The pre-existing `dependencyStatus` test above (Story 07 T2) covers
// the happy path; this test pins `waiting`/`blockedForever`/`downstream`/`action`
// are ADDITIVE — they do not change the projection of `dependencyStatus`.
// ---------------------------------------------------------------------------

test("(016 S7) GetTask: new fields are additive — dependencyStatus and existing fields are unchanged for a discarded-dep dependent", async () => {
  const pending: Task = {
    id: TASK_ID,
    objectiveId: S7_OBJ_BUILD,
    title: "blocked dependent",
    status: "pending",
    dependencies: [S7_DEP_DISCARDED],
  };
  const siblings = [S7_DEP_DISCARDED_TASK, pending];
  const { tasks, results, objectives } = makeS7Sources(siblings);
  const uc = new GetTask(
    tasks,
    results,
    nullContextSource,
    undefined,
    undefined,
    objectives,
  );

  const output = await uc.execute({ id: TASK_ID });

  // dependencyStatus stays as before.
  assert.ok(
    output.dependencyStatus !== undefined,
    "dependencyStatus must remain present",
  );
  assert.equal(output.dependencyStatus!.length, 1);
  assert.equal(output.dependencyStatus![0]!.id, S7_DEP_DISCARDED);
  assert.equal(output.dependencyStatus![0]!.status, "discarded");
  // The four new fields are present and computed.
  assert.equal(output.blockedForever, true);
  assert.equal(output.waiting[0]!.id, S7_DEP_DISCARDED);
  assert.equal(output.downstream, 0, "no other task depends on this one");
  assert.equal(output.action!.kind, "remove-dependency");
  // Action carries the typed target.
  const action: Action = output.action!;
  assert.equal(action.target.type, "task");
  assert.equal(action.target.id, TASK_ID);
});
