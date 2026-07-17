import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RegistryRunnerResolver } from "./resolver.ts";
import { FakeRunner } from "./fake.ts";
import { RunnerNotResolvableError } from "./port.ts";
import type { Task } from "../domain/task.ts";
import type { TaskContextBinding } from "./port.ts";

const stubTask = (id: string): Task => ({
  id,
  objectiveId: "obj-1",
  title: "stub task",
  status: "pending",
  dependencies: [],
});

describe("src/agent-runner/resolver.ts", () => {
  it("for(task, []) returns the default runner when no bindings", () => {
    const defaultRunner = new FakeRunner({});
    const resolver = new RegistryRunnerResolver({ defaultRunner });
    const task = stubTask("t-1");

    const runner = resolver.for(task, []);

    assert.equal(runner, defaultRunner);
  });

  it("for(task, [repository binding]) returns the default runner", () => {
    const defaultRunner = new FakeRunner({});
    const resolver = new RegistryRunnerResolver({ defaultRunner });
    const task = stubTask("t-2");
    const context: TaskContextBinding[] = [
      { type: "repository", resourceId: "repo-abc" },
    ];

    const runner = resolver.for(task, context);

    assert.equal(runner, defaultRunner);
  });

  it("for(task, [ai_provider binding]) throws RunnerNotResolvableError with taskId and resourceId", () => {
    const defaultRunner = new FakeRunner({});
    const resolver = new RegistryRunnerResolver({ defaultRunner });
    const task = stubTask("t-3");
    const resourceId = "provider-xyz";
    const context: TaskContextBinding[] = [{ type: "ai_provider", resourceId }];

    assert.throws(
      () => resolver.for(task, context),
      (err: unknown) => {
        assert.ok(err instanceof RunnerNotResolvableError);
        assert.equal(err.taskId, task.id);
        assert.equal(err.resourceId, resourceId);
        return true;
      },
    );
  });
});
