import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDatabase } from "../../storage/sqlite/open.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { SqliteProjectRepository } from "../../storage/sqlite/sqlite-project-repository.ts";
import { SqliteInitiativeRepository } from "../../storage/sqlite/sqlite-initiative-repository.ts";
import { SqliteTaskRepository } from "../../storage/sqlite/sqlite-task-repository.ts";
import { newProject } from "../../domain/project.ts";
import { newInitiative, newObjective } from "../../domain/initiative.ts";
import { StoreGraph } from "./store-graph.ts";
import { CheckStoredGraph } from "./check-stored-graph.ts";

function openTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-roundtrip-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);
  return { db, dir };
}

test("StoreGraph → CheckStoredGraph: both roots ready, deploy blocked on api ULID", async () => {
  const { db, dir } = openTempDb();
  try {
    // Build project → initiative → objective via real repos
    const projectRepo = new SqliteProjectRepository(db);
    const initiativeRepo = new SqliteInitiativeRepository(db);
    const taskRepo = new SqliteTaskRepository(db);

    const project = newProject("my-project");
    projectRepo.save(project);

    const initiative = newInitiative(project.id, "my-initiative");
    initiativeRepo.save(initiative);

    const objective = newObjective(initiative.id, "my-objective");
    initiativeRepo.saveObjective(objective);

    // Run StoreGraph with the EPIC 002 demo fixture shape:
    //   api: no deps (root 1)
    //   deploy: depends on api
    //   monitor: no deps (second independent root)
    const storeGraph = new StoreGraph(taskRepo);
    const storedTasks = await storeGraph.execute({
      objectiveId: objective.id,
      tasks: [
        { id: "api", title: "implement api", dependencies: [] },
        { id: "deploy", title: "deploy", dependencies: ["api"] },
        { id: "monitor", title: "monitor", dependencies: [] },
      ],
    });

    assert.equal(storedTasks.length, 3, "StoreGraph must return 3 tasks");
    const [apiTask, deployTask, monitorTask] = storedTasks;
    assert.ok(apiTask, "apiTask must be defined");
    assert.ok(deployTask, "deployTask must be defined");
    assert.ok(monitorTask, "monitorTask must be defined");

    // (a) CheckStoredGraph report: both roots ready, deploy blocked on api's ULID
    const checkGraph = new CheckStoredGraph(taskRepo);
    const report = await checkGraph.execute({ initiativeId: initiative.id });

    // All three tasks are pending → all three appear in the report
    assert.equal(report.length, 3, "report must have 3 entries (all pending)");

    const byId = new Map(report.map((e) => [e.id, e]));

    const apiEntry = byId.get(apiTask.id);
    assert.ok(apiEntry, "api entry must appear in report");
    assert.equal(apiEntry.state, "ready", "api task must be ready (no deps)");
    assert.deepEqual(apiEntry.waiting, [], "api task has no waiting deps");

    const monitorEntry = byId.get(monitorTask.id);
    assert.ok(monitorEntry, "monitor entry must appear in report");
    assert.equal(
      monitorEntry.state,
      "ready",
      "monitor task must be ready (no deps)",
    );
    assert.deepEqual(
      monitorEntry.waiting,
      [],
      "monitor task has no waiting deps",
    );

    const deployEntry = byId.get(deployTask.id);
    assert.ok(deployEntry, "deploy entry must appear in report");
    assert.equal(deployEntry.state, "blocked", "deploy task must be blocked");
    assert.deepEqual(
      deployEntry.waiting,
      [apiTask.id],
      "deploy must be waiting on api's real ULID",
    );

    // (b) Round-trip proof: each task reloaded via get() deep-equals the StoreGraph return value
    for (const stored of storedTasks) {
      const loaded = taskRepo.get(stored.id);
      assert.ok(loaded, `task ${stored.id} must be loadable via get()`);
      assert.deepEqual(
        loaded,
        stored,
        `task ${stored.id} round-trip: get() must deep-equal the StoreGraph return value`,
      );
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("StoreGraph → CheckStoredGraph: two tasks stored, loaded task has deps in declared order", async () => {
  const { db, dir } = openTempDb();
  try {
    const projectRepo = new SqliteProjectRepository(db);
    const initiativeRepo = new SqliteInitiativeRepository(db);
    const taskRepo = new SqliteTaskRepository(db);

    const project = newProject("dep-order-project");
    projectRepo.save(project);
    const initiative = newInitiative(project.id, "dep-order-initiative");
    initiativeRepo.save(initiative);
    const objective = newObjective(initiative.id, "dep-order-objective");
    initiativeRepo.saveObjective(objective);

    const storeGraph = new StoreGraph(taskRepo);
    const storedTasks = await storeGraph.execute({
      objectiveId: objective.id,
      tasks: [
        { id: "a", dependencies: [] },
        { id: "b", dependencies: [] },
        { id: "c", dependencies: ["a", "b"] },
      ],
    });

    assert.equal(storedTasks.length, 3);
    const [taskA, taskB, taskC] = storedTasks;
    assert.ok(taskA && taskB && taskC);

    // c must depend on a then b in declared order
    assert.deepEqual(taskC.dependencies, [taskA.id, taskB.id]);

    // Round-trip: get() matches exactly
    const loadedC = taskRepo.get(taskC.id);
    assert.ok(loadedC);
    assert.deepEqual(loadedC.dependencies, [taskA.id, taskB.id]);
    assert.deepEqual(loadedC, taskC);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
