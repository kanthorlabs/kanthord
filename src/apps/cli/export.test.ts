/**
 * Story 04 T2 — CLI writes the cosmetic tree + INDEX + manifest
 *
 * Assertions:
 * (a) `export initiative <id> --out <dir>` writes <dir>/<name-slug>/<name-slug>.md,
 *     nested objective dirs, pending-task files, INDEX.md, .kanthord-export.json
 * (b) missing --out → exit 1 with a usage error
 * (c) the written .kanthord-export.json deep-equals the use case's manifest
 * (d) the written tree re-parses (parseGraphPackage) to a GraphPackage
 *     semantically equal to the use case's return (round-trip)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runExportInitiative } from "./export.ts";
import { readGraphPackageDir } from "./graph-md/parse.ts";
import { parseGraphPackage as coreParseGraphPackage } from "../../app/graph/graph-codec.ts";

/** Convenience wrapper: reads a pkg dir then calls the pure core codec. */
async function parseGraphPackage(dir: string) {
  const files = await readGraphPackageDir(dir);
  return coreParseGraphPackage(files);
}
import type { GraphPackage } from "../../app/graph/graph-package.ts";

// ─── stable test IDs (valid 26-char uppercase Crockford) ──────────────────────
const INIT_ID = "00000000000000000000000001";
const OBJ1_ID = "00000000000000000000000002";
const TASK1_ID = "00000000000000000000000004";
const TASK2_ID = "00000000000000000000000005";

// ─── fixed GraphPackage the fake use case returns ──────────────────────────────
const FIXED_PKG: GraphPackage = {
  packageId: "00000000000000000000000099",
  formatVersion: 1,
  initiative: {
    id: INIT_ID,
    ref: INIT_ID,
    name: "oauth",
    sourcePath: "oauth.md",
  },
  objectives: [
    {
      id: OBJ1_ID,
      ref: OBJ1_ID,
      initiativeRef: INIT_ID,
      name: "backend",
      sourcePath: "backend/backend.md",
    },
  ],
  tasks: [
    {
      id: TASK1_ID,
      ref: TASK1_ID,
      objectiveRef: OBJ1_ID,
      title: "implement api",
      instructions: "Implement POST /oauth/token",
      ac: ["returns 200 for valid creds"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [],
      sourcePath: "backend/implement-api.md",
    },
    {
      id: TASK2_ID,
      ref: TASK2_ID,
      objectiveRef: OBJ1_ID,
      title: "deploy",
      instructions: "Deploy the backend",
      ac: ["health check green"],
      agent: "generic@1",
      verification: undefined,
      dependencies: [TASK1_ID],
      sourcePath: "backend/deploy.md",
    },
  ],
  manifest: {
    initiativeId: INIT_ID,
    packageId: "00000000000000000000000099",
    formatVersion: 1,
    digestAlgorithm: "sha256",
    nodes: {
      [INIT_ID]: "a".repeat(64),
      [OBJ1_ID]: "b".repeat(64),
      [TASK1_ID]: "c".repeat(64),
      [TASK2_ID]: "d".repeat(64),
    },
    files: [INIT_ID, OBJ1_ID, TASK1_ID, TASK2_ID],
    refToId: {
      objectives: { [OBJ1_ID]: OBJ1_ID },
      tasks: { [TASK1_ID]: TASK1_ID, [TASK2_ID]: TASK2_ID },
    },
  },
};

/** Fake ExportInitiative use case — returns FIXED_PKG regardless of input. */
class FakeExportInitiative {
  async execute(_initiativeId: string): Promise<GraphPackage> {
    return FIXED_PKG;
  }
}

// ─── helper: check a path exists ─────────────────────────────────────────────
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

test("runExportInitiative writes cosmetic tree: initiative md, objective dir, task files, INDEX.md, .kanthord-export.json", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "kanthord-export-t2-"));
  const uc = new FakeExportInitiative();

  const result = await runExportInitiative(
    { id: INIT_ID, out: tmpDir },
    uc as Parameters<typeof runExportInitiative>[1],
  );

  assert.equal(
    result.exitCode,
    0,
    `exit 0, stderr: ${result.stderr.join(" ")}`,
  );

  // initiative file at <out>/oauth/oauth.md
  assert.ok(
    await exists(join(tmpDir, "oauth", "oauth.md")),
    "initiative file written",
  );

  // objective dir + file at <out>/oauth/backend/backend.md
  assert.ok(
    await exists(join(tmpDir, "oauth", "backend", "backend.md")),
    "objective file written",
  );

  // task files
  assert.ok(
    await exists(join(tmpDir, "oauth", "backend", "implement-api.md")),
    "task1 file written (slug from title)",
  );
  assert.ok(
    await exists(join(tmpDir, "oauth", "backend", "deploy.md")),
    "task2 file written (slug from title)",
  );

  // INDEX.md in the initiative dir
  assert.ok(
    await exists(join(tmpDir, "oauth", "INDEX.md")),
    "INDEX.md written",
  );

  // .kanthord-export.json in the initiative dir
  assert.ok(
    await exists(join(tmpDir, "oauth", ".kanthord-export.json")),
    ".kanthord-export.json written",
  );
});

