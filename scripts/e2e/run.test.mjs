import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const RUN_SCRIPT = fileURLToPath(new URL("./run.sh", import.meta.url));

test("make e2e at the worker placement passes to the step that reads engine/.env.e2e", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "e2e-run-")));
  try {
    spawnSync("git", ["init", "--quiet", root]);
    const result = spawnSync("bash", [RUN_SCRIPT], {
      env: { ...process.env, PLACEMENT: "worker", ROOT: root },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `e2e: ${root}/engine/.env.e2e is missing\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
