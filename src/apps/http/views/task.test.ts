import { test } from "node:test";
import assert from "node:assert/strict";
import { taskRowView, taskDetailView } from "./task.ts";
import type { TaskRow } from "../../../app/task/list-tasks.ts";
import type { GetTaskOutput } from "../../../app/task/get-task.ts";

test("taskRowView key set is exactly the six declared fields, dropping an injected extra", () => {
  const result = {
    id: "t1",
    title: "task one",
    status: "pending",
    state: "ready",
    dependencies: ["dep-1"],
    waiting: ["dep-2"],
    extra: "leak-me",
  } as unknown as TaskRow;
  const view = taskRowView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "dependencies",
    "id",
    "state",
    "status",
    "title",
    "waiting",
  ]);
  assert.equal(view.id, "t1");
  assert.equal(view.title, "task one");
  assert.equal(view.status, "pending");
  assert.equal(view.state, "ready");
  assert.deepEqual(view.dependencies, ["dep-1"]);
  assert.deepEqual(view.waiting, ["dep-2"]);
});

function absentOptionalFixture(): GetTaskOutput {
  return {
    id: "t1",
    title: "task one",
    status: "pending",
    agent: undefined,
    objectiveId: "obj-1",
    dependencies: [],
    result: undefined,
    landingCandidate: null,
    abandoning: false,
    waiting: [],
    blockedForever: false,
    downstream: 0,
    action: null,
  };
}

test("taskDetailView case 1: every optional absent, every nullable null", () => {
  const view = taskDetailView(absentOptionalFixture()) as unknown as Record<
    string,
    unknown
  >;
  const keys = Object.keys(view);
  assert.ok(keys.includes("result"));
  assert.ok(keys.includes("landingCandidate"));
  assert.ok(keys.includes("action"));
  assert.equal(view.result, null);
  assert.equal(view.landingCandidate, null);
  assert.equal(view.action, null);
  assert.equal(keys.includes("note"), false);
  assert.equal(keys.includes("instructions"), false);
  assert.equal(keys.includes("ac"), false);
  assert.equal(keys.includes("verification"), false);
  assert.equal(keys.includes("agent"), false);
  assert.equal(keys.includes("dependencyStatus"), false);
  assert.equal(keys.includes("context"), false);
});

function fullFixture(): GetTaskOutput {
  return {
    id: "t1",
    title: "task one",
    status: "running",
    agent: "agent-x",
    objectiveId: "obj-1",
    dependencies: ["dep-1"],
    note: "note text",
    instructions: "do it",
    ac: ["ac-1"],
    verification: ["v-1"],
    result: {
      workspace: "/tmp/ws",
      branch: "kanthord/t1",
      baseCommit: "sha-base",
      proposalCommit: "sha-proposal",
      commitSha: "sha-final",
      summary: "did the thing",
      reason: null,
      rejectionResolution: null,
      rejectionReason: null,
      evidence: [
        { command: "npm test", exitCode: 0, output: "ok", extra: "leak-me" },
      ],
      extra: "leak-me",
    } as unknown as GetTaskOutput["result"],
    dependencyStatus: [
      { id: "dep-1", status: "completed", extra: "leak-me" } as unknown as {
        id: string;
        status: string;
      },
    ],
    context: { key: "value" },
    landingCandidate: {
      state: "pending",
      baseSHA: "sha-a",
      candidateSHA: "sha-b",
      target: "main",
      extra: "leak-me",
    } as unknown as GetTaskOutput["landingCandidate"],
    abandoning: true,
    waiting: [
      { id: "dep-2", neverSatisfies: false, extra: "leak-me" } as unknown as {
        id: string;
        neverSatisfies: boolean;
      },
    ],
    blockedForever: false,
    downstream: 3,
    action: {
      kind: "approve",
      target: { type: "task", id: "t1" },
      requiresInput: [],
      extra: "leak-me",
    } as unknown as GetTaskOutput["action"],
  };
}

test("taskDetailView case 2: every field populated, nested key sets exact, no injected extra survives", () => {
  const view = taskDetailView(fullFixture()) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(view).sort(), [
    "abandoning",
    "ac",
    "action",
    "agent",
    "blockedForever",
    "context",
    "dependencies",
    "dependencyStatus",
    "downstream",
    "id",
    "instructions",
    "landingCandidate",
    "note",
    "objectiveId",
    "result",
    "status",
    "title",
    "verification",
    "waiting",
  ]);

  const result = view.result as Record<string, unknown>;
  assert.deepEqual(Object.keys(result).sort(), [
    "baseCommit",
    "branch",
    "commitSha",
    "evidence",
    "proposalCommit",
    "reason",
    "rejectionReason",
    "rejectionResolution",
    "summary",
    "workspace",
  ]);
  const evidence0 = (result.evidence as unknown[])[0] as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(evidence0).sort(), [
    "command",
    "exitCode",
    "output",
  ]);

  const landingCandidate = view.landingCandidate as Record<string, unknown>;
  assert.deepEqual(Object.keys(landingCandidate).sort(), [
    "baseSHA",
    "candidateSHA",
    "state",
    "target",
  ]);

  const dependencyStatus0 = (view.dependencyStatus as unknown[])[0] as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(dependencyStatus0).sort(), ["id", "status"]);

  const waiting0 = (view.waiting as unknown[])[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(waiting0).sort(), ["id", "neverSatisfies"]);

  const action = view.action as Record<string, unknown>;
  assert.deepEqual(Object.keys(action).sort(), [
    "kind",
    "requiresInput",
    "target",
  ]);
});