test("runExportInitiative missing --out exits 1 with usage error", async () => {
  const uc = new FakeExportInitiative();

  const result = await runExportInitiative(
    { id: INIT_ID, out: undefined as unknown as string },
    uc as Parameters<typeof runExportInitiative>[1],
  );

  assert.equal(result.exitCode, 1, "exit 1 when --out missing");
  assert.ok(
    result.stderr.some((l) => l.startsWith("error:") || l.includes("--out")),
    `stderr must mention '--out' or start with 'error:', got: ${result.stderr.join(" ")}`,
  );
});

test("runExportInitiative writes .kanthord-export.json that deep-equals the use case manifest", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "kanthord-export-t2-manifest-"));
  const uc = new FakeExportInitiative();

  await runExportInitiative(
    { id: INIT_ID, out: tmpDir },
    uc as Parameters<typeof runExportInitiative>[1],
  );

  const raw = await readFile(
    join(tmpDir, "oauth", ".kanthord-export.json"),
    "utf8",
  );
  const written = JSON.parse(raw) as unknown;
  assert.deepEqual(
    written,
    FIXED_PKG.manifest,
    "manifest JSON deep-equals use case manifest",
  );
});

test("runExportInitiative round-trip: re-parsing the export yields semantically equal GraphPackage", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "kanthord-export-t2-roundtrip-"));
  const uc = new FakeExportInitiative();

  await runExportInitiative(
    { id: INIT_ID, out: tmpDir },
    uc as Parameters<typeof runExportInitiative>[1],
  );

  const reparsed = await parseGraphPackage(join(tmpDir, "oauth"));

  // initiative identity
  assert.equal(reparsed.initiative.id, INIT_ID, "reparsed initiative.id");
  assert.equal(reparsed.initiative.name, "oauth", "reparsed initiative.name");

  // objectives
  assert.equal(reparsed.objectives.length, 1, "one objective reparsed");
  assert.equal(reparsed.objectives[0]?.id, OBJ1_ID, "reparsed objective id");
  assert.equal(
    reparsed.objectives[0]?.name,
    "backend",
    "reparsed objective name",
  );

  // tasks
  const taskIds = reparsed.tasks.map((t) => t.id);
  assert.ok(taskIds.includes(TASK1_ID), "task1 reparsed");
  assert.ok(taskIds.includes(TASK2_ID), "task2 reparsed");

  const t2 = reparsed.tasks.find((t) => t.id === TASK2_ID);
  assert.ok(t2, "task2 found");
  assert.deepEqual(
    t2!.dependencies,
    [TASK1_ID],
    "task2 depends on ULID reparsed",
  );
});
