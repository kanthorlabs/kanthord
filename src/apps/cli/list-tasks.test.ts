import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runListTasks } from "./list-tasks.ts";
import { runCli as dispatch } from "./commands/run-cli.ts";
import type { CliDeps } from "./deps.ts";
import type { TaskRepository } from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";
import { ListTasks } from "../../app/task/list-tasks.ts";

const INITIATIVE_ID = "01JWZYQR00000000000000000A";
const TASK_API_ID = "01JWZYQR00000000000000000B";
const TASK_DEPLOY_ID = "01JWZYQR00000000000000000C";

const API_TASK: Task = {
  id: TASK_API_ID,
  objectiveId: "01JWZYQR00000000000000000D",
  title: "implement api",
  status: "pending",
  dependencies: [],
};

const DEPLOY_TASK: Task = {
  id: TASK_DEPLOY_ID,
  objectiveId: "01JWZYQR00000000000000000D",
  title: "deploy",
  status: "pending",
  dependencies: [TASK_API_ID],
};

class FakeTaskRepository implements TaskRepository {
  save(_task: Task): void {}
  saveAll(_tasks: Task[]): void {}
  get(_id: string): Task | undefined {
    return undefined;
  }
  listByInitiative(_initiativeId: string): Task[] {
    return [API_TASK, DEPLOY_TASK];
  }
  listTasksByObjective(_objectiveId: string): Task[] {
    return [];
  }
  saveTaskContext(_taskId: string, _context: Record<string, string>): void {}
  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }
  addDependency(_taskId: string, _dependencyId: string): void {}
  removeDependency(_taskId: string, _dependencyId: string): void {}
  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  compareAndApply(
    _id: string,
    _expectedSha: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalReparent(_id: string, _expectedSha: string, _objectiveId: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteTask(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
  }
}

// ---------------------------------------------------------------------------
// B1 regression — `list task --status` end-to-end wiring through the CLI
// ---------------------------------------------------------------------------
//
// Two problems originally prevented end-to-end status filtering:
//   1. the "list task" command had no `--status` option → the parser rejected
//      --status → exit 1 before the handler was called.
//   2. runListTasks never read the status arg and never forwarded it to
//      listTasks.execute(), so even if parsed it would be ignored.
//
// This test dispatches through the real Commander CLI path (runCli).

const AWAITING_TASK: Task = {
  id: "01JWZYQR00000000000000000E",
  objectiveId: "01JWZYQR00000000000000000D",
  title: "task awaiting human",
  status: "awaiting_confirmation",
  dependencies: [],
};

const PENDING_TASK: Task = {
  id: "01JWZYQR00000000000000000F",
  objectiveId: "01JWZYQR00000000000000000D",
  title: "pending work item",
  status: "pending",
  dependencies: [],
};

const INITIATIVE_ID_B1 = "01JWZYQR00000000000000000G";

class FakeTaskRepositoryB1 implements TaskRepository {
  save(_task: Task): void {}
  saveAll(_tasks: Task[]): void {}
  get(_id: string): Task | undefined {
    return undefined;
  }
  listByInitiative(_initiativeId: string): Task[] {
    return [AWAITING_TASK, PENDING_TASK];
  }
  listTasksByObjective(_objectiveId: string): Task[] {
    return [];
  }
  saveTaskContext(_taskId: string, _context: Record<string, string>): void {}
  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }
  addDependency(_taskId: string, _dependencyId: string): void {}
  removeDependency(_taskId: string, _dependencyId: string): void {}
  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  compareAndApply(
    _id: string,
    _expectedSha: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalReparent(_id: string, _expectedSha: string, _objectiveId: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteTask(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
  }
}

test("(B1 regression) dispatch list task --status awaiting_confirmation exits 0 and returns only matching tasks", async () => {
  const deps = {
    listTasks: new ListTasks(new FakeTaskRepositoryB1()),
  } as unknown as CliDeps;

  const result = await dispatch(
    [
      "list",
      "task",
      "--initiative",
      INITIATIVE_ID_B1,
      "--status",
      "awaiting_confirmation",
    ],
    deps,
  );

  // Currently exits 1: "list task" parse options lack `status`, so parseArgs
  // strict mode rejects --status as an unknown flag.
  assert.equal(
    result.exitCode,
    0,
    `dispatch must exit 0 for list task --status, got exitCode=${result.exitCode}, stderr=${JSON.stringify(result.stderr)}`,
  );

  const out = result.stdout.join("\n");
  assert.ok(
    out.includes("task awaiting human"),
    `stdout must include the awaiting_confirmation task title, got: ${out}`,
  );
  assert.ok(
    !out.includes("pending work item"),
    `stdout must NOT include the pending task (status filter must work), got: ${out}`,
  );
});

describe("runListTasks", () => {
  test("default output shows ready/blocked with dependency titles on stdout", async () => {
    const args: Record<string, unknown> = { initiative: INITIATIVE_ID };
    const result = await runListTasks(
      args,
      new ListTasks(new FakeTaskRepository()),
    );
    assert.equal(result.exitCode, 0);
    // Stdout must be non-empty (human table)
    assert.ok(result.stdout.length > 0, "stdout must have at least one line");
    const out = result.stdout.join("\n");
    // "implement api" row must appear as ready
    assert.ok(
      out.includes("implement api") && out.includes("ready"),
      `stdout should contain "implement api" and "ready": ${out}`,
    );
    // "deploy" row must appear as blocked with dependency title (not id)
    assert.ok(
      out.includes("deploy") &&
        out.includes("blocked") &&
        out.includes("implement api"),
      `stdout should contain "deploy", "blocked", and "implement api": ${out}`,
    );
    // The dep ID must NOT appear verbatim (titles, not ids, in default output)
    assert.ok(
      !out.includes(TASK_API_ID),
      `stdout must not contain raw dep id ${TASK_API_ID} in default mode: ${out}`,
    );
  });

  test("--json output shows JSON array with dep ids on stdout", async () => {
    const args: Record<string, unknown> = {
      initiative: INITIATIVE_ID,
      json: true,
    };
    const result = await runListTasks(
      args,
      new ListTasks(new FakeTaskRepository()),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout.length,
      1,
      "JSON output must be exactly one stdout line",
    );
    const parsed = JSON.parse(result.stdout[0]!) as Array<{
      id: string;
      title: string;
      status: string;
      state: string;
      waiting: string[];
    }>;
    assert.ok(Array.isArray(parsed), "stdout must parse to an array");
    assert.equal(parsed.length, 2);
    const apiRow = parsed.find((r) => r.id === TASK_API_ID);
    const deployRow = parsed.find((r) => r.id === TASK_DEPLOY_ID);
    assert.ok(apiRow, "API task must be in JSON output");
    assert.ok(deployRow, "deploy task must be in JSON output");
    assert.equal(apiRow!.state, "ready");
    assert.equal(deployRow!.state, "blocked");
    // JSON waiting must contain dep IDs (not titles)
    assert.deepEqual(deployRow!.waiting, [TASK_API_ID]);
  });

  test("S1: --json output includes dependencies array on each row", async () => {
    const args: Record<string, unknown> = {
      initiative: INITIATIVE_ID,
      json: true,
    };
    const result = await runListTasks(
      args,
      new ListTasks(new FakeTaskRepository()),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 1);
    const parsed = JSON.parse(result.stdout[0]!) as Array<{
      id: string;
      dependencies: string[];
      waiting: string[];
    }>;
    const apiRow = parsed.find((r) => r.id === TASK_API_ID);
    const deployRow = parsed.find((r) => r.id === TASK_DEPLOY_ID);
    assert.ok(apiRow, "API task must be in JSON output");
    assert.ok(deployRow, "deploy task must be in JSON output");
    // root has no declared edges
    assert.deepEqual(
      apiRow!.dependencies,
      [],
      "root task JSON must carry dependencies: []",
    );
    // sibling declares one edge to root
    assert.deepEqual(
      deployRow!.dependencies,
      [TASK_API_ID],
      "sibling task JSON must carry dependencies: [TASK_API_ID]",
    );
    // both waiting and dependencies must be present
    assert.deepEqual(deployRow!.waiting, [TASK_API_ID]);
  });
});
