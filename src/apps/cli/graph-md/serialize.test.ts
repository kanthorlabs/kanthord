/**
 * Story 03 T4 — serialize + GOLDEN round-trip (B9/B16)
 *
 * Two distinct assertions (B16):
 *   (1) Codec idempotence: serializeNode(parse(canonical_bytes)) === canonical_bytes
 *       for every node type (initiative / objective / task).
 *   (2) Semantic: a hand-authored NON-canonical file (reordered frontmatter keys,
 *       `* ` bullets, extra blank lines) parses to the CORRECT GraphPackage DTO
 *       (deep-equal semantics, NOT byte-equal), and re-serializing yields canonical.
 *
 * .kanthord-export.json and a generated INDEX.md are excluded from byte assertions (B16).
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readGraphPackageDir } from "./parse.ts";
import {
  parseGraphPackage as coreParseGraphPackage,
  serializeNode,
} from "../../../app/graph/graph-codec.ts";

/** Convenience wrapper: reads a pkg dir then calls the pure core codec. */
async function parseGraphPackage(dir: string) {
  const files = await readGraphPackageDir(dir);
  return coreParseGraphPackage(files);
}

// ---------------------------------------------------------------------------
// Canonical byte fixtures (the contract the serializer must produce)
// ---------------------------------------------------------------------------

// ULIDs used across the suite
const INIT_ID = "01JQVBZ3MHKP4FTGWR5XYSRZ01";
const OBJ_ID = "01JQVBZ3MHKP4FTGWR5XYSRZ02";
const TASK_ID = "01JQVBZ3MHKP4FTGWR5XYSRZ03";
const DEP1_ID = "01JQVBZ3MHKP4FTGWR5XYSRZ04";
const DEP2_ID = "01JQVBZ3MHKP4FTGWR5XYSRZ05";

/** Canonical bytes for an exported initiative node (id only, no ref) */
const CANONICAL_INIT = [
  "---",
  "kind: initiative",
  `id: ${INIT_ID}`,
  "name: OAuth",
  "---",
  "",
].join("\n");

/** Canonical bytes for an exported objective node (id only, no ref) */
const CANONICAL_OBJ = [
  "---",
  "kind: objective",
  `id: ${OBJ_ID}`,
  `initiative: ${INIT_ID}`,
  "name: Backend",
  "---",
  "",
].join("\n");

/**
 * Canonical bytes for an exported task node:
 *   id, objective (ULID), title, agent, no dependencies, instructions, ac, verification.
 */
const CANONICAL_TASK_EXPORTED = [
  "---",
  "kind: task",
  `id: ${TASK_ID}`,
  `objective: ${OBJ_ID}`,
  "title: implement api",
  "agent: generic@1",
  "---",
  "# Instructions",
  "Implement POST /oauth/token",
  "# Acceptance Criteria",
  "- [ ] returns 200 for valid creds",
  "# Verification",
  "```sh",
  "npm test",
  "```",
  "",
].join("\n");

/**
 * Canonical bytes for an authored task node (ref only, no id).
 * No verification section (undefined → omitted).
 */
const CANONICAL_TASK_AUTHORED = [
  "---",
  "kind: task",
  "ref: implement-api",
  "objective: backend",
  "title: implement api",
  "agent: generic@1",
  "---",
  "# Instructions",
  "Implement POST /oauth/token",
  "# Acceptance Criteria",
  "- [ ] returns 200 for valid creds",
  "",
].join("\n");

/**
 * Canonical bytes for a task with dependencies (must appear sorted in output).
 * DEP1_ID < DEP2_ID lexicographically (both uppercase Crockford ULIDs).
 */
