import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeRunner } from "./fake.ts";
import { newTask } from "../domain/task.ts";

describe("src/agent-runner/fake.ts", () => {
  test("FakeRunner.run resolves completed with summary and records the call", async () => {
    const runner = new FakeRunner({});
    const task = newTask({ objectiveId: "obj-1", title: "do work" });

    const result = await runner.run(task, []);

    assert.deepEqual(result, { outcome: "completed", summary: "fake" });
    assert.equal(runner.calls.length, 1);
    assert.deepEqual(runner.calls[0], { taskId: task.id, context: [] });
  });

  test("FakeRunner.run with failTaskIds resolves failed and still records the call", async () => {
    const task = newTask({ objectiveId: "obj-1", title: "do work" });
    const runner = new FakeRunner({ failTaskIds: [task.id] });

    const result = await runner.run(task, []);

    assert.deepEqual(result, { outcome: "failed", reason: "scripted failure" });
    assert.equal(runner.calls.length, 1);
    assert.deepEqual(runner.calls[0], { taskId: task.id, context: [] });
  });

  test("FakeRunner.run records two calls in order", async () => {
    const runner = new FakeRunner({});
    const task1 = newTask({ objectiveId: "obj-1", title: "first" });
    const task2 = newTask({ objectiveId: "obj-1", title: "second" });
    const ctx = [{ type: "repository", resourceId: "repo-42" }];

    await runner.run(task1, []);
    await runner.run(task2, ctx);

    assert.equal(runner.calls.length, 2);
    assert.deepEqual(runner.calls[0], { taskId: task1.id, context: [] });
    assert.deepEqual(runner.calls[1], { taskId: task2.id, context: ctx });
  });
});
