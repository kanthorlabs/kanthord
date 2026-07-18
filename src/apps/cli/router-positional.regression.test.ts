/**
 * Regression tests — Proof positional-arg gap (EPIC 007 Verification Gate)
 *
 * The Proof bash block calls:
 *   node src/main.ts import graph "$SRC" --create --project "$PROJECT"
 *   node src/main.ts export initiative "$INITIATIVE" --out "$OUT"
 *
 * Both pass the first key argument as a POSITIONAL (not a named flag).
 * The router currently rejects positionals (`allowPositionals: false`), so the
 * Proof fails at the very first command.  These tests pin the correct behavior:
 * the router must extract the first positional as `dir` for "import graph" and
 * as `id` for "export initiative" — the same as passing `--dir` / `--id`.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { dispatch } from "./router.ts";

test("import graph accepts first positional as <dir> (Proof compatibility)", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "kanthord-positional-"));
  const dbPath = join(rootDir, "kanthord.db");
  const srcDir = join(rootDir, "oauth");
  mkdirSync(srcDir, { recursive: true });

  // Write a minimal 1-node package so the call can proceed past parsing
  writeFileSync(
    join(srcDir, "oauth.md"),
    "---\nkind: initiative\nref: oauth\nname: oauth\n---\n",
  );

  const deps = buildDeps(dbPath);
  after(() => {
    rmSync(rootDir, { recursive: true });
  });

  // Migrate + create project
  const rMig = await dispatch(["db", "migrate"], deps);
  assert.equal(rMig.exitCode, 0, "db migrate exits 0");
  const rProj = await dispatch(["create", "project", "--name", "demo"], deps);
  assert.equal(rProj.exitCode, 0, "create project exits 0");
  const PROJECT = rProj.stdout[0]!;

  // POSITIONAL dir — this is the form the Proof uses
  const r = await dispatch(
    ["import", "graph", srcDir, "--create", "--project", PROJECT],
    deps,
  );

  // The router must NOT reject with "does not take positional arguments".
  // It may fail for other reasons (e.g. package validation), but the
  // strict-positional rejection message must be absent.
  const allOutput = [...r.stdout, ...r.stderr].join("\n");
  assert.ok(
    !allOutput.includes("does not take positional arguments"),
    `import graph must accept positional dir; got: ${allOutput}`,
  );
  // If the single-node package (initiative only, no objectives/tasks) is
  // valid, the call exits 0. Guard: at minimum, exit code must not be 1
  // due to the positional-arg parse error.
  assert.equal(
    r.exitCode,
    0,
    `import graph with positional dir must exit 0 (stderr: ${r.stderr.join(" ")})`,
  );
});

test("export initiative accepts first positional as <id> (Proof compatibility)", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "kanthord-positional-exp-"));
  const dbPath = join(rootDir, "kanthord.db");
  const srcDir = join(rootDir, "oauth");
  const exportDir = join(rootDir, "export");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(exportDir, { recursive: true });

  writeFileSync(
    join(srcDir, "oauth.md"),
    "---\nkind: initiative\nref: oauth\nname: oauth\n---\n",
  );

  const deps = buildDeps(dbPath);
  after(() => {
    rmSync(rootDir, { recursive: true });
  });

  // Migrate + create project + create initiative
  await dispatch(["db", "migrate"], deps);
  const rProj = await dispatch(["create", "project", "--name", "demo"], deps);
  const PROJECT = rProj.stdout[0]!;

  const rCreate = await dispatch(
    ["import", "graph", "--dir", srcDir, "--create", "--project", PROJECT],
    deps,
  );
  assert.equal(rCreate.exitCode, 0, "import graph --create exits 0");

  const rListInit = await dispatch(
    ["list", "initiative", "--project", PROJECT, "--json"],
    deps,
  );
  const initiatives = JSON.parse(rListInit.stdout.join("")) as Array<{
    id: string;
  }>;
  const INITIATIVE = initiatives[0]!.id;

  // POSITIONAL id — this is the form the Proof uses
  const r = await dispatch(
    ["export", "initiative", INITIATIVE, "--out", exportDir],
    deps,
  );

  const allOutput = [...r.stdout, ...r.stderr].join("\n");
  assert.ok(
    !allOutput.includes("does not take positional arguments"),
    `export initiative must accept positional id; got: ${allOutput}`,
  );
  assert.equal(
    r.exitCode,
    0,
    `export initiative with positional id must exit 0 (stderr: ${r.stderr.join(" ")})`,
  );
});
