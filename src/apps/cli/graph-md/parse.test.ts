import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readGraphPackageDir } from "./parse.ts";
import { parseGraphPackage as coreParseGraphPackage } from "../../../app/graph/graph-codec.ts";
import type { ExportManifest } from "../../../app/graph/graph-package.ts";
import { DuplicateRefError } from "../../../app/graph/import-errors.ts";
import { MalformedReferenceError } from "./refs.ts";

/** Convenience wrapper: reads a pkg dir then calls the pure core codec. */
async function parseGraphPackage(dir: string) {
  const files = await readGraphPackageDir(dir);
  return coreParseGraphPackage(files);
}

// ---------------------------------------------------------------------------
// Story 03 T2 — body sections parse assertions
// ---------------------------------------------------------------------------

describe("src/apps/cli/graph-md/parse.ts — body sections (Story 03 T2)", () => {
  let pkgDir: string;

  before(async () => {
    pkgDir = await mkdtemp(join(tmpdir(), "kanthord-parse-body-test-"));
    await writeFile(
      join(pkgDir, "initiative.md"),
      ["---", "kind: initiative", "ref: proj", "name: Proj", "---", ""].join(
        "\n",
      ),
    );
    const objDir = join(pkgDir, "backend");
    await mkdir(objDir);
    await writeFile(
      join(objDir, "objective.md"),
      [
        "---",
        "kind: objective",
        "ref: backend",
        "initiative: proj",
        "name: Backend",
        "---",
        "",
      ].join("\n"),
    );
  });

  after(async () => {
    await rm(pkgDir, { recursive: true, force: true });
  });

  test("# Instructions prose captured multi-line", async () => {
    await writeFile(
      join(pkgDir, "backend", "t-instructions.md"),
      [
        "---",
        "kind: task",
        "ref: instr-task",
        "objective: backend",
        "title: instr task",
        "---",
        "# Instructions",
        "First line of instructions.",
        "Second line of instructions.",
        "# Acceptance Criteria",
        "- [ ] something",
        "",
      ].join("\n"),
    );
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.ref === "instr-task");
    assert.ok(task, "task must be found");
    assert.ok(
      task.instructions.includes("First line"),
      "instructions must contain first line",
    );
    assert.ok(
      task.instructions.includes("Second line"),
      "instructions must contain second line",
    );
  });

  test("# Acceptance Criteria items extracted as ac string array", async () => {
    await writeFile(
      join(pkgDir, "backend", "t-ac.md"),
      [
        "---",
        "kind: task",
        "ref: ac-task",
        "objective: backend",
        "title: ac task",
        "---",
        "# Instructions",
        "Do something.",
        "# Acceptance Criteria",
        "- [ ] returns 200 for valid creds",
        "- [ ] rejects bad creds with 401",
        "",
      ].join("\n"),
    );
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.ref === "ac-task");
    assert.ok(task, "task must be found");
    assert.deepEqual(task.ac, [
      "returns 200 for valid creds",
      "rejects bad creds with 401",
    ]);
  });

  test("```sh fence yields verification string array one command per line", async () => {
    await writeFile(
      join(pkgDir, "backend", "t-verify.md"),
      [
        "---",
        "kind: task",
        "ref: verify-task",
        "objective: backend",
        "title: verify task",
        "---",
        "# Instructions",
        "Do something.",
        "# Acceptance Criteria",
        "- [ ] it works",
        "# Verification",
        "```sh",
        "npm test",
        "npm run lint",
        "```",
        "",
      ].join("\n"),
    );
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.ref === "verify-task");
    assert.ok(task, "task must be found");
    assert.deepEqual(task.verification, ["npm test", "npm run lint"]);
  });

  test("absent # Verification section yields verification: undefined", async () => {
    await writeFile(
      join(pkgDir, "backend", "t-no-verify.md"),
      [
        "---",
        "kind: task",
        "ref: no-verify-task",
        "objective: backend",
        "title: no verify task",
        "---",
        "# Instructions",
        "Do something.",
        "# Acceptance Criteria",
        "- [ ] it works",
        "",
      ].join("\n"),
    );
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.ref === "no-verify-task");
    assert.ok(task, "task must be found");
    assert.strictEqual(task.verification, undefined);
  });

  test("empty sh fence yields verification empty array (explicit clear)", async () => {
    await writeFile(
      join(pkgDir, "backend", "t-empty-verify.md"),
      [
        "---",
        "kind: task",
        "ref: empty-verify-task",
        "objective: backend",
        "title: empty verify task",
        "---",
        "# Instructions",
        "Do something.",
        "# Acceptance Criteria",
        "- [ ] it works",
        "# Verification",
        "```sh",
        "```",
        "",
      ].join("\n"),
    );
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.ref === "empty-verify-task");
    assert.ok(task, "task must be found");
    assert.deepEqual(task.verification, []);
  });

  test("ac item with embedded newline throws a parse error citing the sourcePath", async () => {
    const taskFile = join(pkgDir, "backend", "t-multiline-ac.md");
    await writeFile(
      taskFile,
      [
        "---",
        "kind: task",
        "ref: multiline-ac-task",
        "objective: backend",
        "title: multiline ac task",
        "---",
        "# Instructions",
        "Do something.",
        "# Acceptance Criteria",
        "- [ ] line one",
        "  continued text on second line",
        "",
      ].join("\n"),
    );
    await assert.rejects(
      () => parseGraphPackage(pkgDir),
      (err: Error) => {
        assert.ok(
          err.message.includes("backend/t-multiline-ac.md") ||
            err.message.includes("t-multiline-ac.md"),
          `error message must cite the sourcePath; got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Story 03 T3 — directory walk + whole GraphPackage + manifest read
// NOTE: The walk + manifest read were implemented ahead of schedule in T1/T2;
// these tests characterise already-shipped behaviour and lock B18 (cosmetic
// layout).  Sensitivity proof: the B18 test would fail if objectiveRef were
// derived from directory name; the manifest tests would fail if the manifest-
// read block were removed from parseGraphPackage.
// ---------------------------------------------------------------------------

describe("src/apps/cli/graph-md/parse.ts — directory walk + manifest (Story 03 T3)", () => {
  let pkgDir: string;

  const PACKAGE_ID = "01JQVBZ3MHKP4FTGWR5XYWALK1";
  const INIT_ID = "01JQVBZ3MHKP4FTGWR5XYWALK2";
  const OBJ_BACKEND_ID = "01JQVBZ3MHKP4FTGWR5XYWALK3";
  const OBJ_FRONTEND_ID = "01JQVBZ3MHKP4FTGWR5XYWALK4";
  const TASK_API_ID = "01JQVBZ3MHKP4FTGWR5XYWALK5";

  before(async () => {
    pkgDir = await mkdtemp(join(tmpdir(), "kanthord-parse-t3-"));

    // Initiative file at root
    await writeFile(
      join(pkgDir, "oauth.md"),
      [
        "---",
        "kind: initiative",
        `id: ${INIT_ID}`,
        "name: OAuth",
        "---",
        "",
      ].join("\n"),
    );

    // Two objective dirs
    const backendDir = join(pkgDir, "backend");
    const frontendDir = join(pkgDir, "frontend");
    await mkdir(backendDir);
    await mkdir(frontendDir);

    await writeFile(
      join(backendDir, "backend.md"),
      [
        "---",
        "kind: objective",
        `id: ${OBJ_BACKEND_ID}`,
        `initiative: ${INIT_ID}`,
        "name: Backend",
        "---",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(frontendDir, "frontend.md"),
      [
        "---",
        "kind: objective",
        `id: ${OBJ_FRONTEND_ID}`,
        `initiative: ${INIT_ID}`,
        "name: Frontend",
        "---",
        "",
      ].join("\n"),
    );

    // Task in its expected backend directory
    await writeFile(
      join(backendDir, "implement-api.md"),
      [
        "---",
        "kind: task",
        `id: ${TASK_API_ID}`,
        `objective: ${OBJ_BACKEND_ID}`,
        "title: implement api",
        "agent: generic@1",
        "---",
        "# Instructions",
        "Implement POST /oauth/token",
        "# Acceptance Criteria",
        "- [ ] returns 200",
        "",
      ].join("\n"),
    );

    // Task PHYSICALLY IN frontend dir but frontmatter says backend objective (B18)
    await writeFile(
      join(frontendDir, "misplaced-task.md"),
      [
        "---",
        "kind: task",
        "ref: misplaced",
        `objective: ${OBJ_BACKEND_ID}`,
        "title: misplaced task",
        "agent: generic@1",
        "---",
        "# Instructions",
        "Misplaced task.",
        "# Acceptance Criteria",
        "- [ ] works",
        "",
      ].join("\n"),
    );

    // Write a valid manifest
    const manifest: ExportManifest = {
      initiativeId: INIT_ID,
      packageId: PACKAGE_ID,
      formatVersion: 1,
      digestAlgorithm: "sha256",
      nodes: {
        [INIT_ID]: "abc123",
        [OBJ_BACKEND_ID]: "def456",
        [OBJ_FRONTEND_ID]: "ghi789",
        [TASK_API_ID]: "jkl012",
      },
      files: [TASK_API_ID],
      refToId: {
        objectives: { backend: OBJ_BACKEND_ID, frontend: OBJ_FRONTEND_ID },
        tasks: { [TASK_API_ID]: TASK_API_ID },
      },
    };
    await writeFile(
      join(pkgDir, ".kanthord-export.json"),
      JSON.stringify(manifest),
    );
  });

  after(async () => {
    await rm(pkgDir, { recursive: true, force: true });
  });

  test("returns one initiative, two objectives, and tasks from nested directories", async () => {
    const pkg = await parseGraphPackage(pkgDir);
    assert.ok(pkg.initiative, "initiative must be present");
    assert.strictEqual(pkg.initiative.id, INIT_ID);
    assert.strictEqual(
      pkg.objectives.length,
      2,
      "must find exactly 2 objectives",
    );
    assert.strictEqual(pkg.tasks.length, 2, "must find exactly 2 tasks");
  });

  test("task file in wrong directory uses frontmatter objectiveRef not file location (B18)", async () => {
    const pkg = await parseGraphPackage(pkgDir);
    const misplaced = pkg.tasks.find((t) => t.ref === "misplaced");
    assert.ok(misplaced, "misplaced task must be found");
    // Physical location is frontend/, but frontmatter declares OBJ_BACKEND_ID
    assert.strictEqual(
      misplaced.objectiveRef,
      OBJ_BACKEND_ID,
      "objectiveRef must come from frontmatter objective: key, not file location",
    );
    // sourcePath reflects physical location (relative to pkg root)
    assert.ok(
      misplaced.sourcePath.includes("frontend"),
      `sourcePath "${misplaced.sourcePath}" must reflect physical file location`,
    );
  });

  test("present .kanthord-export.json populates pkg.manifest and pkg.packageId", async () => {
    const pkg = await parseGraphPackage(pkgDir);
    assert.ok(
      pkg.manifest,
      "manifest must be populated from .kanthord-export.json",
    );
    assert.strictEqual(pkg.packageId, PACKAGE_ID);
    assert.strictEqual(pkg.manifest.initiativeId, INIT_ID);
    assert.ok(
      typeof pkg.manifest.nodes === "object" && pkg.manifest.nodes !== null,
      "manifest.nodes must be an object",
    );
    assert.strictEqual(pkg.manifest.digestAlgorithm, "sha256");
  });

  test("absent .kanthord-export.json yields manifest: undefined and empty packageId", async () => {
    const noManifestDir = await mkdtemp(
      join(tmpdir(), "kanthord-parse-t3-nomap-"),
    );
    try {
      await writeFile(
        join(noManifestDir, "init.md"),
        [
          "---",
          "kind: initiative",
          "ref: test-init",
          "name: Test",
          "---",
          "",
        ].join("\n"),
      );
      const pkg = await parseGraphPackage(noManifestDir);
      assert.strictEqual(
        pkg.manifest,
        undefined,
        "manifest must be undefined when no .kanthord-export.json",
      );
      assert.strictEqual(
        pkg.packageId,
        "",
        "packageId must be empty string when no manifest (create mode mints it later)",
      );
    } finally {
      await rm(noManifestDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Story 03 T1 — frontmatter-only parse assertions
// Body section assertions (instructions / ac / verification) are Task T2.
// ---------------------------------------------------------------------------

const EXPORTED_TASK_ULID = "01JQVBZ3MHKP4FTGWR5XYENSD7"; // 26-char uppercase Crockford
const OBJ_ULID = "01JQVBZ3MHKP4FTGWR5XYENSD8";

describe("src/apps/cli/graph-md/parse.ts — frontmatter (Story 03 T1)", () => {
  let pkgDir: string;

  before(async () => {
    pkgDir = await mkdtemp(join(tmpdir(), "kanthord-parse-test-"));
    // Minimal valid package: initiative + 1 objective + 2 task files
    // (one exported with `id:`, one authored with `ref:`)
    await writeFile(
      join(pkgDir, "initiative.md"),
      ["---", "kind: initiative", "ref: oauth", "name: OAuth", "---", ""].join(
        "\n",
      ),
    );
    const objDir = join(pkgDir, "backend");
    await mkdir(objDir);
    await writeFile(
      join(objDir, "objective.md"),
      [
        "---",
        "kind: objective",
        "ref: backend",
        "initiative: oauth",
        "name: Backend",
        "---",
        "",
      ].join("\n"),
    );
    // Exported task: has `id:` (ULID) — no `ref:` key in frontmatter
    await writeFile(
      join(objDir, "exported-task.md"),
      [
        "---",
        `kind: task`,
        `id: ${EXPORTED_TASK_ULID}`,
        `objective: ${OBJ_ULID}`,
        `title: implement api`,
        `agent: tdd@1`,
        "---",
        "",
      ].join("\n"),
    );
    // Authored task: has `ref:` (slug) — no `id:` key; no agent (must default)
    await writeFile(
      join(objDir, "authored-task.md"),
      [
        "---",
        "kind: task",
        "ref: implement-api",
        "objective: backend",
        "title: implement api",
        "---",
        "",
      ].join("\n"),
    );
  });

  after(async () => {
    await rm(pkgDir, { recursive: true, force: true });
  });

  test("exported task file with id-only: id is the ULID and effective ref equals that ULID", async () => {
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.id === EXPORTED_TASK_ULID);
    assert.ok(task, "task with the exported ULID must be found");
    assert.strictEqual(task.id, EXPORTED_TASK_ULID);
    // Effective ref for an exported task equals the ULID (ruling 2026-07-18: export = ULID-as-ref)
    assert.strictEqual(task.ref, EXPORTED_TASK_ULID);
  });

  test("authored task file with ref-only: id is undefined and ref equals the slug", async () => {
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.ref === "implement-api");
    assert.ok(task, "authored task with ref implement-api must be found");
    assert.strictEqual(task.id, undefined);
    assert.strictEqual(task.ref, "implement-api");
  });

  test("authored task without agent field: agent defaults to generic@1", async () => {
    const pkg = await parseGraphPackage(pkgDir);
    const task = pkg.tasks.find((t) => t.ref === "implement-api");
    assert.ok(task, "authored task must be found");
    assert.strictEqual(task.agent, "generic@1");
  });

  test("objectiveRef is carried verbatim from frontmatter", async () => {
    const pkg = await parseGraphPackage(pkgDir);
    const authored = pkg.tasks.find((t) => t.ref === "implement-api");
    assert.ok(authored, "authored task must be found");
    // The authored task's objective: is a slug ref, carried verbatim
    assert.strictEqual(authored.objectiveRef, "backend");
    const exported = pkg.tasks.find((t) => t.id === EXPORTED_TASK_ULID);
    assert.ok(exported, "exported task must be found");
    // The exported task's objective: is a ULID, carried verbatim
    assert.strictEqual(exported.objectiveRef, OBJ_ULID);
  });
});

// ---------------------------------------------------------------------------
// Story 09 T2 — parse-level boundary cases (S4/RB7)
// ---------------------------------------------------------------------------

describe("src/apps/cli/graph-md/parse.ts — boundary cases (Story 09 T2)", () => {
  let pkgDir: string;

  before(async () => {
    pkgDir = await mkdtemp(join(tmpdir(), "kanthord-parse-boundary-"));
    // Write an initiative file (required by parseGraphPackage)
    await writeFile(
      join(pkgDir, "init.md"),
      [
        "---",
        "kind: initiative",
        "ref: test-init",
        "name: Test Init",
        "---",
        "",
      ].join("\n"),
    );
  });

  after(async () => {
    await rm(pkgDir, { recursive: true, force: true });
  });

  test("duplicate task ref in same namespace — DuplicateRefError naming both sourcePaths", async () => {
    // Two task files with the same ref: value
    const taskA = join(pkgDir, "task-a.md");
    const taskB = join(pkgDir, "task-b.md");
    await writeFile(
      taskA,
      [
        "---",
        "kind: task",
        "ref: shared-ref",
        "objective: test-init",
        "title: Task A",
        "agent: generic@1",
        "---",
        "# Instructions",
        "do task a",
        "# Acceptance Criteria",
        "- [ ] done",
        "",
      ].join("\n"),
    );
    await writeFile(
      taskB,
      [
        "---",
        "kind: task",
        "ref: shared-ref",
        "objective: test-init",
        "title: Task B",
        "agent: generic@1",
        "---",
        "# Instructions",
        "do task b",
        "# Acceptance Criteria",
        "- [ ] done",
        "",
      ].join("\n"),
    );

    try {
      await assert.rejects(
        () => parseGraphPackage(pkgDir),
        DuplicateRefError,
        "two task files with the same ref: must throw DuplicateRefError",
      );
    } finally {
      await rm(taskA, { force: true });
      await rm(taskB, { force: true });
    }
  });

  test("malformed dependencies value (not ULID or slug grammar) — MalformedReferenceError naming the file", async () => {
    // A task with a dependencies value that matches neither the ULID grammar nor the slug grammar
    const taskFile = join(pkgDir, "task-malformed.md");
    await writeFile(
      taskFile,
      [
        "---",
        "kind: task",
        "ref: my-task",
        "objective: test-init",
        "title: Malformed deps task",
        "agent: generic@1",
        "dependencies: ['  BAD VALUE  ']",
        "---",
        "# Instructions",
        "do stuff",
        "# Acceptance Criteria",
        "- [ ] done",
        "",
      ].join("\n"),
    );

    try {
      await assert.rejects(
        () => parseGraphPackage(pkgDir),
        MalformedReferenceError,
        "a dependencies value matching neither ULID nor slug grammar must throw MalformedReferenceError naming the file",
      );
    } finally {
      await rm(taskFile, { force: true });
    }
  });
});
