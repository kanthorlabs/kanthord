import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RegistryRunnerResolver } from "./resolver.ts";
import { FakeRunner } from "./fake.ts";
import { RunnerNotResolvableError } from "./port.ts";
import type { Task } from "../domain/task.ts";

const stubTask = (id: string, agent: string = "generic@1"): Task => ({
  id,
  objectiveId: "obj-1",
  title: "stub task",
  status: "pending",
  dependencies: [],
  agent,
});

describe("src/agent-runner/resolver.ts", () => {
  // (a) for(task{agent:'generic@1'}) → the registered runner
  it("for(task{agent:'generic@1'}) returns the registered generic@1 runner", () => {
    const runner1 = new FakeRunner({});
    const runner2 = new FakeRunner({});
    const resolver = new RegistryRunnerResolver({
      runners: new Map([
        ["generic@1", runner1],
        ["fake@1", runner2],
      ]),
    });

    const result = resolver.for(stubTask("t-1", "generic@1"), []);

    assert.equal(result, runner1, "returns the generic@1 runner, not fake@1");
    assert.notEqual(result, runner2);
  });

  // (b) for(task{agent:'ghost@9'}) → throws RunnerNotResolvableError { taskId, agent }
  it("for(task{agent:'ghost@9'}) throws RunnerNotResolvableError carrying taskId and agent ref", () => {
    const resolver = new RegistryRunnerResolver({
      runners: new Map([["generic@1", new FakeRunner({})]]),
    });
    const task = stubTask("t-2", "ghost@9");

    assert.throws(
      () => resolver.for(task, []),
      (err: unknown) => {
        assert.ok(err instanceof RunnerNotResolvableError);
        assert.equal(err.taskId, task.id);
        // After re-key the error carries `agent`, not `resourceId`
        assert.equal(
          (err as unknown as { agent: string }).agent,
          "ghost@9",
          "error.agent is the unregistered agent ref",
        );
        return true;
      },
    );
  });
});
