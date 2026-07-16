#!/usr/bin/env node
// Re-verifies the software-engineer's handoff artifact (a clean type-check).
// Prints a machine-readable verdict: "VERIFY: PASS" (exit 0) / "VERIFY: FAIL" (non-zero).
import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["run", "typecheck"], { stdio: "inherit" });

if (result.status === 0) {
  console.log("VERIFY: PASS");
} else {
  console.log("VERIFY: FAIL");
  process.exit(result.status ?? 1);
}
