import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runGraphCheck } from "./graph-check.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(__dirname, "../../../examples");

// --- fixture-based tests (require examples/*.yaml committed by M2) ---

test("runGraphCheck on demo-graph.yaml returns exit 0 and the four locked stdout lines", async () => {
  const result = await runGraphCheck(join(examplesDir, "demo-graph.yaml"));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, [
    "design: ready",
    "implement: blocked (waiting: design)",
    "test: blocked (waiting: implement)",
    "docs: blocked (waiting: design)",
  ]);
  assert.deepEqual(result.stderr, []);
});

test("runGraphCheck on invalid-cycle.yaml returns exit 1 and locked cycle stderr line", async () => {
  const result = await runGraphCheck(join(examplesDir, "invalid-cycle.yaml"));
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, ["error: cycle detected: a -> b -> a"]);
  assert.deepEqual(result.stdout, []);
});

test("runGraphCheck on invalid-unknown-dep.yaml returns exit 1 and locked unknown-dep stderr line", async () => {
  const result = await runGraphCheck(
    join(examplesDir, "invalid-unknown-dep.yaml"),
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: unknown dependency: ghost (referenced by a)",
  ]);
  assert.deepEqual(result.stdout, []);
});

// --- regression: B3 — unreadable-file branch uses locked AC message ---

test("runGraphCheck on a path that does not exist returns exit 1 with locked cannot-read-file stderr", async () => {
  const result = await runGraphCheck("/nonexistent/path/that/does/not-exist.yaml");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, ["error: invalid graph file: cannot read file"]);
  assert.deepEqual(result.stdout, []);
});

// --- temp-file tests ---

test("runGraphCheck on a non-YAML file returns exit 1 with invalid YAML error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-test-"));
  try {
    const file = join(dir, "bad.yaml");
    await writeFile(file, "{unclosed bracket that fails YAML parse");
    const result = await runGraphCheck(file);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.stderr, ["error: invalid graph file: invalid YAML"]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("runGraphCheck on a YAML file missing tasks returns exit 1 with shape error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-test-"));
  try {
    const file = join(dir, "notasks.yaml");
    await writeFile(file, "name: project\nversion: 1\n");
    const result = await runGraphCheck(file);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.stderr, [
      "error: invalid graph file: tasks must be a list of { id, dependencies? }",
    ]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("runGraphCheck on a file with duplicate task id returns exit 1 with duplicate error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-test-"));
  try {
    const file = join(dir, "dup.yaml");
    await writeFile(file, "tasks:\n  - id: a\n  - id: a\n");
    const result = await runGraphCheck(file);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.stderr, ["error: duplicate task id: a"]);
  } finally {
    await rm(dir, { recursive: true });
  }
});
