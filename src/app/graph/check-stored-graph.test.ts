import { test } from "node:test";
import assert from "node:assert/strict";
import { CheckStoredGraph } from "./check-stored-graph.ts";
import { UnknownDependencyError } from "../../domain/graph.ts";
import type { TaskRepository } from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";

function makeTask(
  id: string,
  initiativeId: string,
  status: Task["status"],
  dependencies: string[],
): Task {
  return { id, objectiveId: initiativeId, title: id, status, dependencies };
}

class StubTaskRepository implements TaskRepository {
  private readonly tasks: Task[];

  constructor(tasks: Task[]) {
    this.tasks = tasks;
  }

  save(_task: Task): void {}

  saveAll(_tasks: Task[]): void {}

  get(_id: string): Task | undefined {
    return undefined;
  }

  listByInitiative(_initiativeId: string): Task[] {
    return [...this.tasks];
  }

  saveTaskContext(_taskId: string, _context: Record<string, string>): void {}

  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }

  addDependency(_taskId: string, _dependsOn: string): void {}

  removeDependency(_taskId: string, _dependsOn: string): void {}

  listTasksByObjective(_objectiveId: string): Task[] {
    return [];
  }

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

test("CheckStoredGraph.execute returns ready/blocked report for a diamond graph with mixed statuses", async () => {
  const initiativeId = "init-1";
  // Diamond: root(completed) ← left(pending), right(pending) ← bottom(pending)
  const root = makeTask("id-root", initiativeId, "completed", []);
  const left = makeTask("id-left", initiativeId, "pending", ["id-root"]);
  const right = makeTask("id-right", initiativeId, "pending", ["id-root"]);
  const bottom = makeTask("id-bottom", initiativeId, "pending", [
    "id-left",
    "id-right",
  ]);

  const repo = new StubTaskRepository([root, left, right, bottom]);
  const uc = new CheckStoredGraph(repo);

  const report = await uc.execute({ initiativeId });

  // Only pending tasks appear; root is completed so excluded
  assert.equal(report.length, 3);

  const leftEntry = report.find((e) => e.id === "id-left");
  const rightEntry = report.find((e) => e.id === "id-right");
  const bottomEntry = report.find((e) => e.id === "id-bottom");

  assert.ok(leftEntry, "leftEntry must be defined");
  assert.equal(leftEntry.state, "ready");
  assert.deepEqual(leftEntry.waiting, []);

  assert.ok(rightEntry, "rightEntry must be defined");
  assert.equal(rightEntry.state, "ready");
  assert.deepEqual(rightEntry.waiting, []);

  assert.ok(bottomEntry, "bottomEntry must be defined");
  assert.equal(bottomEntry.state, "blocked");
  assert.deepEqual(bottomEntry.waiting, ["id-left", "id-right"]);
});

test("CheckStoredGraph.execute returns [] for an empty initiative", async () => {
  const repo = new StubTaskRepository([]);
  const uc = new CheckStoredGraph(repo);

  const report = await uc.execute({ initiativeId: "init-empty" });

  assert.deepEqual(report, []);
});

test("CheckStoredGraph.execute propagates UnknownDependencyError for a dangling dependency", async () => {
  const initiativeId = "init-bad";
  // task-a depends on 'missing' which is not in the initiative
  const taskA = makeTask("id-a", initiativeId, "pending", ["id-missing"]);

  const repo = new StubTaskRepository([taskA]);
  const uc = new CheckStoredGraph(repo);

  await assert.rejects(
    () => uc.execute({ initiativeId }),
    UnknownDependencyError,
  );
});
