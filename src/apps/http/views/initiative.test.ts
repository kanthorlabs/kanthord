import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initiativeView,
  initiativeDetailView,
  initiativeGraphView,
  type InitiativeResult,
} from "./initiative.ts";
import type { GetInitiativeOutput } from "../../../app/initiative/get-initiative.ts";
import type { GetInitiativeGraphOutput } from "../../../app/initiative/get-initiative-graph.ts";

test("initiativeView omits status and workspace when absent from the source, and drops an injected extra", () => {
  const result = {
    id: "i1",
    projectId: "p1",
    name: "init one",
    paused: false,
    extra: "leak-me",
  } as unknown as InitiativeResult;
  const view = initiativeView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "id",
    "name",
    "paused",
    "projectId",
  ]);
  assert.equal(view.id, "i1");
  assert.equal(view.projectId, "p1");
  assert.equal(view.name, "init one");
  assert.equal(view.paused, false);
});

test("initiativeView includes status and workspace when present in the source", () => {
  const result: InitiativeResult = {
    id: "i1",
    projectId: "p1",
    name: "init one",
    paused: true,
    status: "building",
    workspace: "/tmp/ws",
  };
  const view = initiativeView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "id",
    "name",
    "paused",
    "projectId",
    "status",
    "workspace",
  ]);
  assert.equal(view.status, "building");
  assert.equal(view.workspace, "/tmp/ws");
});

test("initiativeDetailView key set is exactly the declared list; waiting is mapped through unsatisfiedEdgeView, dropping an injected extra on the edge", () => {
  const result = {
    id: "i1",
    projectId: "p1",
    name: "init one",
    status: "building",
    paused: false,
    branch: "kanthord/init/i1",
    after: ["i0"],
    waiting: [{ id: "i0", neverSatisfies: false, extra: "leak-me" }],
  } as unknown as GetInitiativeOutput;
  const view = initiativeDetailView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "after",
    "branch",
    "id",
    "name",
    "paused",
    "projectId",
    "status",
    "waiting",
  ]);
  assert.equal(view.projectId, "p1");
  assert.deepEqual(view.after, ["i0"]);
  assert.deepEqual(view.waiting, [{ id: "i0", neverSatisfies: false }]);
});

test("initiativeDetailView includes workspace when present in the source", () => {
  const result: GetInitiativeOutput = {
    id: "i1",
    projectId: "p1",
    name: "init one",
    status: "building",
    paused: false,
    branch: "kanthord/init/i1",
    workspace: "/tmp/ws",
    after: [],
    waiting: [],
  };
  const view = initiativeDetailView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "after",
    "branch",
    "id",
    "name",
    "paused",
    "projectId",
    "status",
    "waiting",
    "workspace",
  ]);
  assert.equal(view.workspace, "/tmp/ws");
});

function graphFixture(): GetInitiativeGraphOutput {
  return {
    projectId: "p1",
    initiative: {
      id: "i1",
      name: "init one",
      status: "building",
      paused: false,
      branch: "kanthord/init/i1",
      action: {
        kind: "retry",
        target: { type: "initiative", id: "i1" },
        requiresInput: [],
      },
      extra: "leak-me",
    },
    groups: [
      {
        id: "obj-1",
        name: "objective one",
        status: "building",
        repositories: ["repo-1"],
        commitOid: "abc123",
        conflictReason: "gate failed",
        after: ["obj-0"],
        waiting: [{ id: "obj-0", neverSatisfies: false, extra: "leak-me" }],
        action: {
          kind: "retry",
          target: { type: "objective", id: "obj-1" },
          requiresInput: [],
        },
        extra: "leak-me",
      },
    ],
    nodes: [
      {
        id: "t1",
        groupId: "obj-1",
        title: "task one",
        status: "pending",
        dependencyState: "ready",
        executionState: "runnable",
        dependencies: ["t0"],
        waiting: [{ id: "t0", neverSatisfies: false, extra: "leak-me" }],
        blockedForever: false,
        downstream: 1,
        lastEventId: "01EVENT",
        lastEventAtMs: 123,
        agent: "codex",
        instructions: "do the thing",
        ac: ["ac-1"],
        verificationRequested: ["build"],
        verificationResults: [
          { command: "npm test", exitCode: 0, output: "ok", extra: "leak-me" },
        ],
        failureReason: "boom",
        rejection: { resolution: "retry", reason: "flaky", extra: "leak-me" },
        produced: { summary: "done", evidenceCount: 1, extra: "leak-me" },
        note: "guidance",
        candidate: {
          candidateSHA: "sha1",
          baseSHA: "sha0",
          target: "main",
          state: "pending",
          source: "task_result",
          extra: "leak-me",
        },
        action: {
          kind: "retry",
          target: { type: "task", id: "t1" },
          requiresInput: [],
        },
        extra: "leak-me",
      },
    ],
    edges: [{ from: "t0", to: "t1" }],
    criticalPath: {
      metric: "remaining-node-count",
      nodeIds: ["t1"],
      length: 1,
    },
    counts: {
      pending: 1,
      running: 0,
      completed: 0,
      failed: 0,
      awaiting_confirmation: 0,
      discarded: 0,
      blocked: 0,
      blockedForever: 0,
      actionable: 1,
    },
    extra: "leak-me",
  } as unknown as GetInitiativeGraphOutput;
}

