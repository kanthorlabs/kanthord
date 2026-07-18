/**
 * Story 09 T3 — `import resource <path>` CLI handler
 *
 * Tests four scenarios using injectable deps (no real DB, no network):
 *   (a) valid YAML file with 3 entries → exit 0, one ULID per stdout line,
 *       stderr "imported 3 resources"
 *   (b) missing file path → exit 1, exactly one error line
 *   (c) malformed YAML content → exit 1, exactly one error line
 *   (d) entry with a wrong key (value exposed in YAML) → exit 1 naming the
 *       entry index, output free of any value/secret content
 *
 * Fails today: src/apps/cli/import.ts is absent → ERR_MODULE_NOT_FOUND.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runImportResource } from "./import.ts";
import { ImportValidationError } from "../../app/resource/import-resources.ts";

// --- narrow fake type for the use case ---
type FakeExecute = (input: {
  projectId: string;
  entries: Array<Record<string, unknown>>;
}) => Promise<string[]>;

function makeFakeImportResources(execute: FakeExecute) {
  return {
    execute,
  } as unknown as import("../../app/resource/import-resources.ts").ImportResources;
}

// --- shared temp dir ---
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "import-test-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

test("(a) valid file with 3 entries → exit 0, one ULID per stdout line, stderr 'imported 3 resources'", async () => {
  const tmpFile = join(dir, "valid.yaml");
  await writeFile(
    tmpFile,
    [
      "project: proj-001",
      "resources:",
      "  - type: credential",
      "    name: cred-1",
      "    provider: openai",
      "    value: sk-key-1",
      "  - type: credential",
      "    name: cred-2",
      "    provider: openai",
      "    value: sk-key-2",
      "  - type: ai_provider",
      "    name: gpt",
      "    provider: openai",
      "    model: gpt-4",
    ].join("\n"),
  );

  const RETURNED_IDS = ["id-aaa", "id-bbb", "id-ccc"];
  const capturedInput: Array<{ projectId: string; entries: unknown[] }> = [];

  const result = await runImportResource(
    { path: tmpFile },
    makeFakeImportResources(async (input) => {
      capturedInput.push(input);
      return RETURNED_IDS;
    }),
  );

  assert.equal(result.exitCode, 0, "exit code must be 0 for a valid file");
  assert.deepEqual(
    result.stdout,
    RETURNED_IDS,
    "stdout must be one ULID per line in order",
  );
  assert.equal(
    result.stderr.length,
    1,
    "exactly one stderr line for the summary",
  );
  assert.ok(
    result.stderr[0]?.includes("imported 3 resources"),
    `stderr must contain 'imported 3 resources', got: ${result.stderr[0]}`,
  );
  assert.equal(capturedInput.length, 1, "execute called exactly once");
  assert.equal(
    capturedInput[0]?.projectId,
    "proj-001",
    "projectId forwarded from YAML",
  );
  assert.equal(
    capturedInput[0]?.entries.length,
    3,
    "all 3 entries forwarded to execute",
  );
});

test("(b) missing file path → exit 1, exactly one error line", async () => {
  const result = await runImportResource(
    { path: join(dir, "no-such-file.yaml") },
    makeFakeImportResources(async () => {
      throw new Error("execute must not be called");
    }),
  );

  assert.equal(result.exitCode, 1, "exit code must be 1 for a missing file");
  assert.equal(
    result.stderr.length,
    1,
    "exactly one stderr error line for a missing file",
  );
  assert.equal(result.stdout.length, 0, "no stdout on failure");
});

test("(c) malformed YAML → exit 1, exactly one error line", async () => {
  const tmpFile = join(dir, "bad.yaml");
  await writeFile(tmpFile, "{ this is: [not valid yaml:");

  const result = await runImportResource(
    { path: tmpFile },
    makeFakeImportResources(async () => {
      throw new Error("execute must not be called for malformed YAML");
    }),
  );

  assert.equal(result.exitCode, 1, "exit code must be 1 for malformed YAML");
  assert.equal(result.stderr.length, 1, "exactly one stderr error line");
  assert.equal(result.stdout.length, 0, "no stdout on failure");
});

test("(d) entry with wrong key: exit 1 naming entry index, output free of value content", async () => {
  const SECRET = "sk-super-secret-do-not-echo-1a2b3c";
  const tmpFile = join(dir, "wrong-key.yaml");
  await writeFile(
    tmpFile,
    [
      "project: proj-001",
      "resources:",
      "  - type: credential",
      "    name: bad-entry",
      "    provider: openai",
      `    secret_ref: ${SECRET}`,
    ].join("\n"),
  );

  const result = await runImportResource(
    { path: tmpFile },
    makeFakeImportResources(async () => {
      // Simulates what ImportResources.execute throws for a wrong field name
      throw new ImportValidationError(1, "bad-entry");
    }),
  );

  assert.equal(result.exitCode, 1, "exit code must be 1 for an invalid entry");
  assert.equal(
    result.stderr.length,
    1,
    "exactly one stderr error line naming the entry",
  );
  assert.equal(result.stdout.length, 0, "no stdout on failure");

  const allOutput = [...result.stdout, ...result.stderr].join(" ");
  assert.ok(
    !allOutput.includes(SECRET),
    `output must not contain the secret value; got: ${allOutput}`,
  );
  // The error should mention the entry index in some form
  assert.ok(
    allOutput.includes("1") || allOutput.includes("bad-entry"),
    `error output should reference the entry; got: ${allOutput}`,
  );
});
