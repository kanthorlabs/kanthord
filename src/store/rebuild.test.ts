import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { compile } from "../compiler/compile.ts";
import type { CompileOptions } from "../compiler/compile.ts";
import { projectionOf, PROJECTION_CONTRACT } from "./projection.ts";
import type { TableEntry } from "./projection.ts";
import { rebuildFromMarkdown, diffProjection } from "./rebuild.ts";
import type { Divergence } from "./rebuild.ts";

// ---------------------------------------------------------------------------
// Golden feature fixture — minimal single-story/single-task
//   feat-001
//     001-story-a  →  task-alpha (workflow: tdd@1, ## Tests → gate pair)
// ---------------------------------------------------------------------------

const EPIC_MD = `---
id: feat-001
repo: backend
deploy_chain:
  - stage: canary
    handlers:
      - service: frontend
    success_criteria: "error-rate-lt-1pct"
    soak_duration: "10m"
---

## Acceptance

Feature complete.
`;

const TASK_ALPHA_MD = `---
id: task-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-101
outputs:
  - artifact-alpha
artifacts_out:
  - id: artifact-alpha
    kind: library
    path: dist/alpha.js
---

## Prerequisites

echo "setup"

## Inputs

Nothing required.

## Outputs

- output-a

## Tests

Unit tests here.
`;

const TASK_BETA_MD = `---
id: task-beta
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-102
depends_on:
  - task: task-alpha
    output: artifact-alpha
    semantics: frozen
---

## Prerequisites

Nothing.

## Inputs

Artifact alpha output.

## Outputs

Final output.

## Tests

Integration tests.
`;

const OPTS: CompileOptions = { repoRegistry: ["backend"] };

// ---------------------------------------------------------------------------
// Helper — sort projected rows deterministically by the table's rowIdentityKey
// ---------------------------------------------------------------------------