test("initiativeGraphView key sets match the declared literal list at every nesting level, no injected extra survives", () => {
  const view = initiativeGraphView(graphFixture());

  assert.deepEqual(Object.keys(view).sort(), [
    "counts",
    "criticalPath",
    "edges",
    "groups",
    "initiative",
    "nodes",
    "projectId",
  ]);
  assert.equal(view.projectId, "p1");

  const initiative = view.initiative as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(initiative).sort(), [
    "action",
    "branch",
    "id",
    "name",
    "paused",
    "status",
  ]);

  const group = view.groups[0] as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(group).sort(), [
    "action",
    "after",
    "commitOid",
    "conflictReason",
    "id",
    "name",
    "repositories",
    "status",
    "waiting",
  ]);
  assert.deepEqual(group.waiting, [{ id: "obj-0", neverSatisfies: false }]);

  const node = view.nodes[0] as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(node).sort(), [
    "ac",
    "action",
    "agent",
    "blockedForever",
    "candidate",
    "dependencies",
    "dependencyState",
    "downstream",
    "executionState",
    "failureReason",
    "groupId",
    "id",
    "instructions",
    "lastEventAtMs",
    "lastEventId",
    "note",
    "produced",
    "rejection",
    "status",
    "title",
    "verificationRequested",
    "verificationResults",
    "waiting",
  ]);
  assert.deepEqual(node.waiting, [{ id: "t0", neverSatisfies: false }]);

  const verificationResult = (
    node.verificationResults as unknown[]
  )[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(verificationResult).sort(), [
    "command",
    "exitCode",
    "output",
  ]);

  const rejection = node.rejection as Record<string, unknown>;
  assert.deepEqual(Object.keys(rejection).sort(), ["reason", "resolution"]);

  const produced = node.produced as Record<string, unknown>;
  assert.deepEqual(Object.keys(produced).sort(), ["evidenceCount", "summary"]);

  const candidate = node.candidate as Record<string, unknown>;
  assert.deepEqual(Object.keys(candidate).sort(), [
    "baseSHA",
    "candidateSHA",
    "source",
    "state",
    "target",
  ]);

  const criticalPath = view.criticalPath as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(criticalPath).sort(), [
    "length",
    "metric",
    "nodeIds",
  ]);

  const counts = view.counts as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(counts).sort(), [
    "actionable",
    "awaiting_confirmation",
    "blocked",
    "blockedForever",
    "completed",
    "discarded",
    "failed",
    "pending",
    "running",
  ]);
});

test("initiativeGraphView: nullable node fields are present and null when the source has none, not omitted", () => {
  const fixture = graphFixture();
  const nullableFixture: GetInitiativeGraphOutput = {
    ...fixture,
    nodes: [
      {
        ...fixture.nodes[0]!,
        lastEventId: null,
        lastEventAtMs: null,
        agent: null,
        instructions: null,
        failureReason: null,
        rejection: null,
        produced: null,
        note: null,
        candidate: null,
      },
    ],
  };
  const view = initiativeGraphView(nullableFixture);
  const node = view.nodes[0] as unknown as Record<string, unknown>;
  assert.equal("lastEventId" in node, true);
  assert.equal(node.lastEventId, null);
  assert.equal("lastEventAtMs" in node, true);
  assert.equal(node.lastEventAtMs, null);
  assert.equal("agent" in node, true);
  assert.equal(node.agent, null);
  assert.equal("instructions" in node, true);
  assert.equal(node.instructions, null);
  assert.equal("failureReason" in node, true);
  assert.equal(node.failureReason, null);
  assert.equal("rejection" in node, true);
  assert.equal(node.rejection, null);
  assert.equal("produced" in node, true);
  assert.equal(node.produced, null);
  assert.equal("note" in node, true);
  assert.equal(node.note, null);
  assert.equal("candidate" in node, true);
  assert.equal(node.candidate, null);
});
