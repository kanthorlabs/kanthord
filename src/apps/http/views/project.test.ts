import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectView,
  projectOverviewView,
  type ProjectResult,
} from "./project.ts";
import { actionView } from "./shared.ts";
import type { GetProjectOverviewOutput } from "../../../app/project/get-project-overview.ts";

test("projectView output key set is exactly id and name, not a spread of extra fields", () => {
  const result = {
    id: "p1",
    name: "alpha",
    projectId: "leak",
    secret: "leak-me",
  } as unknown as ProjectResult;
  const view = projectView(result);
  assert.deepEqual(Object.keys(view).sort(), ["id", "name"]);
  assert.equal(view.id, "p1");
  assert.equal(view.name, "alpha");
});

test("actionView omits targetDependencyId and command when absent from the source", () => {
  const view = actionView({
    kind: "retry",
    target: { type: "task", id: "t1" },
    requiresInput: [],
  });
  assert.deepEqual(Object.keys(view).sort(), [
    "kind",
    "requiresInput",
    "target",
  ]);
  assert.equal("targetDependencyId" in view, false);
  assert.equal("command" in view, false);
});

test("actionView includes targetDependencyId and command when present in the source", () => {
  const view = actionView({
    kind: "remove-dependency",
    target: { type: "task", id: "t1" },
    targetDependencyId: "dep-1",
    requiresInput: [],
    command: "kanthord retry --id t1",
  });
  assert.deepEqual(Object.keys(view).sort(), [
    "command",
    "kind",
    "requiresInput",
    "target",
    "targetDependencyId",
  ]);
  assert.equal(view.targetDependencyId, "dep-1");
  assert.equal(view.command, "kanthord retry --id t1");
});

function overviewFixture(): GetProjectOverviewOutput {
  // Every nested object below carries an injected `extra` field, proven
  // absent from the view's output. Cast once at the top, like the
  // `health.test.ts` leak-test convention, instead of a `@ts-expect-error`
  // per nesting level.
  return {
    projectId: "p1",
    initiatives: [
      {
        id: "init-1",
        name: "init one",
        status: "building",
        paused: false,
        taskCounts: {
          pending: 1,
          running: 0,
          completed: 0,
          failed: 0,
          awaiting_confirmation: 0,
          discarded: 0,
          extra: "leak-me",
        },
        needsHuman: 0,
        action: {
          kind: "retry",
          target: { type: "task", id: "t1" },
          requiresInput: [],
          extra: "leak-me",
        },
        extra: "leak-me",
      },
    ],
    lanes: [
      {
        repositoryId: "repo-1",
        objectiveIds: ["obj-1"],
        initiativeIds: ["init-1"],
        extra: "leak-me",
      },
    ],
    decisions: [
      {
        action: {
          kind: "retry",
          target: { type: "task", id: "t1" },
          requiresInput: [],
        },
        initiativeId: "init-1",
        objectiveId: "obj-1",
        taskId: "t1",
        downstream: 2,
        actionableSince: 123,
        extra: "leak-me",
      },
    ],
    digest: {
      since: null,
      latest: "01ABC",
      totalCount: 1,
      byType: { "task.completed": 1 },
      events: [
        {
          id: "ev-1",
          type: "task.completed",
          taskId: "t1",
          extra: "leak-me",
        },
      ],
      hasMore: false,
      pageCursor: null,
      extra: "leak-me",
    },
    extra: "leak-me",
  } as unknown as GetProjectOverviewOutput;
}

test("projectOverviewView key sets match the declared literal list at every nesting level, no injected extra survives", () => {
  const view = projectOverviewView(overviewFixture());

  assert.deepEqual(Object.keys(view).sort(), [
    "decisions",
    "digest",
    "initiatives",
    "lanes",
    "projectId",
  ]);
  assert.equal(view.projectId, "p1");

  const initiative = view.initiatives[0] as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(initiative).sort(), [
    "action",
    "id",
    "name",
    "needsHuman",
    "paused",
    "status",
    "taskCounts",
  ]);
  assert.deepEqual(
    Object.keys(initiative.taskCounts as Record<string, unknown>).sort(),
    [
      "awaiting_confirmation",
      "completed",
      "discarded",
      "failed",
      "pending",
      "running",
    ],
  );
  assert.deepEqual(
    Object.keys(initiative.action as Record<string, unknown>).sort(),
    ["kind", "requiresInput", "target"],
  );

  const lane = view.lanes[0] as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(lane).sort(), [
    "initiativeIds",
    "objectiveIds",
    "repositoryId",
  ]);

  const decision = view.decisions[0] as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(decision).sort(), [
    "action",
    "actionableSince",
    "downstream",
    "initiativeId",
    "objectiveId",
    "taskId",
  ]);

  const digest = view.digest as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(digest).sort(), [
    "byType",
    "events",
    "hasMore",
    "latest",
    "pageCursor",
    "since",
    "totalCount",
  ]);
  const event = (digest.events as unknown[])[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(event).sort(), ["id", "taskId", "type"]);
});