function sortedProjection(
  rows: Record<string, unknown>[],
  entry: TableEntry,
): Record<string, unknown>[] {
  const keys = entry.rowIdentityKey;
  return [...rows].map(projectionOf).sort((a, b) => {
    for (const k of keys) {
      const av = String(a[k] ?? "");
      const bv = String(b[k] ?? "");
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/store/rebuild", () => {
  describe("rebuildFromMarkdown: shadow projection equals live projection", () => {
    let featureDir = "";
    let liveStore: Store;
    let shadowStore: Store;

    before(async () => {
      featureDir = await mkdtemp(join(tmpdir(), "kanthord-rebuild-t1-"));

      // Write golden feature (enriched: artifacts_out + depends_on + deploy_chain)
      await writeFile(join(featureDir, "epic.md"), EPIC_MD);
      await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
      const storyDir = join(featureDir, "001-story-a");
      await mkdir(storyDir);
      await writeFile(join(storyDir, "INDEX.md"), "# Story A\n");
      await writeFile(join(storyDir, "001-task-alpha.md"), TASK_ALPHA_MD);
      await writeFile(join(storyDir, "002-task-beta.md"), TASK_BETA_MD);

      // Compile into live store (temp file so WAL works)
      const liveDbPath = join(featureDir, "live.db");
      liveStore = openStore(liveDbPath, { busyTimeout: 1000 });
      await compile(featureDir, liveStore, OPTS);

      // Rebuild markdown into shadow store
      shadowStore = await rebuildFromMarkdown(featureDir, OPTS);
    });

    after(async () => {
      liveStore?.close();
      shadowStore?.close();
      if (featureDir) await rm(featureDir, { recursive: true, force: true });
    });

    test("projectionOf shadow equals projectionOf live for plan_node rows", () => {
      const entry = PROJECTION_CONTRACT.tables["plan_node"];
      if (entry === undefined) throw new Error("plan_node not in projection contract");
      const liveRows = liveStore.all<Record<string, unknown>>("SELECT * FROM plan_node");
      const shadowRows = shadowStore.all<Record<string, unknown>>("SELECT * FROM plan_node");
      assert.deepEqual(
        sortedProjection(shadowRows, entry),
        sortedProjection(liveRows, entry),
        "plan_node projected rows must match field-by-field",
      );
    });

    test("projectionOf shadow equals projectionOf live for plan_edge rows", () => {
      const entry = PROJECTION_CONTRACT.tables["plan_edge"];
      if (entry === undefined) throw new Error("plan_edge not in projection contract");
      const liveRows = liveStore.all<Record<string, unknown>>("SELECT * FROM plan_edge");
      const shadowRows = shadowStore.all<Record<string, unknown>>("SELECT * FROM plan_edge");
      assert.deepEqual(
        sortedProjection(shadowRows, entry),
        sortedProjection(liveRows, entry),
        "plan_edge projected rows must match field-by-field",
      );
    });

    test("projectionOf shadow equals projectionOf live for plan_gate rows", () => {
      const entry = PROJECTION_CONTRACT.tables["plan_gate"];
      if (entry === undefined) throw new Error("plan_gate not in projection contract");
      const liveRows = liveStore.all<Record<string, unknown>>("SELECT * FROM plan_gate");
      const shadowRows = shadowStore.all<Record<string, unknown>>("SELECT * FROM plan_gate");
      assert.deepEqual(
        sortedProjection(shadowRows, entry),
        sortedProjection(liveRows, entry),
        "plan_gate projected rows must match field-by-field",
      );
    });

    test("projectionOf shadow equals projectionOf live for plan_artifact rows", () => {
      const entry = PROJECTION_CONTRACT.tables["plan_artifact"];
      if (entry === undefined) throw new Error("plan_artifact not in projection contract");
      const liveRows = liveStore.all<Record<string, unknown>>("SELECT * FROM plan_artifact");
      const shadowRows = shadowStore.all<Record<string, unknown>>("SELECT * FROM plan_artifact");
      assert.deepEqual(
        sortedProjection(shadowRows, entry),
        sortedProjection(liveRows, entry),
        "plan_artifact projected rows must match field-by-field",
      );
    });

    test("projectionOf shadow equals projectionOf live for plan_generation rows", () => {
      const entry = PROJECTION_CONTRACT.tables["plan_generation"];
      if (entry === undefined) throw new Error("plan_generation not in projection contract");
      const liveRows = liveStore.all<Record<string, unknown>>("SELECT * FROM plan_generation");
      const shadowRows = shadowStore.all<Record<string, unknown>>(
        "SELECT * FROM plan_generation",
      );
      assert.deepEqual(
        sortedProjection(shadowRows, entry),
        sortedProjection(liveRows, entry),
        "plan_generation projected rows must match field-by-field",
      );
    });

    test("projectionOf shadow equals projectionOf live for plan_artifact_consumer rows", () => {
      const entry = PROJECTION_CONTRACT.tables["plan_artifact_consumer"];
      if (entry === undefined)
        throw new Error("plan_artifact_consumer not in projection contract");
      const liveRows = liveStore.all<Record<string, unknown>>(
        "SELECT * FROM plan_artifact_consumer",
      );
      const shadowRows = shadowStore.all<Record<string, unknown>>(
        "SELECT * FROM plan_artifact_consumer",
      );
      assert.ok(
        liveRows.length > 0,
        "live plan_artifact_consumer must have at least one row (fixture has a depends_on)",
      );
      assert.deepEqual(
        sortedProjection(shadowRows, entry),
        sortedProjection(liveRows, entry),
        "plan_artifact_consumer projected rows must match field-by-field",
      );
    });

    test("projectionOf shadow equals projectionOf live for plan_deploy_stage rows", () => {
      const entry = PROJECTION_CONTRACT.tables["plan_deploy_stage"];
      if (entry === undefined) throw new Error("plan_deploy_stage not in projection contract");
      const liveRows = liveStore.all<Record<string, unknown>>(
        "SELECT * FROM plan_deploy_stage",
      );
      const shadowRows = shadowStore.all<Record<string, unknown>>(
        "SELECT * FROM plan_deploy_stage",
      );
      assert.ok(
        liveRows.length > 0,
        "live plan_deploy_stage must have at least one row (fixture has a deploy_chain)",
      );
      assert.deepEqual(
        sortedProjection(shadowRows, entry),
        sortedProjection(liveRows, entry),
        "plan_deploy_stage projected rows must match field-by-field",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // S003-T2 — diffProjection: ignores runtime-only, catches derived drift
  // ---------------------------------------------------------------------------

  describe("diffProjection: runtime-only vs markdown-derived drift", () => {
    let featureDir2 = "";
    let liveStore2: Store;
    let shadowStore2: Store;

    before(async () => {
      featureDir2 = await mkdtemp(join(tmpdir(), "kanthord-rebuild-t2-"));

      // Write golden feature (enriched: same fixture as T1)
      await writeFile(join(featureDir2, "epic.md"), EPIC_MD);
      await writeFile(join(featureDir2, "RUNBOOK.md"), "# Runbook\n");
      const storyDir = join(featureDir2, "001-story-a");
      await mkdir(storyDir);
      await writeFile(join(storyDir, "INDEX.md"), "# Story A\n");
      await writeFile(join(storyDir, "001-task-alpha.md"), TASK_ALPHA_MD);
      await writeFile(join(storyDir, "002-task-beta.md"), TASK_BETA_MD);

      // Compile into live store (temp file so WAL works)
      const liveDbPath = join(featureDir2, "live.db");
      liveStore2 = openStore(liveDbPath, { busyTimeout: 1000 });
      await compile(featureDir2, liveStore2, OPTS);

      // Rebuild shadow store
      shadowStore2 = await rebuildFromMarkdown(featureDir2, OPTS);
    });

    after(async () => {
      liveStore2?.close();
      shadowStore2?.close();
      if (featureDir2) await rm(featureDir2, { recursive: true, force: true });
    });

    test("diffProjection: lease_holder mutation (runtime-only) does not cause divergence", () => {
      // Add a runtime-only column that is not in markdown; assign a lease holder.
      // projectionOf strips lease_holder (it is in PROJECTION_CONTRACT.runtimeOnly),
      // so diffProjection must return an empty list.
      liveStore2.run("ALTER TABLE plan_node ADD COLUMN lease_holder TEXT");
      liveStore2.run("UPDATE plan_node SET lease_holder = 'daemon-1' WHERE kind = 'task'");

      const diffs = diffProjection(liveStore2, shadowStore2);
      assert.deepEqual(
        diffs,
        [],
        "lease_holder mutation (runtime-only) must not cause a projection divergence",
      );
    });

    test("diffProjection: ticket_ref corruption (markdown-derived) causes divergence naming the field", () => {
      // Corrupt a markdown-derived column in the live store without touching markdown.
      // diffProjection must detect the discrepancy and name the field.
      liveStore2.run("UPDATE plan_node SET ticket_ref = 'CORRUPTED' WHERE kind = 'task'");

      const diffs = diffProjection(liveStore2, shadowStore2);
      assert.ok(diffs.length > 0, "corrupting ticket_ref must produce at least one divergence");
      const fieldNames = diffs.map((d: Divergence) => d.field);
      assert.ok(
        fieldNames.includes("ticket_ref"),
        `divergence must name 'ticket_ref'; got: ${JSON.stringify(fieldNames)}`,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // S3 regression — diffProjection must be bidirectional (HUMAN_REVIEW BLOCKER)
  // ---------------------------------------------------------------------------

  describe("diffProjection: bidirectional — shadow-only row divergence", () => {
    let featureDir3 = "";
    let liveStore3: Store;
    let shadowStore3: Store;

    before(async () => {
      featureDir3 = await mkdtemp(join(tmpdir(), "kanthord-rebuild-s3-"));

      // Same golden fixture as the T1/T2 suites
      await writeFile(join(featureDir3, "epic.md"), EPIC_MD);
      await writeFile(join(featureDir3, "RUNBOOK.md"), "# Runbook\n");
      const storyDir = join(featureDir3, "001-story-a");
      await mkdir(storyDir);
      await writeFile(join(storyDir, "INDEX.md"), "# Story A\n");
      await writeFile(join(storyDir, "001-task-alpha.md"), TASK_ALPHA_MD);
      await writeFile(join(storyDir, "002-task-beta.md"), TASK_BETA_MD);

      // Compile into live store (temp file so WAL works)
      const liveDbPath = join(featureDir3, "live.db");
      liveStore3 = openStore(liveDbPath, { busyTimeout: 1000 });
      await compile(featureDir3, liveStore3, OPTS);

      // Rebuild shadow store — at this point it equals the live projection
      shadowStore3 = await rebuildFromMarkdown(featureDir3, OPTS);
    });

    after(async () => {
      liveStore3?.close();
      shadowStore3?.close();
      if (featureDir3) await rm(featureDir3, { recursive: true, force: true });
    });

    test("diffProjection: shadow-only row is reported as divergence (no live counterpart)", () => {
      // Sanity: shadow has the task-alpha plan_node row
      const shadowTaskRows = shadowStore3.all<Record<string, unknown>>(
        "SELECT * FROM plan_node WHERE id = 'task-alpha'",
      );
      assert.equal(shadowTaskRows.length, 1, "shadow must have a task-alpha plan_node row");

      // Delete task-alpha from live only — shadow still holds it, creating a
      // shadow-only identity key.  diffProjection iterates live rows and maps
      // shadow rows by key; it never scans for shadow-map entries with no live
      // counterpart, so currently returns [] (the bug).  This test asserts the
      // correct bidirectional behaviour: the shadow-only row must be reported.
      liveStore3.run("DELETE FROM plan_node WHERE id = 'task-alpha'");

      const liveTaskRows = liveStore3.all<Record<string, unknown>>(
        "SELECT * FROM plan_node WHERE id = 'task-alpha'",
      );
      assert.equal(liveTaskRows.length, 0, "live must not have task-alpha after deletion");

      const diffs = diffProjection(liveStore3, shadowStore3);
      assert.ok(
        diffs.length > 0,
        "shadow-only plan_node row (deleted from live) must produce at least one divergence",
      );
      const tables = diffs.map((d: Divergence) => d.table);
      assert.ok(
        tables.includes("plan_node"),
        `divergence must reference table 'plan_node'; got: ${JSON.stringify(tables)}`,
      );
    });
  });
});
