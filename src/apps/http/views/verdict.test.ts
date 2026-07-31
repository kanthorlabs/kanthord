import { test } from "node:test";
import assert from "node:assert/strict";
import {
  taskApprovalView,
  abandonmentView,
  objectiveApprovalView,
} from "./verdict.ts";
import type { ApproveOutcome } from "../../../app/task/approve-task.ts";
import type { AbandonOutcome } from "../../../app/task/abandon-task.ts";

test("taskApprovalView: approved outcome maps kind to outcome, carries canonicalSHA, drops kind", () => {
  const result: ApproveOutcome = {
    kind: "approved",
    taskId: "t1",
    canonicalSHA: "abc123",
  };
  const view = taskApprovalView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), [
    "canonicalSHA",
    "outcome",
    "taskId",
  ]);
  assert.equal(view.outcome, "approved");
  assert.equal(view.taskId, "t1");
  assert.equal(view.canonicalSHA, "abc123");
  assert.equal("kind" in view, false);
});

test("taskApprovalView: conflict outcome with conflictFiles present is copied, not aliased", () => {
  const files = ["a.ts"];
  const result: ApproveOutcome = {
    kind: "conflict",
    taskId: "t1",
    conflictFiles: files,
  };
  const view = taskApprovalView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), [
    "conflictFiles",
    "outcome",
    "taskId",
  ]);
  assert.equal(view.outcome, "conflict");
  files.push("b.ts");
  assert.deepEqual(view.conflictFiles, ["a.ts"]);
});

test("taskApprovalView: conflict outcome with conflictFiles absent has no conflictFiles key", () => {
  const result: ApproveOutcome = { kind: "conflict", taskId: "t1" };
  const view = taskApprovalView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), ["outcome", "taskId"]);
});

test("taskApprovalView: target_moved outcome has only outcome and taskId", () => {
  const result: ApproveOutcome = { kind: "target_moved", taskId: "t1" };
  const view = taskApprovalView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), ["outcome", "taskId"]);
});

test("taskApprovalView: landing_failed carries message, never cause, never leaks its contents", () => {
  const result: ApproveOutcome = {
    kind: "landing_failed",
    taskId: "t1",
    message: "boom",
    cause: { secret: "leak-me" },
  };
  const view = taskApprovalView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), ["message", "outcome", "taskId"]);
  assert.equal(view.outcome, "landing_failed");
  assert.equal(view.message, "boom");
  assert.equal(JSON.stringify(view).includes("leak-me"), false);
});

// ─── EPIC 023 Story S3 — abandonmentView ───

test("abandonmentView: abandoning outcome presents exactly {outcome, taskId}", () => {
  const result: AbandonOutcome = { outcome: "abandoning", taskId: "t1" };
  const view = abandonmentView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), ["outcome", "taskId"]);
  assert.equal(view.outcome, "abandoning");
  assert.equal(view.taskId, "t1");
});

test("abandonmentView: already_abandoning outcome presents exactly {outcome, taskId}", () => {
  const result: AbandonOutcome = {
    outcome: "already_abandoning",
    taskId: "t1",
  };
  const view = abandonmentView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), ["outcome", "taskId"]);
  assert.equal(view.outcome, "already_abandoning");
});

test("abandonmentView: an extra input field never leaks into the view", () => {
  const result = {
    outcome: "abandoning",
    taskId: "t1",
    extra: "leak-me",
  } as unknown as AbandonOutcome;
  const view = abandonmentView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), ["outcome", "taskId"]);
  assert.equal("extra" in view, false);
});

// ─── EPIC 023 Story S4 — objectiveApprovalView ───

test("objectiveApprovalView: integrated outcome has exactly {outcome}, extras dropped", () => {
  const result = {
    outcome: "integrated",
    extra: "leak-me",
  } as unknown as { outcome: "integrated" | "conflict" };
  const view = objectiveApprovalView(result) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(view), ["outcome"]);
  assert.equal(view.outcome, "integrated");
});

test("objectiveApprovalView: conflict outcome has exactly {outcome}, extras dropped", () => {
  const result = {
    outcome: "conflict",
    extra: "leak-me",
  } as unknown as { outcome: "integrated" | "conflict" };
  const view = objectiveApprovalView(result) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(view), ["outcome"]);
  assert.equal(view.outcome, "conflict");
});