const CANONICAL_TASK_DEPS = [
  "---",
  "kind: task",
  `id: ${TASK_ID}`,
  `objective: ${OBJ_ID}`,
  "title: deploy",
  "agent: generic@1",
  `dependencies: [${DEP1_ID}, ${DEP2_ID}]`,
  "---",
  "# Instructions",
  "Deploy it.",
  "# Acceptance Criteria",
  "- [ ] health check green",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Helper: build a minimal package directory containing a given file
// ---------------------------------------------------------------------------

async function buildPkgDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-ser-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(dir, relPath);
    const parent = abs.substring(0, abs.lastIndexOf("/"));
    await mkdir(parent, { recursive: true });
    await writeFile(abs, content);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/apps/cli/graph-md/serialize.ts", () => {
  let dirs: string[] = [];

  after(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // (1) Codec idempotence: serializeNode(parse(canonical)) === canonical
  // -------------------------------------------------------------------------

  test("codec idempotence — initiative: serializeNode(parse(canonical)) byte-equals canonical", async () => {
    const dir = await buildPkgDir({ "oauth.md": CANONICAL_INIT });
    dirs.push(dir);
    const pkg = await parseGraphPackage(dir);
    const serialized = serializeNode(pkg.initiative);
    assert.strictEqual(
      serialized,
      CANONICAL_INIT,
      `initiative round-trip failed.\nExpected:\n${CANONICAL_INIT}\nGot:\n${serialized}`,
    );
  });

  test("codec idempotence — objective: serializeNode(parse(canonical)) byte-equals canonical", async () => {
    const dir = await buildPkgDir({
      "oauth.md": CANONICAL_INIT,
      "backend/backend.md": CANONICAL_OBJ,
    });
    dirs.push(dir);
    const pkg = await parseGraphPackage(dir);
    const obj = pkg.objectives[0];
    assert.ok(obj, "objective must be parsed");
    const serialized = serializeNode(obj);
    assert.strictEqual(
      serialized,
      CANONICAL_OBJ,
      `objective round-trip failed.\nExpected:\n${CANONICAL_OBJ}\nGot:\n${serialized}`,
    );
  });

  test("codec idempotence — exported task: serializeNode(parse(canonical)) byte-equals canonical", async () => {
    const dir = await buildPkgDir({
      "oauth.md": CANONICAL_INIT,
      "backend/backend.md": CANONICAL_OBJ,
      "backend/implement-api.md": CANONICAL_TASK_EXPORTED,
    });
    dirs.push(dir);
    const pkg = await parseGraphPackage(dir);
    const task = pkg.tasks.find((t) => t.id === TASK_ID);
    assert.ok(task, "exported task must be parsed");
    const serialized = serializeNode(task);
    assert.strictEqual(
      serialized,
      CANONICAL_TASK_EXPORTED,
      `exported task round-trip failed.\nExpected:\n${CANONICAL_TASK_EXPORTED}\nGot:\n${serialized}`,
    );
  });

  test("codec idempotence — authored task (ref only): serializeNode(parse(canonical)) byte-equals canonical", async () => {
    const dir = await buildPkgDir({
      "oauth.md": CANONICAL_INIT,
      "backend/backend.md": CANONICAL_OBJ,
      "backend/authored.md": CANONICAL_TASK_AUTHORED,
    });
    dirs.push(dir);
    const pkg = await parseGraphPackage(dir);
    const task = pkg.tasks.find((t) => t.ref === "implement-api" && !t.id);
    assert.ok(task, "authored task must be parsed (no id)");
    const serialized = serializeNode(task);
    assert.strictEqual(
      serialized,
      CANONICAL_TASK_AUTHORED,
      `authored task round-trip failed.\nExpected:\n${CANONICAL_TASK_AUTHORED}\nGot:\n${serialized}`,
    );
  });

  test("dependencies serializes as sorted set — REVERSED input becomes sorted output", async () => {
    // Input file has dependencies in REVERSE order; serialized output must be sorted.
    const reversedDepsTask = [
      "---",
      "kind: task",
      `id: ${TASK_ID}`,
      `objective: ${OBJ_ID}`,
      "title: deploy",
      "agent: generic@1",
      `dependencies: [${DEP2_ID}, ${DEP1_ID}]`,
      "---",
      "# Instructions",
      "Deploy it.",
      "# Acceptance Criteria",
      "- [ ] health check green",
      "",
    ].join("\n");
    const dir = await buildPkgDir({
      "oauth.md": CANONICAL_INIT,
      "backend/backend.md": CANONICAL_OBJ,
      "backend/deploy.md": reversedDepsTask,
    });
    dirs.push(dir);
    const pkg = await parseGraphPackage(dir);
    const task = pkg.tasks.find((t) => t.id === TASK_ID);
    assert.ok(task, "task with deps must be parsed");
    const serialized = serializeNode(task);
    assert.strictEqual(
      serialized,
      CANONICAL_TASK_DEPS,
      `dependencies must be sorted in serialized output.\nExpected:\n${CANONICAL_TASK_DEPS}\nGot:\n${serialized}`,
    );
  });

  // -------------------------------------------------------------------------
  // (2) Semantic: non-canonical input → correct DTO → canonical bytes
  // -------------------------------------------------------------------------

  test("non-canonical task (reordered keys, * bullets, extra blank lines) → correct DTO + canonical bytes", async () => {
    // Non-canonical: frontmatter keys in wrong order, `* ` bullets, extra blank lines
    const nonCanonical = [
      "---",
      "agent: generic@1",
      "title: implement api",
      `objective: ${OBJ_ID}`,
      `id: ${TASK_ID}`,
      "kind: task",
      "---",
      "",
      "# Instructions",
      "",
      "Implement POST /oauth/token",
      "",
      "# Acceptance Criteria",
      "",
      "* returns 200 for valid creds",
      "",
    ].join("\n");

    const dir = await buildPkgDir({
      "oauth.md": CANONICAL_INIT,
      "backend/backend.md": CANONICAL_OBJ,
      "backend/implement-api.md": nonCanonical,
    });
    dirs.push(dir);

    const pkg = await parseGraphPackage(dir);
    const task = pkg.tasks.find((t) => t.id === TASK_ID);
    assert.ok(task, "non-canonical task must be parseable");

    // Semantic equality: DTO must have the correct field values regardless of file format
    assert.strictEqual(task.id, TASK_ID, "id must be parsed correctly");
    assert.strictEqual(
      task.objectiveRef,
      OBJ_ID,
      "objectiveRef must be parsed correctly",
    );
    assert.strictEqual(
      task.title,
      "implement api",
      "title must be parsed correctly",
    );
    assert.strictEqual(
      task.agent,
      "generic@1",
      "agent must be parsed correctly",
    );
    assert.deepEqual(
      task.ac,
      ["returns 200 for valid creds"],
      "* bullets must be parsed as ac items (semantic equality)",
    );
    assert.strictEqual(
      task.verification,
      undefined,
      "absent # Verification → undefined",
    );

    // Re-serializing must yield the canonical form (no verification section since undefined)
    const expectedCanonical = [
      "---",
      "kind: task",
      `id: ${TASK_ID}`,
      `objective: ${OBJ_ID}`,
      "title: implement api",
      "agent: generic@1",
      "---",
      "# Instructions",
      "Implement POST /oauth/token",
      "# Acceptance Criteria",
      "- [ ] returns 200 for valid creds",
      "",
    ].join("\n");
    const serialized = serializeNode(task);
    assert.strictEqual(
      serialized,
      expectedCanonical,
      `non-canonical → canonical serialization failed.\nExpected:\n${expectedCanonical}\nGot:\n${serialized}`,
    );
  });
});
