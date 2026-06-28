#!/usr/bin/env node
// Handoff verification gate (see .claude/commands/work.md / the engineers' personas).
// The "artifact" for this interpreted stack is a clean type-check. Prints a
// machine-readable PASS/FAIL line and sets the exit code accordingly, so the
// test-engineer can independently re-verify the software-engineer's claim
// without a fragile grep.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const r = spawnSync(process.execPath, [tsc, "--noEmit"], { stdio: "inherit" });

if (r.status === 0) {
  console.log("VERIFY: PASS");
  process.exit(0);
}
console.log("VERIFY: FAIL");
process.exit(1);
