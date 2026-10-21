import assert from "node:assert/strict";
import test from "node:test";
import { stopRun } from "./stop-steps.mjs";

function stopSteps(calls) {
  return {
    pauseProject: async () => {
      calls.push("pause");
      return { id: "project_1" };
    },
    stopInstances: async () => {
      calls.push("stop instances");
      return [
        { name: "e2e-coder-1", pid: 4242, result: "stopped" },
        { name: "e2e-reviewer-1", result: "not running" },
      ];
    },
    stopDevDaemon: async () => calls.push("stop daemon"),
    requireNoContainers: async () => calls.push("no containers"),
    log: (line) => calls.push(line),
  };
}

for (const placement of ["server", "container", "worker"])
  test(`e2e-stop at the ${placement} placement pauses the project and stops no process`, async () => {
    const calls = [];
    await stopRun({ placement }, false, stopSteps(calls));
    assert.deepEqual(calls, ["pause", "e2e-stop: project project_1 paused"]);
  });

test("e2e-stop STOP=daemon at the worker placement stops the instance processes, then the daemon", async () => {
  const calls = [];
  await stopRun({ placement: "worker" }, true, stopSteps(calls));
  assert.deepEqual(calls, [
    "stop instances",
    "e2e-stop: e2e-coder-1 pid 4242 stopped",
    "e2e-stop: e2e-reviewer-1 not running",
    "stop daemon",
  ]);
});

test("e2e-stop STOP=daemon at the server placement stops only the daemon", async () => {
  const calls = [];
  await stopRun({ placement: "server" }, true, stopSteps(calls));
  assert.deepEqual(calls, ["stop daemon"]);
});

test("e2e-stop STOP=daemon at the container placement stops the daemon and checks the containers", async () => {
  const calls = [];
  await stopRun({ placement: "container" }, true, stopSteps(calls));
  assert.deepEqual(calls, [
    "stop daemon",
    "no containers",
    "e2e-stop: no container with the owner label remains",
  ]);
});
