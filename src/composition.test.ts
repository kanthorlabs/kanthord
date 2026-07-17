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
    assert.ok("projectRepository" in deps, "deps.projectRepository present");
    assert.ok(
      "initiativeRepository" in deps,
      "deps.initiativeRepository present",
    );
    assert.ok("taskRepository" in deps, "deps.taskRepository present");
    assert.ok("referenceResolver" in deps, "deps.referenceResolver present");
    assert.ok("events" in deps, "deps.events present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
