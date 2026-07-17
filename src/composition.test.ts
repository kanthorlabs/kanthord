import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDeps } from "./composition.ts";

test("buildDeps returns a RouterDeps bundle with all registered capabilities", () => {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-test-"));
  const dbPath = join(dir, "kanthord.db");
  try {
    const deps = buildDeps(dbPath);
    assert.ok(
      typeof deps === "object" && deps !== null,
      "buildDeps returns an object",
    );
    assert.ok("migrateDb" in deps, "deps.migrateDb present");
    assert.ok("getDbStatus" in deps, "deps.getDbStatus present");
    assert.ok("createProject" in deps, "deps.createProject present");
    assert.ok("renameProject" in deps, "deps.renameProject present");
    assert.ok("getProject" in deps, "deps.getProject present");
    assert.ok("findProject" in deps, "deps.findProject present");
    assert.ok("createInitiative" in deps, "deps.createInitiative present");
    assert.ok("renameInitiative" in deps, "deps.renameInitiative present");
    assert.ok("findInitiative" in deps, "deps.findInitiative present");
    assert.ok("createObjective" in deps, "deps.createObjective present");
    assert.ok("renameObjective" in deps, "deps.renameObjective present");
    assert.ok("findObjective" in deps, "deps.findObjective present");
    assert.ok("addResource" in deps, "deps.addResource present");
    assert.ok("findResource" in deps, "deps.findResource present");
    assert.ok("createTask" in deps, "deps.createTask present");
    assert.ok("addDependency" in deps, "deps.addDependency present");
    assert.ok("removeDependency" in deps, "deps.removeDependency present");
    assert.ok("listTasks" in deps, "deps.listTasks present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
