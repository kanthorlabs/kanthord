import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatch } from "./router.ts";
import type { RouterDeps } from "./router.ts";

/**
 * Fake deps — the stub 'create project' handler registered in COMMANDS does
 * not use deps, so an empty object cast is sufficient for T1.
 */
const fakeDeps = {} as RouterDeps;

// ---------------------------------------------------------------------------
// T1-a: --help on a known command exits 0 with usage on stdout
// ---------------------------------------------------------------------------

test("dispatch create-project --help exits 0 and puts usage text on stdout", async () => {
  const result = await dispatch(["create", "project", "--help"], fakeDeps);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.stdout.length > 0,
    `expected usage on stdout, got: ${JSON.stringify(result.stdout)}`,
  );
  assert.deepEqual(result.stderr, []);
});

// ---------------------------------------------------------------------------
// T1-b: unknown command exits 1 with named error on stderr
// ---------------------------------------------------------------------------

test("dispatch unknown command exits 1 with named error on stderr", async () => {
  const result = await dispatch(["foo", "bar"], fakeDeps);
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.stderr.some((line) =>
      line.includes("error: unknown command: foo bar"),
    ),
    `expected 'error: unknown command: foo bar' in stderr, got: ${JSON.stringify(result.stderr)}`,
  );
  // Also confirms that a list of known commands appears
  assert.ok(
    result.stderr.some((line) => line.includes("create project")),
    `expected known commands list in stderr, got: ${JSON.stringify(result.stderr)}`,
  );
});

// ---------------------------------------------------------------------------
// T1-c: unknown flag on a known command → strict parseArgs → exit 1 + usage
// ---------------------------------------------------------------------------

test("dispatch create-project with unknown flag exits 1 with error and usage on stderr", async () => {
  const result = await dispatch(
    ["create", "project", "--unknown-flag", "x"],
    fakeDeps,
  );
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.stderr.some((line) => line.startsWith("error:")),
    `expected a line starting with 'error:' in stderr, got: ${JSON.stringify(result.stderr)}`,
  );
  assert.ok(
    result.stderr.some((line) => line.includes("usage:")),
    `expected usage text in stderr, got: ${JSON.stringify(result.stderr)}`,
  );
});

// ---------------------------------------------------------------------------
// T2: pre-existing commands ("check graph", "db migrate", "db status") must
//     be registered in COMMANDS so dispatch resolves them.
//     These tests fail today: COMMANDS has only "create project".
// ---------------------------------------------------------------------------

test("dispatch check graph --help exits 0 with usage text on stdout", async () => {
  const result = await dispatch(["check", "graph", "--help"], fakeDeps);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.stdout.length > 0,
    `expected usage on stdout, got: ${JSON.stringify(result.stdout)}`,
  );
  assert.deepEqual(result.stderr, []);
});

test("dispatch db migrate --help exits 0 with usage text on stdout", async () => {
  const result = await dispatch(["db", "migrate", "--help"], fakeDeps);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.stdout.length > 0,
    `expected usage on stdout, got: ${JSON.stringify(result.stdout)}`,
  );
  assert.deepEqual(result.stderr, []);
});

test("dispatch db status --help exits 0 with usage text on stdout", async () => {
  const result = await dispatch(["db", "status", "--help"], fakeDeps);
  assert.equal(result.exitCode, 0);
  assert.ok(
    result.stdout.length > 0,
    `expected usage on stdout, got: ${JSON.stringify(result.stdout)}`,
  );
  assert.deepEqual(result.stderr, []);
});

// ---------------------------------------------------------------------------
// B3 regression — `login` command not registered in COMMANDS
// ---------------------------------------------------------------------------
//
// `runLogin` exists and is unit-green (src/apps/cli/login.test.ts),
// but `COMMANDS` has no "login" entry, so `dispatch(["login", "--help"])`
// follows the single-word fallback (obj="--help" starts with "-"), looks up
// COMMANDS["login"], finds nothing, and returns exit 1 "unknown command".
//
// After the fix: COMMANDS["login"] exists → --help → exit 0 with usage text.

test("(B3 regression) dispatch login --help exits 0 with usage text (login must be in COMMANDS)", async () => {
  const result = await dispatch(["login", "--help"], fakeDeps);
  // Currently exits 1: COMMANDS["login"] is absent, dispatch returns
  // "error: unknown command: login --help".
  assert.equal(
    result.exitCode,
    0,
    `login must be registered in COMMANDS — got exitCode=${result.exitCode}, stderr=${JSON.stringify(result.stderr)}`,
  );
  assert.ok(
    result.stdout.length > 0,
    `login --help must print usage text on stdout, got stdout=${JSON.stringify(result.stdout)}`,
  );
  assert.ok(
    !result.stderr.some((l) => l.includes("unknown command")),
    `login must not return an 'unknown command' error, got stderr=${JSON.stringify(result.stderr)}`,
  );
});
