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
}

interface FakeResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}

class MemTaskSource implements FakeTaskSource {
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
