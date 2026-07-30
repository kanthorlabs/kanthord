import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventView,
  unsatisfiedEdgeView,
  taskResultView,
  repositoryAuthView,
  idView,
  idsView,
  type EventResult,
} from "./shared.ts";

test("eventView with all optional ids absent gives exactly ['id','type']", () => {
  const result: EventResult = { id: "ev-1", type: "task.completed" };
  const view = eventView(result);
  assert.deepEqual(Object.keys(view).sort(), ["id", "type"]);
  assert.equal(view.id, "ev-1");
  assert.equal(view.type, "task.completed");
});

test("eventView with all optional fields present gives the full 7-key set", () => {
  const result: EventResult = {
    id: "ev-1",
    type: "task.completed",
    taskId: "task-1",
    objectiveId: "obj-1",
    initiativeId: "init-1",
    repositoryId: "repo-1",
    payload: { note: "x" },
  };
  const view = eventView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "id",
    "initiativeId",
    "objectiveId",
    "payload",
    "repositoryId",
    "taskId",
    "type",
  ]);
  assert.equal(view.taskId, "task-1");
  assert.equal(view.objectiveId, "obj-1");
  assert.equal(view.initiativeId, "init-1");
  assert.equal(view.repositoryId, "repo-1");
  assert.deepEqual(view.payload, { note: "x" });
});

test("unsatisfiedEdgeView gives exactly ['id','neverSatisfies']", () => {
  const view = unsatisfiedEdgeView({ id: "edge-1", neverSatisfies: true });
  assert.deepEqual(Object.keys(view).sort(), ["id", "neverSatisfies"]);
  assert.equal(view.id, "edge-1");
  assert.equal(view.neverSatisfies, true);
});

test("repositoryAuthView for kind 'https-token' with credentialId undefined never emits a credentialId key", () => {
  const view = repositoryAuthView({
    kind: "https-token",
    credentialId: undefined,
  });
  assert.deepEqual(Object.keys(view).sort(), ["kind"]);
  assert.equal("credentialId" in view, false);
});

test("taskResultView keeps evidence null when the source has none", () => {
  const view = taskResultView({
    workspace: null,
    branch: null,
    baseCommit: null,
    proposalCommit: null,
    commitSha: null,
    summary: null,
    reason: null,
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  });
  assert.equal(view.evidence, null);
});

test("taskResultView maps a populated evidence array element-wise, exactly three keys each", () => {
  const view = taskResultView({
    workspace: "/tmp/ws",
    branch: "kanthord/t1",
    baseCommit: "sha-base",
    proposalCommit: "sha-proposal",
    commitSha: "sha-final",
    summary: "did the thing",
    reason: null,
    rejectionResolution: null,
    rejectionReason: null,
    evidence: [{ command: "npm test", exitCode: 0, output: "ok" }],
  });
  assert.equal(Array.isArray(view.evidence), true);
  const evidence = view.evidence as unknown as Array<Record<string, unknown>>;
  assert.equal(evidence.length, 1);
  const first = evidence[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(first).sort(), [
    "command",
    "exitCode",
    "output",
  ]);
  assert.equal(first.command, "npm test");
  assert.equal(first.exitCode, 0);
  assert.equal(first.output, "ok");
});

test("idView('x') gives exactly ['id']", () => {
  const view = idView("x");
  assert.deepEqual(Object.keys(view), ["id"]);
  assert.equal(view.id, "x");
});

test("idsView gives exactly ['ids'], a deep-equal but distinct array reference", () => {
  const input = ["a", "b"];
  const view = idsView(input);
  assert.deepEqual(Object.keys(view), ["ids"]);
  assert.deepEqual(view.ids, ["a", "b"]);
  assert.notEqual(view.ids, input);
});
