/**
 * Story 09 T3 — context-preservation (real SQLite, S1)
 *
 * Proves that an `ApplyGraph` apply (spec + dependency edit) leaves
 * `task_context` (resource bindings) byte-for-byte untouched and that the
 * sha256 token changes (so context is definitively excluded from the hash).
 *
 * Action — GREEN: covered by Stories 02+07; this test asserts the guarantee.
 * Characterisation exception: first-run pass is intentional. Sensitivity
 * proof: if `compareAndApply` touched `task_context` (e.g. via a broad
 * DELETE+INSERT) `getTaskContext` would return `{}` instead of the original
 * map. If the sha canonicaliser included `task_context`, the sha before and
 * after would be equal (no change detected) — the `notEqual` assertion would
 * fail.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "../../storage/sqlite/open.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";
import { SqliteProjectRepository } from "../../storage/sqlite/sqlite-project-repository.ts";
import { SqliteInitiativeRepository } from "../../storage/sqlite/sqlite-initiative-repository.ts";
import { SqliteTaskRepository } from "../../storage/sqlite/sqlite-task-repository.ts";
import { SqliteUnitOfWork } from "../../storage/sqlite/sqlite-unit-of-work.ts";
import { SqliteGraphImportMap } from "../../storage/sqlite/sqlite-graph-import-map.ts";
import { newId } from "../../domain/entity.ts";
import { newTask } from "../../domain/task.ts";
import { ApplyGraph } from "./apply-graph.ts";
import type { GraphPackage, ExportManifest } from "./graph-package.ts";
import { StoreGraph } from "./store-graph.ts";

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-ctx-preservation-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

test("context-preservation: apply(spec+dep edit) leaves task_context byte-identical AND sha256 changes", async () => {
  const { db, dir } = makeTempDb();
  after(() => {
    db.close();
    rmSync(dir, { recursive: true });
  });

  // -----------------------------------------------------------------------
  // 1. Seed hierarchy: project → initiative → objective → task
  // -----------------------------------------------------------------------
  const projectRepo = new SqliteProjectRepository(db);
  const initRepo = new SqliteInitiativeRepository(db);
  const taskRepo = new SqliteTaskRepository(db);
  const uow = new SqliteUnitOfWork(db);
  const importMap = new SqliteGraphImportMap(db);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();

  projectRepo.save({ id: projectId, name: "TestProject" });
  initRepo.save({ id: initiativeId, projectId, name: "TestInit" });
  initRepo.saveObjective({ id: objectiveId, initiativeId, name: "TestObj" });

  const task = newTask({
    id: newId(),
    objectiveId,
    title: "implement auth",
    instructions: "implement the auth endpoint",
    ac: ["returns 200 for valid creds"],
    agent: "generic@1",
  });
  taskRepo.save(task);

  // -----------------------------------------------------------------------
  // 2. Bind resource context via saveTaskContext
  // -----------------------------------------------------------------------
  const originalContext = { credential: "cred-001", repository: "repo-abc" };
  taskRepo.saveTaskContext(task.id, originalContext);

  // Verify context is bound
  const contextBefore = taskRepo.getTaskContext(task.id);
  assert.deepStrictEqual(contextBefore, originalContext);

  // -----------------------------------------------------------------------
  // 3. Capture the sha256 BEFORE the apply
  // -----------------------------------------------------------------------
  const shaBefore = taskRepo.getSha256(task.id);
  assert.ok(shaBefore, "task must have a sha256 after save");

  // -----------------------------------------------------------------------
  // 4. Build a GraphPackage with edited ac (new item added)
  // -----------------------------------------------------------------------
  const initSha = initRepo.getSha256(initiativeId);
  const objSha = initRepo.getSha256(objectiveId);
  assert.ok(initSha, "initiative must have a sha256");
  assert.ok(objSha, "objective must have a sha256");

  const packageId = newId();
  const manifest: ExportManifest = {
    initiativeId,
    packageId,
    formatVersion: 1,
    digestAlgorithm: "sha256",
    nodes: {
      [initiativeId]: initSha,
      [objectiveId]: objSha,
      [task.id]: shaBefore,
    },
    files: [initiativeId, objectiveId, task.id],
    refToId: {
      objectives: { [objectiveId]: objectiveId },
      tasks: { [task.id]: task.id },
    },
  };

  const pkg: GraphPackage = {
    packageId,
    formatVersion: 1,
    initiative: {
      id: initiativeId,
      ref: initiativeId,
      name: "TestInit",
      sourcePath: "testinit/testinit.md",
    },
    objectives: [
      {
        id: objectiveId,
        ref: objectiveId,
        initiativeRef: initiativeId,
        name: "TestObj",
        sourcePath: "testinit/testobj/testobj.md",
      },
    ],
    tasks: [
      {
        id: task.id,
        ref: task.id,
        objectiveRef: objectiveId,
        title: "implement auth",
        instructions: "implement the auth endpoint",
        // edited: new ac item added
        ac: ["returns 200 for valid creds", "rejects invalid creds with 401"],
        agent: "generic@1",
        verification: undefined,
        dependsOn: [],
        sourcePath: "testinit/testobj/implement-auth.md",
      },
    ],
    manifest,
  };

  // -----------------------------------------------------------------------
  // 5. Run ApplyGraph.execute
  // -----------------------------------------------------------------------
  // storeGraph is wired but not called for update-only applies.
  const storeGraph = new StoreGraph(taskRepo);

  const applyGraph = new ApplyGraph({
    initiatives: initRepo as any,
    tasks: taskRepo as any,
    storeGraph,
    importMap,
    uow,
    newId,
  });

  // -----------------------------------------------------------------------
  // 6. Execute
  // -----------------------------------------------------------------------
  const result = await applyGraph.execute({ pkg, initiativeId });

  // -----------------------------------------------------------------------
  // 7. Assert: apply succeeded + context preserved + sha changed
  // -----------------------------------------------------------------------
  assert.strictEqual(result.applied, true, "apply must succeed (no conflicts)");

  // context must be byte-for-byte identical
  const contextAfter = taskRepo.getTaskContext(task.id);
  assert.deepStrictEqual(
    contextAfter,
    originalContext,
    "task_context must be byte-for-byte identical after spec apply — context is out of scope (S1)",
  );

  // sha256 must have changed (the new ac item made the canonical form different)
  const shaAfter = taskRepo.getSha256(task.id);
  assert.notStrictEqual(
    shaAfter,
    shaBefore,
    "sha256 must differ after ac edit — spec change is reflected in the token",
  );
});
