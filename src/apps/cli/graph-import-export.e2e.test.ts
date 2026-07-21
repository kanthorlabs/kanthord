/**
 * Story 10 T1 — e2e smoke test: full import/export graph flow
 *
 * Mirrors the epic Proof step-for-step with real assertions (not comments).
 * Fails until every earlier story is wired.  When green, this IS the committed
 * regression anchor; the epic Proof block (T2) then becomes a copy-paste-run.
 *
 * 7 legs:
 *   1. Create mode — markdown → DB; id-handoff rewrites source files.
 *   2. Export — DB → cosmetic tree + manifest; exported node carries ULID.
 *   3. Apply (update) — edit ac; summary: 1 updated + 4 unchanged.
 *   4. Id-less create during apply — add new task; 1 created → 0 on re-apply.
 *   5. Reparent via frontmatter — change objective: ref; 1 updated.
 *   6. Guarded delete-missing — dry-run, plan, confirmed delete.
 *   7. Conflict via sha256 CAS — stale apply exits 1, cites drift + sourcePath.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "../../composition.ts";
import { runCli as dispatch } from "./commands/run-cli.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function parseJsonLine(lines: string[]): unknown[] {
  // JSON output: single line containing a JSON array
  return JSON.parse(lines.join(""));
}

test("e2e: import/export graph — 7 legs through composition root + real SQLite", async () => {
  // -----------------------------------------------------------------------
  // Setup: temp DB + temp markdown source dirs
  // -----------------------------------------------------------------------
  const rootDir = mkdtempSync(join(tmpdir(), "kanthord-graph-e2e-"));
  const dbPath = join(rootDir, "kanthord.db");
  const srcDir = join(rootDir, "oauth");
  const exportDir1 = join(rootDir, "export1");
  const exportDir2 = join(rootDir, "export2");
  const deps = buildDeps(dbPath);

  after(() => {
    rmSync(rootDir, { recursive: true });
  });

  // -----------------------------------------------------------------------
  // Bootstrap: migrate + project
  // -----------------------------------------------------------------------
  const migrate = await dispatch(["db", "migrate"], deps);
  assert.equal(migrate.exitCode, 0, "db migrate exits 0");

  const rProj = await dispatch(["create", "project", "--name", "demo"], deps);
  assert.equal(rProj.exitCode, 0, "create project exits 0");
  const PROJECT = rProj.stdout[0]!;
  assert.match(PROJECT, ULID_RE, "create project returns a ULID");

  // -----------------------------------------------------------------------
  // Leg 1: CREATE MODE — author a graph as markdown, import --create
  // -----------------------------------------------------------------------
  // Write the source markdown files
  mkdirSync(join(srcDir, "backend"), { recursive: true });
  mkdirSync(join(srcDir, "frontend"), { recursive: true });

  writeFileSync(
    join(srcDir, "oauth.md"),
    "---\nkind: initiative\nref: oauth\nname: oauth\n---\n",
  );
  writeFileSync(
    join(srcDir, "backend", "backend.md"),
    "---\nkind: objective\nref: backend\ninitiative: oauth\nname: backend\n---\n",
  );
  writeFileSync(
    join(srcDir, "frontend", "frontend.md"),
    "---\nkind: objective\nref: frontend\ninitiative: oauth\nname: frontend\n---\n",
  );
  writeFileSync(
    join(srcDir, "backend", "implement-api.md"),
    [
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
    ].join("\n"),
  );
  writeFileSync(
    join(srcDir, "backend", "deploy.md"),
    [
      "---",
      "kind: task",
      "ref: deploy",
      "objective: backend",
      "title: deploy",
      "agent: generic@1",
      "dependencies: [implement-api]",
      "---",
      "# Instructions",
      "Deploy the backend",
      "# Acceptance Criteria",
      "- [ ] health check green",
      "",
    ].join("\n"),
  );

  // import graph --create --project
  const rCreate = await dispatch(
    ["import", "graph", srcDir, "--create", "--project", PROJECT],
    deps,
  );
  assert.equal(rCreate.exitCode, 0, "import graph --create exits 0");

  // list initiative --project --json → 1 initiative
  const rListInit = await dispatch(
    ["list", "initiative", "--project", PROJECT, "--json"],
    deps,
  );
  assert.equal(
    rListInit.exitCode,
    0,
    `list initiative --project --json exits 0 (stderr: ${rListInit.stderr.join(" ")})`,
  );
  const initiatives = parseJsonLine(rListInit.stdout) as Array<{
    id: string;
  }>;
  assert.equal(initiatives.length, 1, "exactly 1 initiative after create");
  const INITIATIVE = initiatives[0]!.id;
  assert.match(INITIATIVE, ULID_RE, "initiative id is a ULID");

  // list objective --initiative --json → 2 objectives
  const rListObj = await dispatch(
    ["list", "objective", "--initiative", INITIATIVE, "--json"],
    deps,
  );
  assert.equal(
    rListObj.exitCode,
    0,
    `list objective --initiative --json exits 0 (stderr: ${rListObj.stderr.join(" ")})`,
  );
  const objectives = parseJsonLine(rListObj.stdout) as Array<{
    id: string;
    name: string;
  }>;
  assert.equal(objectives.length, 2, "exactly 2 objectives after create");

  // list task --initiative --json → 2 tasks
  const rListTask1 = await dispatch(
    ["list", "task", "--initiative", INITIATIVE, "--json"],
    deps,
  );
  assert.equal(rListTask1.exitCode, 0, "list task --initiative --json exits 0");
  const tasks1 = parseJsonLine(rListTask1.stdout) as Array<{ id: string }>;
  assert.equal(tasks1.length, 2, "exactly 2 tasks after create");

  // B1: --create REWROTE the source file in place with its assigned ULID
  const implApiContent1 = readFileSync(
    join(srcDir, "backend", "implement-api.md"),
    "utf8",
  );
  assert.match(
    implApiContent1,
    /^id: [0-9A-HJKMNP-TV-Z]{26}$/m,
    "implement-api.md rewritten with ULID id: after --create",
  );

  // -----------------------------------------------------------------------
  // Leg 2: EXPORT → cosmetic tree + manifest; created file carries ULID
  // -----------------------------------------------------------------------
  const rExport = await dispatch(
    ["export", "initiative", INITIATIVE, "--out", exportDir1],
    deps,
  );
  assert.equal(rExport.exitCode, 0, "export initiative exits 0");

  // Locate the package root (slugified initiative name)
  const pkgDir = join(exportDir1, "oauth");

  // Assert files exist
  assert.ok(
    (() => {
      try {
        readFileSync(join(pkgDir, "oauth.md"));
        return true;
      } catch {
        return false;
      }
    })(),
    "oauth.md exists in export",
  );
  assert.ok(
    (() => {
      try {
        readFileSync(join(pkgDir, "backend", "implement-api.md"));
        return true;
      } catch {
        return false;
      }
    })(),
    "backend/implement-api.md exists in export",
  );
  assert.ok(
    (() => {
      try {
        readFileSync(join(pkgDir, ".kanthord-export.json"));
        return true;
      } catch {
        return false;
      }
    })(),
    ".kanthord-export.json exists in export",
  );

  // Exported file carries its ULID as `id:`
  const exportedImplApi = readFileSync(
    join(pkgDir, "backend", "implement-api.md"),
    "utf8",
  );
  assert.match(
    exportedImplApi,
    /^id: [0-9A-HJKMNP-TV-Z]{26}$/m,
    "exported implement-api.md carries ULID id:",
  );

  // Capture the task id from the exported file
  const idMatch = exportedImplApi.match(/^id: ([0-9A-HJKMNP-TV-Z]{26})$/m);
  assert.ok(idMatch, "can extract ULID from exported implement-api.md");
  const TASK_API = idMatch![1]!;

  // -----------------------------------------------------------------------
  // Leg 3: APPLY (update) — edit ac, assert 1 updated + 4 unchanged
  // -----------------------------------------------------------------------
  const implApiPath = join(pkgDir, "backend", "implement-api.md");
  const implApiBeforeEdit = readFileSync(implApiPath, "utf8");
  writeFileSync(
    implApiPath,
    implApiBeforeEdit + "- [ ] rejects bad creds with 401\n",
  );

  const rApplyUpdate = await dispatch(
    ["import", "graph", pkgDir, "--apply", "--initiative", INITIATIVE],
    deps,
  );
  assert.equal(
    rApplyUpdate.exitCode,
    0,
    `apply (update) exits 0 (stderr: ${rApplyUpdate.stderr.join(" ")})`,
  );
  const applyUpdateOut = rApplyUpdate.stdout.join("\n");
  assert.match(
    applyUpdateOut,
    /\b1 updated\b/,
    "apply update: stdout contains '1 updated'",
  );
  assert.match(
    applyUpdateOut,
    /\b4 unchanged\b/,
    "apply update: stdout contains '4 unchanged' (all-node summary B14)",
  );

  // verify new ac landed; old ac kept
  const rGetTask1 = await dispatch(
    ["get", "task", "--id", TASK_API, "--json"],
    deps,
  );
  assert.equal(rGetTask1.exitCode, 0, "get task exits 0");
  const task1Json = JSON.parse(rGetTask1.stdout.join("")) as { ac: string[] };
  assert.ok(
    task1Json.ac.some((a) => a.includes("rejects bad creds with 401")),
    "new ac present after apply",
  );
  assert.ok(
    task1Json.ac.some((a) => a.includes("returns 200 for valid creds")),
    "old ac kept after apply",
  );

  // no dup: still 2 tasks
  const rListTask2 = await dispatch(
    ["list", "task", "--initiative", INITIATIVE, "--json"],
    deps,
  );
  const tasks2 = parseJsonLine(rListTask2.stdout) as unknown[];
  assert.equal(tasks2.length, 2, "no dup after apply update");

  // -----------------------------------------------------------------------
  // Leg 4: ID-LESS CREATE during apply — add new task, 1 created; re-apply 0
  // -----------------------------------------------------------------------
  // Read backend objective id from the export manifest
  const manifest1 = JSON.parse(
    readFileSync(join(pkgDir, ".kanthord-export.json"), "utf8"),
  ) as { refToId: { objectives: Record<string, string> } };
  // Find the backend objective id (its ref is its ULID, so refToId has ULID→ULID)
  const backendObj = objectives.find((o) => o.name === "backend");
  assert.ok(backendObj, "backend objective must be found");
  const BACKEND = backendObj!.id;

  const writeTestsPath = join(pkgDir, "backend", "write-tests.md");
  writeFileSync(
    writeTestsPath,
    [
      "---",
      "kind: task",
      "ref: write-tests",
      `objective: ${BACKEND}`,
      "title: write tests",
      "agent: generic@1",
      `dependencies: [${TASK_API}]`,
      "---",
      "# Instructions",
      "Add unit tests for the token endpoint.",
      "# Acceptance Criteria",
      "- [ ] covers valid and invalid credentials",
      "",
    ].join("\n"),
  );

  // First apply: 1 created
  const rApplyCreate1 = await dispatch(
    ["import", "graph", pkgDir, "--apply", "--initiative", INITIATIVE],
    deps,
  );
  assert.equal(rApplyCreate1.exitCode, 0, "apply (id-less create) exits 0");
  assert.match(
    rApplyCreate1.stdout.join("\n"),
    /\b1 created\b/,
    "first re-apply: stdout contains '1 created'",
  );

  // File was rewritten with an id
  const writeTestsContent = readFileSync(writeTestsPath, "utf8");
  assert.match(
    writeTestsContent,
    /^id: [0-9A-HJKMNP-TV-Z]{26}$/m,
    "write-tests.md rewritten with ULID after apply (B1 handoff)",
  );

  // Second apply: 0 created (no dup — durable idempotency)
  const rApplyCreate2 = await dispatch(
    ["import", "graph", pkgDir, "--apply", "--initiative", INITIATIVE],
    deps,
  );
  assert.equal(rApplyCreate2.exitCode, 0, "re-apply (idempotency) exits 0");
  assert.match(
    rApplyCreate2.stdout.join("\n"),
    /\b0 created\b/,
    "re-apply: stdout contains '0 created' (no dup)",
  );

  // DB: 3 tasks now
  const rListTask3 = await dispatch(
    ["list", "task", "--initiative", INITIATIVE, "--json"],
    deps,
  );
  const tasks3 = parseJsonLine(rListTask3.stdout) as unknown[];
  assert.equal(tasks3.length, 3, "3 tasks after id-less create apply");

  // -----------------------------------------------------------------------
  // Leg 5: REPARENT via frontmatter — change objective: ref; 1 updated
  // -----------------------------------------------------------------------
  const frontendObj = objectives.find((o) => o.name === "frontend");
  assert.ok(frontendObj, "frontend objective must be found");
  const FRONTEND = frontendObj!.id;

  // Edit deploy.md to move it to frontend objective
  const deployPath = join(pkgDir, "backend", "deploy.md");
  const deployContent = readFileSync(deployPath, "utf8");
  const deployReparented = deployContent.replace(
    /^objective: .+$/m,
    `objective: ${FRONTEND}`,
  );
  writeFileSync(deployPath, deployReparented);

  const rApplyReparent = await dispatch(
    ["import", "graph", pkgDir, "--apply", "--initiative", INITIATIVE],
    deps,
  );
  assert.equal(rApplyReparent.exitCode, 0, "apply (reparent) exits 0");
  assert.match(
    rApplyReparent.stdout.join("\n"),
    /\b1 updated\b/,
    "reparent apply: stdout contains '1 updated'",
  );

  // Verify deploy task moved to frontend objective
  const rListFrontendTasks = await dispatch(
    [
      "list",
      "task",
      "--initiative",
      INITIATIVE,
      "--objective",
      FRONTEND,
      "--json",
    ],
    deps,
  );
  assert.equal(rListFrontendTasks.exitCode, 0, "list task --objective exits 0");
  const frontendTasks = parseJsonLine(rListFrontendTasks.stdout) as Array<{
    title: string;
  }>;
  assert.ok(
    frontendTasks.some((t) => t.title === "deploy"),
    "deploy task now in frontend objective",
  );

  // -----------------------------------------------------------------------
  // Leg 6: GUARDED DELETE-MISSING
  // -----------------------------------------------------------------------
  // Remove deploy.md from the package
  rmSync(deployPath);

  // --dry-run: reports missing, changes nothing
  const rDryRun = await dispatch(
    [
      "import",
      "graph",
      pkgDir,
      "--apply",
      "--initiative",
      INITIATIVE,
      "--dry-run",
    ],
    deps,
  );
  assert.equal(rDryRun.exitCode, 0, "--dry-run exits 0");
  assert.match(
    rDryRun.stdout.join("\n"),
    /missing/i,
    "--dry-run output mentions 'missing'",
  );
  // dry-run: still 3 tasks in DB
  const rListTask4 = await dispatch(
    ["list", "task", "--initiative", INITIATIVE, "--json"],
    deps,
  );
  const tasks4 = parseJsonLine(rListTask4.stdout) as unknown[];
  assert.equal(tasks4.length, 3, "dry-run changed nothing");

  // --delete-missing without --confirm-delete: prints plan, deletes nothing (non-interactive)
  const rDeletePlan = await dispatch(
    [
      "import",
      "graph",
      pkgDir,
      "--apply",
      "--initiative",
      INITIATIVE,
      "--delete-missing",
    ],
    deps,
  );
  assert.equal(
    rDeletePlan.exitCode,
    0,
    "--delete-missing (no confirm) exits 0",
  );
  assert.match(
    rDeletePlan.stdout.join("\n"),
    /would delete|delete plan/i,
    "--delete-missing prints plan matching /would delete|delete plan/i",
  );
  // still 3 tasks (plan only, nothing deleted)
  const rListTask5 = await dispatch(
    ["list", "task", "--initiative", INITIATIVE, "--json"],
    deps,
  );
  const tasks5 = parseJsonLine(rListTask5.stdout) as unknown[];
  assert.equal(
    tasks5.length,
    3,
    "--delete-missing (no confirm) deleted nothing",
  );

  // --delete-missing --confirm-delete: removes the pending deploy task
  const rConfirmDelete = await dispatch(
    [
      "import",
      "graph",
      pkgDir,
      "--apply",
      "--initiative",
      INITIATIVE,
      "--delete-missing",
      "--confirm-delete",
    ],
    deps,
  );
  assert.equal(rConfirmDelete.exitCode, 0, "--confirm-delete exits 0");
  assert.match(
    rConfirmDelete.stdout.join("\n"),
    /\b1 deleted\b/i,
    "--confirm-delete output contains '1 deleted'",
  );
  const rListTask6 = await dispatch(
    ["list", "task", "--initiative", INITIATIVE, "--json"],
    deps,
  );
  const tasks6 = parseJsonLine(rListTask6.stdout) as unknown[];
  assert.equal(
    tasks6.length,
    2,
    "deploy removed; implement-api + write-tests remain",
  );

  // -----------------------------------------------------------------------
  // Leg 7: CONFLICT via sha256 CAS — stale apply exits 1, mentions drift
  // -----------------------------------------------------------------------
  // Export fresh → edit → apply → bumps implement-api sha in DB
  const rExport2 = await dispatch(
    ["export", "initiative", INITIATIVE, "--out", exportDir2],
    deps,
  );
  assert.equal(rExport2.exitCode, 0, "second export exits 0");
  const pkgDir2 = join(exportDir2, "oauth");
  const implApi2Path = join(pkgDir2, "backend", "implement-api.md");
  const implApi2Before = readFileSync(implApi2Path, "utf8");
  writeFileSync(
    implApi2Path,
    implApi2Before + "- [ ] also rejects an expired token\n",
  );

  // Apply the fresh export → bumps implement-api sha in DB
  const rApplyFresh = await dispatch(
    ["import", "graph", pkgDir2, "--apply", "--initiative", INITIATIVE],
    deps,
  );
  assert.equal(rApplyFresh.exitCode, 0, "fresh-export apply exits 0");
  assert.match(
    rApplyFresh.stdout.join("\n"),
    /\b1 updated\b/,
    "fresh apply: 1 updated (bumps sha)",
  );

  // Now re-apply the STALE pkgDir (which has the old sha in its manifest).
  // The preflight should detect the drift and reject.
  const rApplyStale = await dispatch(
    ["import", "graph", pkgDir, "--apply", "--initiative", INITIATIVE],
    deps,
  );
  assert.notEqual(
    rApplyStale.exitCode,
    0,
    "stale apply must exit non-zero (drift conflict)",
  );
  const staleOut = [...rApplyStale.stdout, ...rApplyStale.stderr].join("\n");
  assert.match(
    staleOut,
    /implement-api|implement api/i,
    "conflict output mentions implement-api",
  );
  assert.match(staleOut, /drift/i, "conflict output mentions 'drift'");
  // sourcePath is cited in the conflict report as the FULL PACKAGE-QUALIFIED
  // path ($PKG/backend/implement-api.md) — Proof line 178 / RB2.
  const qualifiedImplApiPath = join(pkgDir, "backend", "implement-api.md");
  assert.ok(
    staleOut.includes(qualifiedImplApiPath),
    `conflict output must cite the full qualified sourcePath (${qualifiedImplApiPath}); got:\n${staleOut}`,
  );

  // DB unchanged after rejected stale apply — implement-api still has the
  // "also rejects an expired token" ac (from the fresh apply, not rolled back)
  const rGetTaskFinal = await dispatch(
    ["get", "task", "--id", TASK_API, "--json"],
    deps,
  );
  assert.equal(rGetTaskFinal.exitCode, 0, "get task (final) exits 0");
  const taskFinalJson = JSON.parse(rGetTaskFinal.stdout.join("")) as {
    ac: string[];
  };
  assert.ok(
    taskFinalJson.ac.some((a) => a.includes("also rejects an expired token")),
    "DB unchanged by rejected stale apply (fresh ac still present)",
  );
});
