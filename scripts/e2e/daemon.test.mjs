import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { daemonPort, isOrphanDevDaemon } from "./daemon.mjs";

const COMMAND = "/usr/local/bin/node src/main.ts serve";

function checkout() {
  const root = mkdtempSync(join(tmpdir(), "kanthord-"));
  mkdirSync(join(root, "engine"));
  mkdirSync(join(root, "scripts/dev"), { recursive: true });
  writeFileSync(join(root, "scripts/dev/run.sh"), "");
  return root;
}

test("accepts an orphaned engine serve in a checkout engine directory", () => {
  const root = checkout();
  try {
    const cwd = join(root, "engine");
    assert.equal(isOrphanDevDaemon({ command: COMMAND, cwd }), true);
    assert.equal(
      isOrphanDevDaemon({ command: "node src/main.ts serve", cwd }),
      true,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("refuses another command in a checkout engine directory", () => {
  const root = checkout();
  try {
    const cwd = join(root, "engine");
    for (const command of [
      "/usr/local/bin/node src/main.ts upgrade",
      "/usr/local/bin/node other.js serve",
      "python3 src/main.ts serve",
      "/usr/local/bin/node src/main.ts serve --extra",
    ])
      assert.equal(isOrphanDevDaemon({ command, cwd }), false, command);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("refuses a working directory outside a checkout engine directory", () => {
  const root = checkout();
  try {
    assert.equal(isOrphanDevDaemon({ command: COMMAND, cwd: root }), false);
    assert.equal(isOrphanDevDaemon({ command: COMMAND, cwd: "" }), false);
    const lone = mkdtempSync(join(tmpdir(), "engine-parent-"));
    mkdirSync(join(lone, "engine"));
    try {
      assert.equal(
        isOrphanDevDaemon({ command: COMMAND, cwd: join(lone, "engine") }),
        false,
      );
    } finally {
      rmSync(lone, { recursive: true });
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("refuses a non-loopback endpoint", () => {
  assert.equal(daemonPort("http://127.0.0.1:31415"), 31415);
  assert.throws(() => daemonPort("http://example.com:31415"), /not a loopback/);
});
