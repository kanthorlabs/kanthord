/**
 * Story 08 T2 (b) — KANTHORD_MAX_TURNS env var parsing in main.ts.
 *
 * Verifies that an invalid value causes startup to exit 1 with one error
 * stderr line, and that a valid numeric value is accepted (exit 0).
 *
 * Tests spawn `node src/main.ts db migrate` against a temp DB because
 * main.ts is the process entry point and its env-parse error path must
 * be exercised at the process boundary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const MAIN_TS = join(PROJECT_ROOT, "src", "main.ts");

function runMain(
  args: string[],
  env: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "kanthord-main-t2-"));
  try {
    const merged = {
      ...process.env,
      KANTHORD_DB: join(tmpDir, "test.db"),
      ...env,
    };
    const result = spawnSync("node", [MAIN_TS, ...args], {
      cwd: PROJECT_ROOT,
      env: merged,
      encoding: "utf-8",
      timeout: 10_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// (b-1) Invalid KANTHORD_MAX_TURNS value → exit 1 with exactly one stderr line

test("KANTHORD_MAX_TURNS=abc: startup exits 1 with one stderr line", () => {
  const result = runMain(["db", "migrate"], { KANTHORD_MAX_TURNS: "abc" });
  assert.equal(
    result.status,
    1,
    `exit code must be 1 for invalid KANTHORD_MAX_TURNS=abc, got: ${result.status}`,
  );
  // stderr must contain exactly one non-empty line (the error message line)
  const stderrLines = result.stderr
    .split("\n")
    .filter((l) => l.trim().length > 0)
    // ignore Node.js warning lines (ExperimentalWarning body + its follow-up trace line)
    .filter(
      (l) =>
        !l.includes("ExperimentalWarning") &&
        !l.includes("DeprecationWarning") &&
        !l.includes("Use `node --trace-warnings"),
    );
  assert.equal(
    stderrLines.length,
    1,
    `expected exactly 1 stderr line for invalid env, got ${stderrLines.length}: ${stderrLines.join(" | ")}`,
  );
});

// (b-2) KANTHORD_MAX_TURNS unset → startup succeeds (default 50 used)

test("KANTHORD_MAX_TURNS unset: startup succeeds with default 50 turns", () => {
  const result = runMain(["db", "migrate"], { KANTHORD_MAX_TURNS: undefined });
  assert.equal(
    result.status,
    0,
    `exit code must be 0 when KANTHORD_MAX_TURNS is unset, got: ${result.status}\nstderr: ${result.stderr}`,
  );
});
