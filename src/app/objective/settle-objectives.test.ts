// e2e 20260727-132041 B2 — objective integration must be re-entrant.
//
// A crash between "last task completed" and "objective awaiting_confirmation"
// leaves the objective in `building` with every task `completed`. No task is
// left to schedule, so without a startup sweep the initiative can never land.
// Hermetic: fakes for every port, no git, no SQLite.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SettleObjectives } from "./settle-objectives.ts";
import type { Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import type { EventFeed } from "../../events/port.ts";

function makeTask(id: string, status: Task["status"], objectiveId: string) {
  return { id, title: id, status, objectiveId } as unknown as Task;
}

function makeFixture(objectiveStatus: Objective["status"]) {
  const objective: Objective = {
    id: "obj-1",
    initiativeId: "init-1",
    name: "stuck objective",
    status: objectiveStatus,
  } as Objective;

  const saved: Objective[] = [];
  const appended: string[] = [];
  const squashed: Array<{ dir: string; parentOid: string }> = [];

  const initiatives = {
    listAllInitiatives: () => [{ id: "init-1" }],
    get: (_id: string) => ({ workspace: "/ws/init-1" }),
    listObjectives: (_initiativeId: string) => [objective],
  };
  const tasks = {
    listTasksByObjective: (_objectiveId: string) => [
      makeTask("t1", "completed", "obj-1"),
      makeTask("t2", "completed", "obj-1"),
    ],
  };
  const store = {
    getObjective: (id: string) => (id === "obj-1" ? objective : undefined),
    saveObjective: (o: Objective) => {
      saved.push(o);
    },
    getObjectiveParentOid: (_id: string) => "parent-oid-aaa",
  };
  const workspaces = {
    squashObjective: async (dir: string, parentOid: string) => {
      squashed.push({ dir, parentOid });
      return { oid: "squashed-oid-bbb" };
    },
  };
  const feed = {
    append: (event: { type: string }) => {
      appended.push(event.type);
    },
  } as unknown as EventFeed;

  return {
    initiatives,
    tasks,
    store,
    workspaces,
    feed,
    saved,
    appended,
    squashed,
  };
}

test("SettleObjectives: settles a building objective whose every task is completed", async () => {
  const f = makeFixture("building");
  const settled = await new SettleObjectives(
    f.initiatives,
    f.tasks,
    f.store,
    f.workspaces,
    f.feed,
  ).execute();

  assert.deepEqual(settled, ["obj-1"], "the stuck objective is settled");
  assert.equal(f.squashed.length, 1, "the objective was squashed once");
  assert.equal(f.squashed[0]!.dir, "/ws/init-1", "squash used the clone dir");
  assert.equal(f.squashed[0]!.parentOid, "parent-oid-aaa");

  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0]!.status, "awaiting_confirmation");
  assert.equal(f.saved[0]!.commitOid, "squashed-oid-bbb");
  assert.equal(f.saved[0]!.parentOid, "parent-oid-aaa");
  assert.deepEqual(f.appended, ["objective.awaiting_confirmation"]);
});

test("SettleObjectives: an objective past building is left alone (idempotent re-run)", async () => {
  const f = makeFixture("awaiting_confirmation");
  const settled = await new SettleObjectives(
    f.initiatives,
    f.tasks,
    f.store,
    f.workspaces,
    f.feed,
  ).execute();

  assert.deepEqual(settled, [], "nothing to settle");
  assert.equal(f.squashed.length, 0, "no second squash");
  assert.equal(f.saved.length, 0, "no write");
  assert.deepEqual(f.appended, [], "no duplicate event");
});

test("SettleObjectives: an objective with a task still pending is not settled", async () => {
  const f = makeFixture("building");
  const tasks = {
    listTasksByObjective: () => [
      makeTask("t1", "completed", "obj-1"),
      makeTask("t2", "pending", "obj-1"),
    ],
  };
  const settled = await new SettleObjectives(
    f.initiatives,
    tasks,
    f.store,
    f.workspaces,
    f.feed,
  ).execute();

  assert.deepEqual(settled, [], "an unfinished objective is not settled");
  assert.equal(f.squashed.length, 0);
});

test("SettleObjectives: an initiative with no provisioned clone is skipped", async () => {
  const f = makeFixture("building");
  const initiatives = {
    listAllInitiatives: () => [{ id: "init-1" }],
    get: () => ({ workspace: undefined }),
    listObjectives: () =>
      [
        { id: "obj-1", initiativeId: "init-1", name: "x", status: "building" },
      ] as Objective[],
  };
  const settled = await new SettleObjectives(
    initiatives,
    f.tasks,
    f.store,
    f.workspaces,
    f.feed,
  ).execute();

  assert.deepEqual(settled, [], "no clone means nothing ever ran");
  assert.equal(f.squashed.length, 0);
});
