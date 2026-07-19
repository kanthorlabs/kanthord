/**
 * Story 05 T3 — CLI `import graph --create` + id handoff + slice e2e
 *
 * (a) --create --project: parses 1-init/2-obj/2-task package, calls createGraph.execute
 * (b) source files rewritten with assigned ULID in frontmatter (atomic)
 * (c) .kanthord-export.json written with packageId + nodes snapshot
 * (d) --create without --project → exit 1
 * (e) --create and --apply together → exit 1 (mutually exclusive)
 *
 * Story 08 T1 — --dry-run: classifier runs + no writes
 *
 * (f) --dry-run prints each classification type from applyGraph result; no manifest written
 * (g) --dry-run missing: pending removed file vs non-pending not-exported are distinct in output
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runImportGraph } from "./import-graph.ts";
import type {
  CreateGraphInput,
  CreateGraphResult,
} from "../../app/graph/create-graph.ts";
import type { ApplyGraphResult } from "../../app/graph/apply-graph.ts";
import { newId } from "../../domain/entity.ts";

// ─── stable test IDs (valid 26-char uppercase Crockford — all-digit, YAML-quoted by serializer) ───
const INIT_ID = "00000000000000000000000001";
const OBJ1_ID = "00000000000000000000000002";
const OBJ2_ID = "00000000000000000000000003";
const TASK1_ID = "00000000000000000000000004";
const TASK2_ID = "00000000000000000000000005";
const PROJ_ID = "00000000000000000000000006";

// ─── fake CreateGraph that records calls and returns deterministic IDs ────────
class FakeCreateGraph {
  calls: CreateGraphInput[] = [];

  async execute(input: CreateGraphInput): Promise<CreateGraphResult> {
    this.calls.push(input);
    return {
      initiativeId: INIT_ID,
      refToId: {
        objectives: { backend: OBJ1_ID, frontend: OBJ2_ID },
        tasks: { "impl-api": TASK1_ID, deploy: TASK2_ID },
      },
      nodes: {
        [INIT_ID]: "a".repeat(64),
        [OBJ1_ID]: "b".repeat(64),
        [OBJ2_ID]: "c".repeat(64),
        [TASK1_ID]: "d".repeat(64),
        [TASK2_ID]: "e".repeat(64),
      },
    };
  }
}

// ─── fixture builder: 1 initiative / 2 objectives / 2 tasks (no ids — authored) ─
async function makeAuthoredDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-create-t3-"));
  await mkdir(join(dir, "backend"), { recursive: true });
  await mkdir(join(dir, "frontend"), { recursive: true });

  await writeFile(
    join(dir, "oauth.md"),
    "---\nkind: initiative\nref: oauth\nname: oauth\n---\n",
  );
  await writeFile(
    join(dir, "backend", "backend.md"),
    "---\nkind: objective\nref: backend\ninitiative: oauth\nname: backend\n---\n",
  );
  await writeFile(
    join(dir, "frontend", "frontend.md"),
    "---\nkind: objective\nref: frontend\ninitiative: oauth\nname: frontend\n---\n",
  );
  await writeFile(
    join(dir, "backend", "impl-api.md"),
    [
      "---",
      "kind: task",
      "ref: impl-api",
      "objective: backend",
      "title: implement api",
      "agent: generic@1",
      "---",
      "# Instructions",
      "Implement POST /oauth/token.",
      "# Acceptance Criteria",
      "- [ ] returns 200 for valid creds",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "backend", "deploy.md"),
    [
      "---",
      "kind: task",
      "ref: deploy",
      "objective: backend",
      "title: deploy",
      "agent: generic@1",
      "depends-on: [impl-api]",
      "---",
      "# Instructions",
      "Deploy the backend.",
      "# Acceptance Criteria",
      "- [ ] health check green",
      "",
    ].join("\n"),
  );

  return dir;
}

// ─── tests ────────────────────────────────────────────────────────────────────

test("--create --project: parses 1-init/2-obj/2-task package and calls createGraph.execute", async () => {
  const dir = await makeAuthoredDir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: true, apply: false, project: PROJ_ID },
    { createGraph: fake, newId: () => "01JTESTULID00000000000000A" },
  );

  assert.equal(
    result.exitCode,
    0,
    `exit 0; stderr: ${result.stderr.join(" ")}`,
  );
  assert.equal(fake.calls.length, 1, "createGraph.execute called exactly once");

  const input = fake.calls[0]!;
  assert.equal(input.projectId, PROJ_ID, "correct projectId forwarded");
  assert.equal(input.pkg.objectives.length, 2, "package has 2 objectives");
  assert.equal(input.pkg.tasks.length, 2, "package has 2 tasks");
  // initiative must have no persisted id (authored package)
  assert.equal(
    input.pkg.initiative.id,
    undefined,
    "initiative has no persisted id in authored pkg",
  );
});

test("--create rewrites source files in place with their assigned ULID in frontmatter", async () => {
  const dir = await makeAuthoredDir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: true, apply: false, project: PROJ_ID },
    { createGraph: fake, newId: () => "01JTESTULID00000000000000A" },
  );

  assert.equal(
    result.exitCode,
    0,
    `exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  const oauthContent = await readFile(join(dir, "oauth.md"), "utf8");
  assert.ok(
    oauthContent.includes(INIT_ID),
    `initiative file must contain INIT_ID ${INIT_ID}; got:\n${oauthContent}`,
  );

  const backendContent = await readFile(
    join(dir, "backend", "backend.md"),
    "utf8",
  );
  assert.ok(
    backendContent.includes(OBJ1_ID),
    `backend objective file must contain OBJ1_ID ${OBJ1_ID}; got:\n${backendContent}`,
  );

  const frontendContent = await readFile(
    join(dir, "frontend", "frontend.md"),
    "utf8",
  );
  assert.ok(
    frontendContent.includes(OBJ2_ID),
    `frontend objective file must contain OBJ2_ID ${OBJ2_ID}; got:\n${frontendContent}`,
  );

  const implContent = await readFile(
    join(dir, "backend", "impl-api.md"),
    "utf8",
  );
  assert.ok(
    implContent.includes(TASK1_ID),
    `impl-api task file must contain TASK1_ID ${TASK1_ID}; got:\n${implContent}`,
  );

  const deployContent = await readFile(
    join(dir, "backend", "deploy.md"),
    "utf8",
  );
  assert.ok(
    deployContent.includes(TASK2_ID),
    `deploy task file must contain TASK2_ID ${TASK2_ID}; got:\n${deployContent}`,
  );
});

test("--create writes .kanthord-export.json with packageId + nodes snapshot", async () => {
  const dir = await makeAuthoredDir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: true, apply: false, project: PROJ_ID },
    { createGraph: fake, newId: () => "01JTESTULID00000000000000A" },
  );

  assert.equal(
    result.exitCode,
    0,
    `exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  let raw: string;
  try {
    raw = await readFile(join(dir, ".kanthord-export.json"), "utf8");
  } catch {
    assert.fail(".kanthord-export.json not found in source dir after --create");
  }

  const manifest = JSON.parse(raw) as Record<string, unknown>;
  assert.ok(
    typeof manifest["packageId"] === "string" &&
      (manifest["packageId"] as string).length > 0,
    "manifest.packageId is a non-empty string",
  );
  assert.ok(
    typeof manifest["nodes"] === "object" && manifest["nodes"] !== null,
    "manifest.nodes is an object",
  );
  const nodes = manifest["nodes"] as Record<string, unknown>;
  assert.ok(nodes[INIT_ID], `manifest.nodes has INIT_ID ${INIT_ID}`);
  assert.ok(nodes[OBJ1_ID], `manifest.nodes has OBJ1_ID ${OBJ1_ID}`);
  assert.ok(nodes[OBJ2_ID], `manifest.nodes has OBJ2_ID ${OBJ2_ID}`);
  assert.ok(nodes[TASK1_ID], `manifest.nodes has TASK1_ID ${TASK1_ID}`);
  assert.ok(nodes[TASK2_ID], `manifest.nodes has TASK2_ID ${TASK2_ID}`);
});

test("S3: --create packageId minted by injected newId is a ULID (uppercase Crockford ^[0-9A-HJKMNP-TV-Z]{26}$), not a UUID", async () => {
  const dir = await makeAuthoredDir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: true, apply: false, project: PROJ_ID },
    { createGraph: fake, newId },
  );

  assert.equal(
    result.exitCode,
    0,
    `exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  const raw = await readFile(join(dir, ".kanthord-export.json"), "utf8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  const packageId = manifest["packageId"];
  assert.ok(typeof packageId === "string", "manifest.packageId is a string");
  assert.match(
    packageId as string,
    /^[0-9A-HJKMNP-TV-Z]{26}$/,
    `packageId must be an uppercase Crockford ULID (^[0-9A-HJKMNP-TV-Z]{26}$); got: ${packageId}`,
  );
});

test("--create without --project exits 1 with error message", async () => {
  const dir = await makeAuthoredDir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: true, apply: false, project: undefined },
    { createGraph: fake, newId: () => "01JTESTULID00000000000000A" },
  );

  assert.equal(result.exitCode, 1, "--create without --project should exit 1");
  assert.equal(fake.calls.length, 0, "createGraph.execute must NOT be called");
  assert.ok(
    result.stderr.some((l) => /project/i.test(l) || l.startsWith("error:")),
    `stderr must mention 'project' or start with 'error:'; got: ${result.stderr.join(" ")}`,
  );
});

test("--create and --apply together exits 1 (mutually exclusive)", async () => {
  const dir = await makeAuthoredDir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: true, apply: true, project: PROJ_ID },
    { createGraph: fake, newId: () => "01JTESTULID00000000000000A" },
  );

  assert.equal(
    result.exitCode,
    1,
    "--create and --apply together should exit 1",
  );
  assert.equal(
    fake.calls.length,
    0,
    "createGraph.execute must NOT be called when flags conflict",
  );
  assert.ok(
    result.stderr.length > 0,
    "should emit at least one error line to stderr",
  );
});

// ─── Story 08 T1 — --dry-run fixture + fakes ─────────────────────────────────

// Valid 26-char uppercase Crockford ULIDs for the "exported" dry-run fixture
const DR_INIT_ID = "01JTEST00000000000000000A1";
const DR_OBJ1_ID = "01JTEST00000000000000000B2";
const DR_TASK1_ID = "01JTEST00000000000000000C3";
const DR_TASK2_ID = "01JTEST00000000000000000D4"; // present in manifest.files but absent from package (missing)

class FakeApplyGraph {
  calls: Array<{ initiativeId: string; dryRun?: boolean }> = [];
  result: ApplyGraphResult;

  constructor(result: ApplyGraphResult) {
    this.result = result;
  }

  async execute(input: {
    pkg: unknown;
    initiativeId: string;
    dryRun?: boolean;
  }): Promise<ApplyGraphResult> {
    this.calls.push({ initiativeId: input.initiativeId, dryRun: input.dryRun });
    return this.result;
  }
}

/** Build a minimal exported package dir (with ULIDs) for --dry-run tests. */
async function makeExportedDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-dryrun-t1-"));
  await mkdir(join(dir, "backend"), { recursive: true });

  // Initiative file with ULID id
  await writeFile(
    join(dir, "oauth.md"),
    [
      "---",
      "kind: initiative",
      `id: ${DR_INIT_ID}`,
      `ref: ${DR_INIT_ID}`,
      "name: oauth",
      "---",
      "",
    ].join("\n"),
  );

  // Objective file
  await writeFile(
    join(dir, "backend", "backend.md"),
    [
      "---",
      "kind: objective",
      `id: ${DR_OBJ1_ID}`,
      `ref: ${DR_OBJ1_ID}`,
      `initiative: ${DR_INIT_ID}`,
      "name: backend",
      "---",
      "",
    ].join("\n"),
  );

  // Task file (present in package — will be "updated" per the fake)
  await writeFile(
    join(dir, "backend", "impl-api.md"),
    [
      "---",
      "kind: task",
      `id: ${DR_TASK1_ID}`,
      `ref: ${DR_TASK1_ID}`,
      `objective: ${DR_OBJ1_ID}`,
      "title: implement api",
      "agent: generic@1",
      "---",
      "# Instructions",
      "Implement POST /oauth/token.",
      "# Acceptance Criteria",
      "- [ ] returns 200 for valid creds",
      "",
    ].join("\n"),
  );
  // DR_TASK2_ID is intentionally NOT written — it is "missing" from the package

  // Manifest: both tasks in `files`; DR_TASK2_ID is a missing-file candidate
  const manifest = {
    packageId: "01JTEST00000000000000000P5",
    formatVersion: 1,
    digestAlgorithm: "sha256",
    initiativeId: DR_INIT_ID,
    nodes: {
      [DR_INIT_ID]: "a".repeat(64),
      [DR_OBJ1_ID]: "b".repeat(64),
      [DR_TASK1_ID]: "c".repeat(64),
      [DR_TASK2_ID]: "d".repeat(64),
    },
    files: [DR_INIT_ID, DR_OBJ1_ID, DR_TASK1_ID, DR_TASK2_ID],
    refToId: {
      objectives: { [DR_OBJ1_ID]: DR_OBJ1_ID },
      tasks: { [DR_TASK1_ID]: DR_TASK1_ID, [DR_TASK2_ID]: DR_TASK2_ID },
    },
  };
  await writeFile(
    join(dir, ".kanthord-export.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  return dir;
}

// ─── Story 08 T1 tests ────────────────────────────────────────────────────────

test("--dry-run: prints all classification types from applyGraph result; writes no new manifest", async () => {
  const dir = await makeExportedDir();

  // Record the manifest mtime BEFORE dry-run to assert it was not rewritten
  const manifestPath = join(dir, ".kanthord-export.json");
  const beforeContent = await readFile(manifestPath, "utf8");

  const fakeResult: ApplyGraphResult = {
    applied: false,
    classifications: [
      {
        kind: "initiative",
        ref: DR_INIT_ID,
        id: DR_INIT_ID,
        class: "unchanged",
      },
      {
        kind: "objective",
        ref: DR_OBJ1_ID,
        id: DR_OBJ1_ID,
        class: "unchanged",
      },
      { kind: "task", ref: DR_TASK1_ID, id: DR_TASK1_ID, class: "updated" },
      {
        kind: "task",
        ref: DR_TASK2_ID,
        id: DR_TASK2_ID,
        class: "missing",
        reason: undefined,
      },
    ],
    summary: { created: 0, updated: 1, unchanged: 2, missing: 1 },
    conflicts: [],
  };
  const fakeApply = new FakeApplyGraph(fakeResult);
  const fakeCreate = new FakeCreateGraph(); // unused in --apply path

  const result = await runImportGraph(
    { dir, create: false, apply: true, dryRun: true, initiative: DR_INIT_ID },
    {
      createGraph: fakeCreate,
      applyGraph: fakeApply,
      newId: () => "01JTESTULID00000000000000A",
    },
  );

  assert.equal(
    result.exitCode,
    0,
    `--dry-run should exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  // Verify applyGraph.execute was called (with dryRun: true)
  assert.equal(
    fakeApply.calls.length,
    1,
    "applyGraph.execute called exactly once",
  );
  assert.equal(
    fakeApply.calls[0]!.dryRun,
    true,
    "applyGraph.execute called with dryRun: true",
  );

  // Verify stdout contains each classification type
  const out = result.stdout.join("\n");
  assert.ok(
    /updated/i.test(out),
    `stdout must mention 'updated'; got:\n${out}`,
  );
  assert.ok(
    /unchanged/i.test(out),
    `stdout must mention 'unchanged'; got:\n${out}`,
  );
  assert.ok(
    /missing/i.test(out),
    `stdout must mention 'missing'; got:\n${out}`,
  );

  // Verify NO new manifest was written (dry-run must not mutate the filesystem)
  const afterContent = await readFile(manifestPath, "utf8");
  assert.equal(
    afterContent,
    beforeContent,
    "dry-run must not rewrite .kanthord-export.json",
  );
});

// ─── Story 08 T2 — --delete-missing eligibility + plan + confirmation gate ────

/**
 * Spy variant of FakeApplyGraph that captures deleteMissing + confirmDelete
 * from the execute call so tests can assert the CLI forwards them correctly.
 */
class FakeApplyGraphDeleteMissingSpy {
  calls: Array<{
    initiativeId: string;
    dryRun?: boolean;
    deleteMissing?: boolean;
    confirmDelete?: boolean;
  }> = [];
  result: ApplyGraphResult;

  constructor(result: ApplyGraphResult) {
    this.result = result;
  }

  async execute(input: {
    pkg: unknown;
    initiativeId: string;
    dryRun?: boolean;
    deleteMissing?: boolean;
    confirmDelete?: boolean;
  }): Promise<ApplyGraphResult> {
    this.calls.push({
      initiativeId: input.initiativeId,
      dryRun: input.dryRun,
      deleteMissing: input.deleteMissing,
      confirmDelete: input.confirmDelete,
    });
    return this.result;
  }
}

/**
 * T2a: `--delete-missing` without `--confirm-delete` (non-interactive):
 *  - applyGraph.execute is called with deleteMissing: true
 *  - stdout contains "would delete" or "delete plan" for the eligible node
 *  - exits 0 (review step — no deletion, not an error)
 *
 * Fails today: --delete-missing flag absent from ImportGraphArgs + runImportGraph
 * does not pass deleteMissing to applyGraph.execute → call has deleteMissing:undefined;
 * stdout lacks the plan text.
 */
test("--delete-missing without --confirm-delete: applyGraph called with deleteMissing:true, stdout has plan, exits 0", async () => {
  const dir = await makeExportedDir();

  // One eligible missing node (pending, sha matches → no reason)
  const fakeResult: ApplyGraphResult = {
    applied: true,
    classifications: [
      {
        kind: "initiative",
        ref: DR_INIT_ID,
        id: DR_INIT_ID,
        class: "unchanged",
      },
      { kind: "task", ref: DR_TASK1_ID, id: DR_TASK1_ID, class: "unchanged" },
      {
        kind: "task",
        ref: DR_TASK2_ID,
        id: DR_TASK2_ID,
        class: "missing",
        reason: undefined, // pending + sha-match = eligible
      },
    ],
    summary: { created: 0, updated: 0, unchanged: 2, missing: 1 },
    conflicts: [],
  };
  const fakeApply = new FakeApplyGraphDeleteMissingSpy(fakeResult);
  const fakeCreate = new FakeCreateGraph();

  const result = await runImportGraph(
    {
      dir,
      create: false,
      apply: true,
      initiative: DR_INIT_ID,
      deleteMissing: true,
    } as any,
    { createGraph: fakeCreate, applyGraph: fakeApply } as any,
  );

  assert.equal(
    result.exitCode,
    0,
    `--delete-missing without confirm should exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  // CLI must forward deleteMissing:true to the use case
  assert.equal(
    fakeApply.calls.length,
    1,
    "applyGraph.execute called exactly once",
  );
  assert.equal(
    fakeApply.calls[0]!.deleteMissing,
    true,
    `applyGraph.execute must receive deleteMissing:true; got deleteMissing:${fakeApply.calls[0]!.deleteMissing}`,
  );

  // stdout must contain the plan text (Proof: grep -qiE 'would delete|delete plan')
  const out = result.stdout.join("\n");
  assert.ok(
    /would delete|delete plan/i.test(out),
    `stdout must mention 'would delete' or 'delete plan' for the eligible missing node; got:\n${out}`,
  );
});

/**
 * T2b: `--delete-missing` does NOT delete when confirmDelete is absent.
 * The apply result shows `applied:true` for the spec portion; the plan is printed
 * but the eligible node must still show up as "missing" in stdout (plan, not action).
 *
 * Fails today: same root cause as T2a — flag absent, output absent.
 */
test("--delete-missing without --confirm-delete: does not pass confirmDelete:true, plan printed not deleted", async () => {
  const dir = await makeExportedDir();

  const fakeResult: ApplyGraphResult = {
    applied: true,
    classifications: [
      {
        kind: "task",
        ref: DR_TASK2_ID,
        id: DR_TASK2_ID,
        class: "missing",
        reason: undefined,
      },
    ],
    summary: { created: 0, updated: 0, unchanged: 0, missing: 1 },
    conflicts: [],
  };
  const fakeApply = new FakeApplyGraphDeleteMissingSpy(fakeResult);
  const fakeCreate = new FakeCreateGraph();

  const result = await runImportGraph(
    {
      dir,
      create: false,
      apply: true,
      initiative: DR_INIT_ID,
      deleteMissing: true,
    } as any,
    { createGraph: fakeCreate, applyGraph: fakeApply } as any,
  );

  assert.equal(
    result.exitCode,
    0,
    `should exit 0 (review step); stderr: ${result.stderr.join(" ")}`,
  );

  // confirmDelete must NOT be true when flag is absent (non-interactive path)
  assert.notEqual(
    fakeApply.calls[0]?.confirmDelete,
    true,
    "confirmDelete must NOT be forwarded as true when --confirm-delete flag is absent",
  );
});

// ─── Story 08 T3 — --delete-missing --confirm-delete: exits 0, stdout has "1 deleted" ──

/**
 * T3: --delete-missing --confirm-delete passes confirmDelete:true to the use case;
 * when the use case reports summary.deleted === 1, the CLI prints "1 deleted" in stdout.
 *
 * Fails today: runApply has no "N deleted" branch — only the "would delete" preview path
 * is implemented (Story 08 T2). The confirmDelete:true path falls through to the generic
 * summary line which has no "deleted" count.
 */
test("--delete-missing --confirm-delete: exits 0, stdout contains '1 deleted'", async () => {
  const dir = await makeExportedDir();

  // Fake use case returns summary.deleted === 1 (one task was deleted by the apply)
  const fakeResult = {
    applied: true,
    classifications: [
      {
        kind: "initiative" as const,
        ref: DR_INIT_ID,
        id: DR_INIT_ID,
        class: "unchanged" as const,
      },
      {
        kind: "task" as const,
        ref: DR_TASK1_ID,
        id: DR_TASK1_ID,
        class: "unchanged" as const,
      },
      {
        kind: "task" as const,
        ref: DR_TASK2_ID,
        id: DR_TASK2_ID,
        class: "missing" as const,
        reason: undefined, // eligible → was deleted
      },
    ],
    // summary.deleted is not yet in the ApplyGraphResult type — cast to allow the extra field
    summary: {
      created: 0,
      updated: 0,
      unchanged: 2,
      missing: 0,
      deleted: 1,
    } as unknown as import("../../app/graph/apply-graph.ts").ApplyGraphResult["summary"],
    conflicts: [],
  } as unknown as import("../../app/graph/apply-graph.ts").ApplyGraphResult;

  const fakeApply = new FakeApplyGraph(fakeResult);
  const fakeCreate = new FakeCreateGraph();

  const result = await runImportGraph(
    {
      dir,
      create: false,
      apply: true,
      initiative: DR_INIT_ID,
      deleteMissing: true,
      confirmDelete: true,
    },
    {
      createGraph: fakeCreate,
      applyGraph: fakeApply,
      newId: () => "01JTESTULID00000000000000A",
    },
  );

  assert.equal(
    result.exitCode,
    0,
    `--confirm-delete should exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  // stdout must contain "1 deleted" (Proof: grep -qiE '(^|[^0-9])1 deleted')
  const out = result.stdout.join("\n");
  assert.ok(
    /1 deleted/i.test(out),
    `stdout must contain '1 deleted' when summary.deleted === 1; got:\n${out}`,
  );
});

// ─── Regression: missing-node label must cite human-readable name (Proof: grep -qiE 'missing.*deploy') ──

/**
 * BLOCKER missing-node-label: The Proof runs:
 *   node src/main.ts import graph "$PKG" --apply --initiative ... --dry-run 2>&1 | grep -qiE 'missing.*deploy'
 * Currently `runImportGraph` renders missing nodes as `missing: <ULID>` — the task name "deploy"
 * never appears, so the grep fails.
 *
 * Fix required: `ApplyClassification` gains an optional `name?: string` field; `apply-graph.ts`
 * populates it for missing task nodes by loading the task from the DB (`tasks.get(id)?.title`);
 * `import-graph.ts` uses `cls.name ?? cls.id ?? cls.ref` as the label for the classification line.
 *
 * RED: the current code ignores the `name` field (it doesn't exist on the interface), so
 * `missing.*deploy` never matches the output — the test asserts it must.
 */
test("BLOCKER missing-node-label: missing classification with name field emits name not just ULID (Proof grep -qiE 'missing.*deploy')", async () => {
  const dir = await makeExportedDir();

  const deployId = "01JTEST00000000000000000E5";

  // A missing task whose classification carries `name: "deploy"` (new field, not yet on the interface).
  // Use a cast so this test compiles now and fails for the right reason (production code ignores name).
  const missingCls = {
    kind: "task" as const,
    ref: deployId,
    id: deployId,
    class: "missing" as const,
    reason: undefined,
    name: "deploy", // <-- net-new optional field; SE must add to ApplyClassification + populate it
  };

  const fakeResult = {
    applied: true,
    classifications: [missingCls],
    summary: { created: 0, updated: 0, unchanged: 0, missing: 1 },
    conflicts: [],
  } as unknown as ApplyGraphResult;

  const fakeApply = new FakeApplyGraph(fakeResult);
  const fakeCreate = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: false, apply: true, initiative: DR_INIT_ID, dryRun: true },
    {
      createGraph: fakeCreate,
      applyGraph: fakeApply,
      newId: () => "01JTESTULID00000000000000A",
    },
  );

  const out = result.stdout.join("\n");
  // Proof assertion: grep -qiE 'missing.*deploy'
  assert.ok(
    /missing.*deploy/i.test(out),
    `output must cite task name "deploy" in the missing line (Proof: grep -qiE 'missing.*deploy'); got:\n${out}`,
  );
});

test("--dry-run missing: pending removed file vs non-pending not-exported shown distinctly in stdout", async () => {
  const dir = await makeExportedDir();

  const fakeResult: ApplyGraphResult = {
    applied: false,
    classifications: [
      {
        kind: "task",
        ref: DR_TASK1_ID,
        id: DR_TASK1_ID,
        class: "missing",
        reason: undefined, // pending file removed — delete-eligible candidate
      },
      {
        kind: "task",
        ref: DR_TASK2_ID,
        id: DR_TASK2_ID,
        class: "missing",
        reason: "non-pending", // running/completed task not exported — expected absence
      },
    ],
    summary: { created: 0, updated: 0, unchanged: 0, missing: 2 },
    conflicts: [],
  };
  const fakeApply = new FakeApplyGraph(fakeResult);
  const fakeCreate = new FakeCreateGraph();

  const result = await runImportGraph(
    { dir, create: false, apply: true, dryRun: true, initiative: DR_INIT_ID },
    {
      createGraph: fakeCreate,
      applyGraph: fakeApply,
      newId: () => "01JTESTULID00000000000000A",
    },
  );

  assert.equal(
    result.exitCode,
    0,
    `--dry-run should exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  const out = result.stdout.join("\n");

  // stdout must contain "non-pending" for the non-pending missing node
  assert.ok(
    /non-pending/i.test(out),
    `stdout must mention 'non-pending' for the expected-absent node; got:\n${out}`,
  );

  // stdout must also have a plain "missing" line (without "non-pending") for the delete-eligible node
  const missingLines = result.stdout.filter((l) => /missing/i.test(l));
  assert.ok(
    missingLines.length >= 2,
    `expect at least 2 missing lines; got: ${missingLines.join(", ")}`,
  );
  assert.ok(
    missingLines.some((l) => !/non-pending/i.test(l)),
    `at least one missing line must NOT say 'non-pending' (the pending-file case); lines: ${missingLines.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// Story 10 T2 (f) — manifest formatVersion 2 when package has bindings
// ---------------------------------------------------------------------------

async function makeBindingsAuthoredDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-t10t2-"));
  await mkdir(join(dir, "api"), { recursive: true });

  // Initiative with bindings declared in frontmatter (format-2 marker)
  await writeFile(
    join(dir, "todo.md"),
    [
      "---",
      "kind: initiative",
      "ref: todo",
      "name: todo",
      "bindings:",
      "  source: repository",
      "  model: ai_provider",
      "---",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "api", "api.md"),
    [
      "---",
      "kind: objective",
      "ref: api",
      "initiative: todo",
      "name: api",
      "context:",
      "  source: source",
      "  model: model",
      "---",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "api", "impl.md"),
    [
      "---",
      "kind: task",
      "ref: impl",
      "objective: api",
      "title: implement api",
      "agent: generic@1",
      "---",
      "# Instructions",
      "Build 5 REST endpoints.",
      "# Acceptance Criteria",
      "- [ ] endpoints return correct status codes",
      "",
    ].join("\n"),
  );

  return dir;
}

test("(f) --create with initiative that has bindings writes manifest with formatVersion 2", async () => {
  const dir = await makeBindingsAuthoredDir();
  const fake = new FakeCreateGraph();
  const T2_REPO_ID = "00000000000000000000000020";
  const T2_AIP_ID = "00000000000000000000000021";
  const t2Resources = new Map([
    [T2_REPO_ID, { type: "repository" as const }],
    [T2_AIP_ID, { type: "ai_provider" as const }],
  ]);

  const result = await runImportGraph(
    {
      dir,
      create: true,
      apply: false,
      project: PROJ_ID,
      bind: { source: T2_REPO_ID, model: T2_AIP_ID },
    },
    {
      createGraph: fake,
      newId,
      findResourcesByName: async () => [],
      getResource: async (id: string) => t2Resources.get(id),
    },
  );

  assert.equal(
    result.exitCode,
    0,
    `exit 0; stderr: ${result.stderr.join(" ")}`,
  );

  const raw = await readFile(join(dir, ".kanthord-export.json"), "utf8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(
    manifest["formatVersion"],
    2,
    `manifest.formatVersion must be 2 when package has bindings; got: ${manifest["formatVersion"]}`,
  );
});

// ---------------------------------------------------------------------------
// Story 10 T4 — --bind alias validation and resolution
// ---------------------------------------------------------------------------

// Resource IDs used in T4 tests
const REPO_ID = "00000000000000000000000010";
const AIP_ID = "00000000000000000000000011";
const CRED_ID = "00000000000000000000000012";

/** Package with all 3 binding aliases: source, model, model-auth */
async function makeBindings3Dir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-t10t4-"));
  await mkdir(join(dir, "api"), { recursive: true });
  await writeFile(
    join(dir, "todo.md"),
    [
      "---",
      "kind: initiative",
      "ref: todo",
      "name: todo",
      "bindings:",
      "  source: repository",
      "  model: ai_provider",
      "  model-auth: credential",
      "---",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "api", "api.md"),
    [
      "---",
      "kind: objective",
      "ref: api",
      "initiative: todo",
      "name: api",
      "context:",
      "  source: source",
      "  model: model",
      "  model-auth: model-auth",
      "---",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "api", "impl.md"),
    [
      "---",
      "kind: task",
      "ref: impl",
      "objective: api",
      "title: implement api",
      "agent: generic@1",
      "---",
      "# Instructions",
      "Build 5 REST endpoints.",
      "# Acceptance Criteria",
      "- [ ] endpoints return correct status codes",
      "",
    ].join("\n"),
  );
  return dir;
}

/** Known resource types for T4 — keyed by resource id */
const T4_RESOURCES = new Map<string, { type: string; provider?: string }>([
  [REPO_ID, { type: "repository" }],
  [AIP_ID, { type: "ai_provider", provider: "openai-codex" }],
  [CRED_ID, { type: "credential", provider: "openai-codex" }],
]);

test("T4(a): --bind missing model-auth alias → exitCode 1 and stderr mentions model-auth", async () => {
  const dir = await makeBindings3Dir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    {
      dir,
      create: true,
      apply: false,
      project: PROJ_ID,
      bind: { source: REPO_ID, model: AIP_ID },
    },
    {
      createGraph: fake,
      newId,
      findResourcesByName: async (
        _pid: string,
        _name: string,
        _type: string,
      ) => [],
      getResource: async (id: string) => T4_RESOURCES.get(id),
    },
  );

  assert.equal(
    result.exitCode,
    1,
    `expected exitCode 1 (model-auth unbound); got 0; stderr: ${result.stderr.join(" ")}`,
  );
  assert.ok(
    result.stderr.some((l) => /model-auth/i.test(l)),
    `stderr must mention 'model-auth'; got: ${result.stderr.join(" ")}`,
  );
});

test("T4(b): all 3 --bind provided → exitCode 0 and createGraph receives bindings map", async () => {
  const dir = await makeBindings3Dir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    {
      dir,
      create: true,
      apply: false,
      project: PROJ_ID,
      bind: { source: REPO_ID, model: AIP_ID, "model-auth": CRED_ID },
    },
    {
      createGraph: fake,
      newId,
      findResourcesByName: async (
        _pid: string,
        _name: string,
        _type: string,
      ) => [],
      getResource: async (id: string) => T4_RESOURCES.get(id),
    },
  );

  assert.equal(
    result.exitCode,
    0,
    `expected exitCode 0 with all 3 binds; stderr: ${result.stderr.join(" ")}`,
  );
  assert.equal(fake.calls.length, 1, "createGraph.execute called once");
  const call = fake.calls[0]!;
  const callBindings: unknown = call.bindings;
  assert.deepEqual(
    callBindings as Record<string, string>,
    { source: REPO_ID, model: AIP_ID, "model-auth": CRED_ID },
    "createGraph.execute must receive resolved bindings map",
  );
});

test("T4(c): --bind source=<name> → findResourcesByName resolves to id", async () => {
  const dir = await makeBindings3Dir();
  const fake = new FakeCreateGraph();
  let findCalled = false;

  const result = await runImportGraph(
    {
      dir,
      create: true,
      apply: false,
      project: PROJ_ID,
      bind: { source: "my-home-repo", model: AIP_ID, "model-auth": CRED_ID },
    },
    {
      createGraph: fake,
      newId,
      findResourcesByName: async (
        _pid: string,
        _name: string,
        _type: string,
      ) => {
        findCalled = true;
        return [{ id: REPO_ID }];
      },
      getResource: async (id: string) => T4_RESOURCES.get(id),
    },
  );

  assert.equal(
    result.exitCode,
    0,
    `expected exitCode 0 after name→id resolution; stderr: ${result.stderr.join(" ")}`,
  );
  assert.ok(
    findCalled,
    "findResourcesByName must be called for name-style bind value",
  );
  const call = fake.calls[0]!;
  const callBindingsC: unknown = call.bindings;
  assert.equal(
    (callBindingsC as Record<string, string> | undefined)?.["source"],
    REPO_ID,
    "resolved name→id must appear in bindings.source",
  );
});

test("T4(d): --bind source=<name> with 0 matches → exitCode 1 mentioning alias and name", async () => {
  const dir = await makeBindings3Dir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    {
      dir,
      create: true,
      apply: false,
      project: PROJ_ID,
      bind: { source: "no-such-repo", model: AIP_ID, "model-auth": CRED_ID },
    },
    {
      createGraph: fake,
      newId,
      findResourcesByName: async (
        _pid: string,
        _name: string,
        _type: string,
      ) => [],
      getResource: async (id: string) => T4_RESOURCES.get(id),
    },
  );

  assert.equal(
    result.exitCode,
    1,
    `expected exitCode 1 (unknown name); got 0; stderr: ${result.stderr.join(" ")}`,
  );
  assert.ok(
    result.stderr.some((l) => /source/i.test(l) || /no-such-repo/i.test(l)),
    `stderr must mention the alias or name; got: ${result.stderr.join(" ")}`,
  );
});

test("T4(e): --bind source=<name> with 2+ matches → exitCode 1 (ambiguous)", async () => {
  const dir = await makeBindings3Dir();
  const fake = new FakeCreateGraph();

  const result = await runImportGraph(
    {
      dir,
      create: true,
      apply: false,
      project: PROJ_ID,
      bind: { source: "dup-name", model: AIP_ID, "model-auth": CRED_ID },
    },
    {
      createGraph: fake,
      newId,
      findResourcesByName: async (
        _pid: string,
        _name: string,
        _type: string,
      ) => [{ id: "ID-A" }, { id: "ID-B" }],
      getResource: async (id: string) => T4_RESOURCES.get(id),
    },
  );

  assert.equal(
    result.exitCode,
    1,
    `expected exitCode 1 (ambiguous name); got 0; stderr: ${result.stderr.join(" ")}`,
  );
  assert.ok(
    result.stderr.some(
      (l) => /ambiguous|multiple/i.test(l) || /dup-name/i.test(l),
    ),
    `stderr must mention ambiguity or the duplicate name; got: ${result.stderr.join(" ")}`,
  );
});

test("T4(f): --bind source=<id> with wrong resource type → exitCode 1 (type mismatch)", async () => {
  const dir = await makeBindings3Dir();
  const fake = new FakeCreateGraph();

  // CRED_ID has type "credential" but alias "source" expects "repository"
  const result = await runImportGraph(
    {
      dir,
      create: true,
      apply: false,
      project: PROJ_ID,
      bind: { source: CRED_ID, model: AIP_ID, "model-auth": CRED_ID },
    },
    {
      createGraph: fake,
      newId,
      findResourcesByName: async (
        _pid: string,
        _name: string,
        _type: string,
      ) => [],
      getResource: async (id: string) => T4_RESOURCES.get(id),
    },
  );

  assert.equal(
    result.exitCode,
    1,
    `expected exitCode 1 (type mismatch for source alias); got 0; stderr: ${result.stderr.join(" ")}`,
  );
});
