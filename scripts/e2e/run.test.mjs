import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const RUN_SCRIPT = fileURLToPath(new URL("./run.sh", import.meta.url));

test("make e2e refuses the worker placement before any step", () => {
  const result = spawnSync("bash", [RUN_SCRIPT], {
    env: { ...process.env, PLACEMENT: "worker" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "e2e: The worker placement e2e returns in layer 6 of Group B, OAuth on the worker instance.\n",
  );
});
