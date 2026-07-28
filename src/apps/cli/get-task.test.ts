/**
 * Story 06 T2 — runGetTask CLI handler
 *
 * Unit tests for `runGetTask`: output formatting for completed tasks with/without
 * evidence, result-less tasks, JSON mode, and error path.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGetTask } from "./task.ts";
import { GetTask } from "../../app/task/get-task.ts";
import type { Task } from "../../domain/task.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import type { Action } from "../../domain/actionability.ts";
import type { UnsatisfiedEdge } from "../../domain/sequencing.ts";

// ---------------------------------------------------------------------------
// Shared result type so r.stdout is known to be string[] even before the
// seam exists (runGetTask is `any` until task.ts exports it).
// ---------------------------------------------------------------------------

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZGSK1";

const COMPLETED_TASK: Task = {
  id: TASK_ID,
  objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ1",
  title: "add a title line to README",
  status: "completed",
  dependencies: [],
  agent: "generic@1",
  instructions: "Edit README.md",
  ac: ["README.md begins with H1"],
};

const RESULT_WITH_EVIDENCE: TaskResultRow = {
  workspace: "/ws/task-001",
  branch: "kanthord/task-001",
  baseCommit: "base123",
  proposalCommit: null,
  commitSha: "deadbeef",
  summary: "agent added the heading",
  reason: null,
  rejectionResolution: null,
  rejectionReason: null,
  evidence: [
    { command: "npm test", exitCode: 0, output: "all passed" },
    { command: "npm run lint", exitCode: 0, output: "clean" },
  ],
};

const RESULT_NO_EVIDENCE: TaskResultRow = {
  workspace: "/ws/task-002",
  branch: "kanthord/task-002",
  baseCommit: "base456",
  proposalCommit: null,
  commitSha: "cafebabe",
  summary: "done",
  reason: null,
  rejectionResolution: null,
  rejectionReason: null,
  evidence: null,
};

interface FakeTaskSource {
  get(id: string): Task | undefined;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
}
interface FakeResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}

// (016 B2) `TaskSource.listByInitiative`/`getInitiativeId` are required, not
// optional (see `src/app/task/get-task.test.ts`'s compile guard). This fake
// has no initiative scope of its own, so it reports the same degraded
// default (`undefined` / `[]`) every test in this file already exercises.
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

class MemResultSource implements FakeResultSource {
  readonly #results: Map<string, TaskResultRow>;
  constructor(results: Map<string, TaskResultRow>) {
    this.#results = results;
  }
  getTaskResult(taskId: string): TaskResultRow | undefined {
    return this.#results.get(taskId);
  }
}

const nullContextSource = { getTaskContext: (_id: string) => ({}) };

function makeGetTask(
  task: Task | undefined,
  result: TaskResultRow | undefined,
): GetTask {
  const tasks = new MemTaskSource(task !== undefined ? [task] : []);
  const results = new MemResultSource(
    task !== undefined && result !== undefined
      ? new Map([[task.id, result]])
      : new Map(),
  );
  return new GetTask(tasks, results, nullContextSource);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runGetTask", () => {
  test("runGetTask with result prints id, title, status, agent, workspace, branch, commit_sha, summary lines", async () => {
    const getTask = makeGetTask(COMPLETED_TASK, RESULT_WITH_EVIDENCE);
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0, "exit 0 on success");

    const stdout = r.stdout;
    assert.ok(
      stdout.some((l: string) => l.startsWith("id:")),
      "stdout must have id: line",
    );
    assert.ok(
      stdout.some((l: string) => l.startsWith("title:")),
      "stdout must have title: line",
    );
    assert.ok(
      stdout.some((l: string) => l.startsWith("status:")),
      "stdout must have status: line",
    );
    assert.ok(
      stdout.some((l: string) => l.startsWith("agent:")),
      "stdout must have agent: line",
    );
    assert.ok(
      stdout.some((l: string) => l.startsWith("workspace:")),
      "stdout must have workspace: line",
    );
    assert.ok(
      stdout.some((l: string) => l.startsWith("branch:")),
      "stdout must have branch: line",
    );
    assert.ok(
      stdout.some((l: string) => l.startsWith("commit_sha:")),
      "stdout must have commit_sha: line",
    );
    assert.ok(
      stdout.some((l: string) => l.startsWith("summary:")),
      "stdout must have summary: line",
    );

    // Values must match the result.
    assert.ok(
      stdout.some(
        (l: string) => l === `workspace: ${RESULT_WITH_EVIDENCE.workspace!}`,
      ),
      "workspace value must match",
    );
    assert.ok(
      stdout.some(
        (l: string) => l === `commit_sha: ${RESULT_WITH_EVIDENCE.commitSha!}`,
      ),
      "commit_sha value must match",
    );
  });

  test("runGetTask with evidence appends one command → exit code line per evidence entry", async () => {
    const getTask = makeGetTask(COMPLETED_TASK, RESULT_WITH_EVIDENCE);
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);

    // Evidence entries: "npm test → exit 0" and "npm run lint → exit 0"
    assert.ok(
      r.stdout.some((l: string) => l === "npm test → exit 0"),
      `expected 'npm test → exit 0' in stdout; got: ${JSON.stringify(r.stdout)}`,
    );
    assert.ok(
      r.stdout.some((l: string) => l === "npm run lint → exit 0"),
      "expected 'npm run lint → exit 0' in stdout",
    );
  });

  test("runGetTask --json carries result object with full evidence array including outputs", async () => {
    const getTask = makeGetTask(COMPLETED_TASK, RESULT_WITH_EVIDENCE);
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, json: true },
      getTask,
    );

    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1, "--json must produce one stdout line");

    const parsed = JSON.parse(r.stdout[0]!) as {
      id: string;
      title: string;
      status: string;
      agent: string;
      result: {
        workspace: string;
        branch: string;
        commitSha: string;
        summary: string;
        evidence: Array<{ command: string; exitCode: number; output: string }>;
      };
    };

    assert.equal(parsed.id, TASK_ID);
    assert.equal(parsed.status, "completed");
    assert.ok(parsed.result !== undefined, "result must be in JSON");
    assert.equal(parsed.result.commitSha, "deadbeef");
    assert.ok(Array.isArray(parsed.result.evidence), "evidence must be array");
    assert.equal(parsed.result.evidence.length, 2);
    assert.equal(
      parsed.result.evidence[0]!.output,
      "all passed",
      "full output included",
    );
  });

  test("runGetTask result-less task prints id, title, status, agent but no workspace or branch lines", async () => {
    const getTask = makeGetTask(COMPLETED_TASK, undefined);
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);
    assert.ok(
      r.stdout.some((l: string) => l.startsWith("id:")),
      "id: line present",
    );
    assert.ok(
      r.stdout.some((l: string) => l.startsWith("title:")),
      "title: line present",
    );
    assert.ok(
      r.stdout.some((l: string) => l.startsWith("status:")),
      "status: line present",
    );
    assert.ok(
      r.stdout.some((l: string) => l.startsWith("agent:")),
      "agent: line present",
    );

    assert.ok(
      !r.stdout.some((l: string) => l.startsWith("workspace:")),
      "no workspace: line for result-less task",
    );
    assert.ok(
      !r.stdout.some((l: string) => l.startsWith("commit_sha:")),
      "no commit_sha: line for result-less task",
    );
  });

  test("runGetTask completed result without evidence prints no evidence lines", async () => {
    const getTask = makeGetTask(COMPLETED_TASK, RESULT_NO_EVIDENCE);
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);

    // workspace/branch/commit_sha/summary lines must be present.
    assert.ok(
      r.stdout.some((l: string) => l.startsWith("workspace:")),
      "workspace: line present",
    );
    assert.ok(
      r.stdout.some((l: string) => l.startsWith("commit_sha:")),
      "commit_sha: line present",
    );

    // No evidence-style lines (format: "<command> → exit <code>").
    const evidenceLines = r.stdout.filter((l: string) =>
      l.includes(" → exit "),
    );
    assert.equal(
      evidenceLines.length,
      0,
      `no evidence lines expected; found: ${JSON.stringify(evidenceLines)}`,
    );
  });

  test("runGetTask failed task with a result reason prints a reason: line and no attempts: line (Story 02)", async () => {
    const FAILED_TASK: Task = { ...COMPLETED_TASK, status: "failed" };
    const RESULT_WITH_REASON: TaskResultRow = {
      workspace: null,
      branch: null,
      baseCommit: null,
      proposalCommit: null,
      commitSha: null,
      summary: null,
      reason: "VerificationFailedError: x (exit 1)",
      rejectionResolution: null,
      rejectionReason: null,
      evidence: null,
    };
    const getTask = makeGetTask(FAILED_TASK, RESULT_WITH_REASON);
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);
    assert.ok(
      r.stdout.some(
        (l: string) => l === "reason: VerificationFailedError: x (exit 1)",
      ),
      `expected exact 'reason: VerificationFailedError: x (exit 1)' line; got: ${JSON.stringify(r.stdout)}`,
    );
    assert.ok(
      !r.stdout.some((l: string) => l.startsWith("attempts:")),
      "no attempts: line must be printed",
    );
  });

  test("runGetTask unknown id returns exit 1 with one error line starting error:", async () => {
    const getTask = makeGetTask(undefined, undefined);
    const r: HandlerResult = await runGetTask(
      { id: "01JZZZZZZZZZZZZZZZZZZZUNK1" },
      getTask,
    );

    assert.equal(r.exitCode, 1, "exit 1 for unknown id");
    assert.equal(r.stderr.length, 1, "exactly one stderr line");
    assert.ok(
      r.stderr[0]!.startsWith("error:"),
      `stderr must start with 'error:': ${r.stderr[0]}`,
    );
    assert.deepEqual(r.stdout, [], "stdout empty on error");
  });

  // ---------------------------------------------------------------------------
  // Story 08 T2 — --result render + --json context + mutual-exclusion guard
  // ---------------------------------------------------------------------------

  const RESULT_FOR_T2: TaskResultRow = {
    workspace: "/ws/task-t2",
    branch: "kanthord/task-t2",
    baseCommit: "base000",
    proposalCommit: null,
    commitSha: "abc123",
    summary: "done",
    reason: null,
    rejectionResolution: null,
    rejectionReason: null,
    evidence: [{ command: "npm test", exitCode: 0, output: "ok" }],
  };

  type LandingCandidateOutput = {
    state: "pending" | "landed" | "conflict";
    baseSHA: string;
    candidateSHA: string;
    target: string;
  } | null;

  function makeStubGetTask(
    output: Partial<{
      id: string;
      title: string;
      status: string;
      agent: string | undefined;
      objectiveId: string;
      dependencies: string[];
      result: TaskResultRow | undefined;
      context: Record<string, string> | undefined;
      landingCandidate: LandingCandidateOutput;
      abandoning: boolean;
      waiting: UnsatisfiedEdge[];
      blockedForever: boolean;
      downstream: number;
      action: Action | null;
    }>,
  ): GetTask {
    return {
      execute: async () => ({
        id: output.id ?? TASK_ID,
        title: output.title ?? "stub title",
        status: output.status ?? "completed",
        agent: output.agent,
        objectiveId: "OBJ-1",
        dependencies: [],
        result: output.result,
        context: output.context,
        landingCandidate:
          output.landingCandidate === undefined
            ? null
            : output.landingCandidate,
        // Story 6 — EPIC 013 abandoned marker (default false: a non-abandoning
        // task is byte-identical to today's JSON / human output).
        abandoning: output.abandoning ?? false,
        // Story 7 — EPIC 016 graph fields (defaults: empty/zero/null so a
        // happy-path stub is byte-identical to the pre-Story-7 human output).
        waiting: output.waiting ?? [],
        blockedForever: output.blockedForever ?? false,
        downstream: output.downstream ?? 0,
        action: output.action === undefined ? null : output.action,
      }),
    } as unknown as GetTask;
  }

  test("T2a: runGetTask --result renders Summary, Commit, commitSha, command, exit 0", async () => {
    const getTask = makeStubGetTask({ result: RESULT_FOR_T2 });
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, result: true },
      getTask,
    );
    const out = r.stdout.join("\n");
    assert.equal(r.exitCode, 0, "--result with a result must exit 0");
    assert.ok(
      out.includes("Summary"),
      `stdout must include 'Summary'; got: ${out}`,
    );
    assert.ok(
      out.includes("Commit"),
      `stdout must include 'Commit'; got: ${out}`,
    );
    assert.ok(
      out.includes("abc123"),
      `stdout must include commitSha 'abc123'; got: ${out}`,
    );
    assert.ok(
      out.includes("npm test"),
      `stdout must include command 'npm test'; got: ${out}`,
    );
    assert.ok(
      out.includes("exit 0"),
      `stdout must include 'exit 0'; got: ${out}`,
    );
  });

  test("T2b: runGetTask --result with result undefined returns exitCode 1 mentioning no result", async () => {
    const getTask = makeStubGetTask({ result: undefined });
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, result: true },
      getTask,
    );
    assert.equal(r.exitCode, 1, "--result with no result must exit 1");
    assert.ok(
      r.stderr[0]!.includes("no result"),
      `stderr must mention 'no result'; got: ${r.stderr[0]}`,
    );
  });

  test("T2c: runGetTask --json includes context field when context non-empty", async () => {
    const getTask = makeStubGetTask({
      context: { repository: "REPO-1" },
      result: undefined,
    });
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, json: true },
      getTask,
    );
    assert.equal(r.exitCode, 0, "--json must exit 0");
    const parsed = JSON.parse(r.stdout[0]!) as {
      context?: Record<string, string>;
    };
    assert.ok(
      parsed.context !== undefined,
      "--json output must include context field",
    );
    assert.equal(
      parsed.context!.repository,
      "REPO-1",
      "context.repository must match",
    );
  });

  test("T2d: runGetTask --result --json together returns exitCode 1 mentioning mutually exclusive", async () => {
    const getTask = makeStubGetTask({ result: RESULT_FOR_T2 });
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, result: true, json: true },
      getTask,
    );
    assert.equal(r.exitCode, 1, "--result --json must exit 1");
    assert.ok(
      /mutually exclusive/i.test(r.stderr[0] ?? ""),
      `stderr must mention 'mutually exclusive'; got: ${r.stderr[0]}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Story A (007.10 F1) — landingCandidate surfaces in human + --json output.
  // ---------------------------------------------------------------------------

  const PENDING_LANDING_CANDIDATE: LandingCandidateOutput = {
    state: "pending",
    baseSHA: "base111",
    candidateSHA: "cand111",
    target: "main",
  };

  test("(Story A) runGetTask human output shows the candidate state line when landingCandidate is present", async () => {
    const getTask = makeStubGetTask({
      landingCandidate: PENDING_LANDING_CANDIDATE,
    });
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);
    const out = r.stdout.join("\n");
    assert.ok(
      /landing.?candidate/i.test(out) || /candidate.*pending/i.test(out),
      `stdout must show the candidate state; got: ${out}`,
    );
    assert.ok(
      out.includes("pending"),
      `stdout must mention state; got: ${out}`,
    );
    assert.ok(
      out.includes("base111") && out.includes("cand111"),
      `stdout must mention the base/candidate SHAs; got: ${out}`,
    );
  });

  test("(Story A) runGetTask human output omits the candidate line when landingCandidate is null", async () => {
    const getTask = makeStubGetTask({ landingCandidate: null });
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);
    const out = r.stdout.join("\n");
    assert.ok(
      !/landing.?candidate/i.test(out),
      `stdout must not mention a candidate line when null; got: ${out}`,
    );
  });

  test("(Story A) runGetTask --json round-trips landingCandidate", async () => {
    const getTask = makeStubGetTask({
      landingCandidate: PENDING_LANDING_CANDIDATE,
    });
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, json: true },
      getTask,
    );

    assert.equal(r.exitCode, 0);
    const parsed = JSON.parse(r.stdout[0]!) as {
      landingCandidate: LandingCandidateOutput;
    };
    assert.deepEqual(parsed.landingCandidate, PENDING_LANDING_CANDIDATE);
  });

  test("(Story A) runGetTask --json shows landingCandidate as null when absent", async () => {
    const getTask = makeStubGetTask({ landingCandidate: null });
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, json: true },
      getTask,
    );

    assert.equal(r.exitCode, 0);
    const parsed = JSON.parse(r.stdout[0]!) as {
      landingCandidate: LandingCandidateOutput;
    };
    assert.equal(parsed.landingCandidate, null);
  });

  // ---------------------------------------------------------------------------
  // EPIC 013 Story 6 — `abandoning` field surfaces on `get task --json` and on
  // the human-readable output. The field is a marker on a `running` task whose
  // lease has been revoked; it is not a new lifecycle state.
  // ---------------------------------------------------------------------------

  test("(013 S6) runGetTask --json includes 'abandoning: false' by default (no RunningJobSource)", async () => {
    const getTask = makeStubGetTask({});
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID, json: true },
      getTask,
    );

    assert.equal(r.exitCode, 0);
    const parsed = JSON.parse(r.stdout[0]!) as { abandoning: boolean };
    assert.equal(
      parsed.abandoning,
      false,
      "abandoning must default to false on --json output",
    );
  });

  test("(013 S6) runGetTask human output gains the 'abandoning: true' line only when the output carries abandoning=true", async () => {
    const getTaskAbandoning = makeStubGetTask({});
    const r: HandlerResult = await runGetTask(
      { id: TASK_ID },
      getTaskAbandoning,
    );
    // The stub does NOT carry `abandoning: true` — the human output must be
    // unchanged (no `abandoning:` line). This pins the regression-guard that
    // a non-abandoning task is byte-identical to today's output.
    assert.equal(r.exitCode, 0);
    assert.ok(
      !r.stdout.some((l) => l.startsWith("abandoning:")),
      `human output must NOT include an 'abandoning:' line for a non-abandoning task; got: ${JSON.stringify(r.stdout)}`,
    );

    // Now drive the same handler with a GetTask that has abandoning=true.
    // Re-use the underlying GetTask (mem) instead of a stub so the new
    // `abandoning` plumbing round-trips end to end.
    const RUNNING_TASK: Task = { ...COMPLETED_TASK, status: "running" };
    const tasks = new MemTaskSource([RUNNING_TASK]);
    const results = new MemResultSource(new Map());
    const jobs = {
      listRunningJobsForTask: (_id: string): Array<{ revoked: boolean }> => [
        { revoked: true },
      ],
    };
    const getTaskAbandoningReal = new GetTask(
      tasks,
      results,
      nullContextSource,
      undefined,
      jobs,
    );
    const r2: HandlerResult = await runGetTask(
      { id: TASK_ID },
      getTaskAbandoningReal,
    );
    assert.equal(r2.exitCode, 0);
    assert.ok(
      r2.stdout.some((l) => l === "abandoning: true"),
      `human output must include 'abandoning: true' when the source reports a revoked job; got: ${JSON.stringify(r2.stdout)}`,
    );
    // And status stays `running` — the marker is on a running task.
    assert.ok(
      r2.stdout.some((l) => l === "status: running"),
      `status must stay 'running' alongside the abandoning marker; got: ${JSON.stringify(r2.stdout)}`,
    );
  });

  // -------------------------------------------------------------------------
  // EPIC 016 Story 7 — `get task` text output gains the `blocked forever:` and
  // `action:` lines from the graph read model. The new lines must appear
  // ONLY under the conditions the Story 7 §Change spec pins; every other
  // pre-Story-7 test must keep passing because the lines are absent by
  // default (the stub defaults to `blockedForever: false`, `action: null`).
  // -------------------------------------------------------------------------

  test("(016 S7) runGetTask human output gains a 'blocked forever: yes (dependency <id> can never clear)' line only when blockedForever is true", async () => {
    const deadId = "01JZZZZZZZZZZZZZZZZZZZS7DEAD";
    const getTask = makeStubGetTask({
      blockedForever: true,
      action: {
        kind: "remove-dependency",
        target: { type: "task", id: TASK_ID },
        targetDependencyId: deadId,
        requiresInput: [],
      },
    });
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);
    const blockedLine = r.stdout.find((l) => l.startsWith("blocked forever:"));
    assert.ok(
      blockedLine !== undefined,
      `human output must include a 'blocked forever:' line when blockedForever is true; got: ${JSON.stringify(r.stdout)}`,
    );
    assert.ok(
      blockedLine!.includes(deadId),
      `blocked forever: line must name the dead dependency id; got: ${blockedLine}`,
    );
    assert.ok(
      blockedLine!.includes("can never clear"),
      `blocked forever: line must carry the 'can never clear' clause; got: ${blockedLine}`,
    );
  });

  test("(016 S7) runGetTask human output gains an 'action: <kind> <target.type>:<target.id>' line only when action !== null", async () => {
    const getTask = makeStubGetTask({
      action: {
        kind: "retry",
        target: { type: "task", id: TASK_ID },
        requiresInput: [],
      },
    });
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);
    const actionLine = r.stdout.find((l) => l.startsWith("action:"));
    assert.ok(
      actionLine !== undefined,
      `human output must include an 'action:' line when action is non-null; got: ${JSON.stringify(r.stdout)}`,
    );
    assert.ok(
      actionLine!.includes("retry"),
      `action line must include the action kind; got: ${actionLine}`,
    );
    assert.ok(
      actionLine!.includes(`task:${TASK_ID}`),
      `action line must include the scoped target as 'task:<id>'; got: ${actionLine}`,
    );
  });

  test("(016 S7) runGetTask human output for a default (non-blocked, action-null) task includes NO 'blocked forever:' or 'action:' line", async () => {
    const getTask = makeStubGetTask({}); // defaults: blockedForever false, action null
    const r: HandlerResult = await runGetTask({ id: TASK_ID }, getTask);

    assert.equal(r.exitCode, 0);
    assert.ok(
      !r.stdout.some((l) => l.startsWith("blocked forever:")),
      `human output must NOT include a 'blocked forever:' line when blockedForever is false; got: ${JSON.stringify(r.stdout)}`,
    );
    assert.ok(
      !r.stdout.some((l) => l.startsWith("action:")),
      `human output must NOT include an 'action:' line when action is null; got: ${JSON.stringify(r.stdout)}`,
    );
  });
});
