import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PROJECTION_CONTRACT_VERSION, PROJECTION_CONTRACT, projectionOf } from "../store/projection.ts";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { FeatureStore } from "../store/feature-store.ts";
import { writeLedgerEntry } from "./ledger.ts";
import { diffProjection, rebuildFromMarkdown } from "../store/rebuild.ts";
import type { CompileOptions } from "../compiler/compile.ts";

// ---------------------------------------------------------------------------
// Minimal compiled-plan fixture for the T2 rebuildFromMarkdown integration.
// rebuildFromMarkdown also runs buildCorePlan; these stubs satisfy its parser.
// ---------------------------------------------------------------------------

const MINIMAL_EPIC_MD = `---
id: feat-broker-ledger
repo: backend
---

## Acceptance

Broker ledger rebuild test feature.
`;

const MINIMAL_TASK_MD = `---
id: task-t2-placeholder
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-T2-001
---

## Prerequisites

None.

## Inputs

None.

## Outputs

None.

## Tests

None — placeholder to satisfy buildCorePlan.
`;

const REBUILD_OPTS: CompileOptions = { repoRegistry: ["backend"] };

describe("src/store/projection.ts + src/store/rebuild.ts — ledger projection & rebuild contract", () => {
  // -------------------------------------------------------------------------
  // T1a — version bump
  // -------------------------------------------------------------------------
  test('PROJECTION_CONTRACT_VERSION is bumped to "2"', () => {
    assert.equal(PROJECTION_CONTRACT_VERSION, "2");
  });

  // -------------------------------------------------------------------------
  // T1b — op_ledger table added with all six §5 identity fields markdown-derived
  // -------------------------------------------------------------------------
  test("bumped contract adds op_ledger table with all six ledger identity fields classified markdown-derived", () => {
    const scope = PROJECTION_CONTRACT.tableScope;
    assert.ok(Array.isArray(scope), "tableScope is an array");
    assert.ok(scope.includes("op_ledger"), "op_ledger is in tableScope");

    const opLedger = PROJECTION_CONTRACT.tables["op_ledger"];
    assert.ok(opLedger !== undefined, "op_ledger table entry exists in contract tables");

    const cols = opLedger.columns;
    for (const field of [
      "op_id",
      "verb",
      "idempotency_key",
      "correlation",
      "desired_effect_hash",
      "status",
    ]) {
      const col = cols[field];
      assert.ok(col !== undefined, `op_ledger.${field} has a classification`);
      assert.ok("derived" in col, `op_ledger.${field} is classified markdown-derived`);
      assert.ok(
        typeof (col as { derived: string }).derived === "string" &&
          (col as { derived: string }).derived.length > 0,
        `op_ledger.${field} has a non-empty named source`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // T1c — request_id runtime-only; op_id no longer cross-table runtime-only
  // -------------------------------------------------------------------------
  test("request_id is classified runtime-only and op_id is removed from the cross-table runtimeOnly list", () => {
    const ro = PROJECTION_CONTRACT.runtimeOnly;
    assert.ok(Array.isArray(ro), "runtimeOnly is an array");
    assert.ok(ro.includes("request_id"), "request_id is in the runtime-only set");
    assert.ok(
      !ro.includes("op_id"),
      "op_id is no longer in the cross-table runtimeOnly set (it is now a markdown-derived ledger field)",
    );
  });

  // -------------------------------------------------------------------------
  // T2 — Ledger rebuild-equivalence + drift detection
  // Re-pointed at the CANONICAL rebuildFromMarkdown (BLOCKER B1).
  // RED: rebuildFromMarkdown does not yet accept ledgerSources and does not
  // reconstruct op_ledger rows — T2a will fail with
  // "ERR_SQLITE_ERROR: no such table: op_ledger".
  // -------------------------------------------------------------------------

  describe("T2 — Ledger rebuild-equivalence + drift detection", () => {
    let featureDir5 = "";
    let liveStore5: Store;
    let shadowStore5: Store;

    const STORY_ID = "001-story-a";
    const TASK_STEM = "task-t2";
    const OP_ID = "op-ledger-T2-001";
    const DESIRED_HASH = "sha256-desired-T2-001";

    before(async () => {
      featureDir5 = await mkdtemp(join(tmpdir(), "kanthord-ledger-proj-t2-"));

      // Create a minimal compiled-plan structure so rebuildFromMarkdown can
      // run its compiled-plan path without error; the ledger assertions only
      // verify op_ledger reconstruction from the task journal.
      await writeFile(join(featureDir5, "epic.md"), MINIMAL_EPIC_MD);
      await writeFile(join(featureDir5, "RUNBOOK.md"), "# Runbook\n");
      const storyDir = join(featureDir5, STORY_ID);
      await mkdir(storyDir, { recursive: true });
      await writeFile(join(storyDir, "INDEX.md"), "# Story A\n");
      await writeFile(join(storyDir, "001-task-placeholder.md"), MINIMAL_TASK_MD);

      // Write a ledger entry to the task's journal (source of truth for rebuild).
      const featureStore = new FeatureStore(featureDir5);
      await writeLedgerEntry(featureStore, STORY_ID, TASK_STEM, {
        op_id: OP_ID,
        verb: "deploy_service",
        idempotency_key: "idem-T2-rebuild-001",
        correlation: "corr-T2-rebuild-001",
        desired_effect_hash: DESIRED_HASH,
        status: "done",
      });

      // Live store: op_ledger table with one row (simulates broker runtime state).
      liveStore5 = openStore(":memory:", { busyTimeout: 1000 });
      liveStore5.run(
        "CREATE TABLE IF NOT EXISTS op_ledger " +
          "(op_id TEXT PRIMARY KEY, verb TEXT, idempotency_key TEXT, " +
          "correlation TEXT, desired_effect_hash TEXT, status TEXT)",
      );
      liveStore5.run(
        "INSERT INTO op_ledger VALUES (?, ?, ?, ?, ?, ?)",
        OP_ID,
        "deploy_service",
        "idem-T2-rebuild-001",
        "corr-T2-rebuild-001",
        DESIRED_HASH,
        "done",
      );

      // Shadow: rebuilt from markdown via the CANONICAL rebuildFromMarkdown.
      // The 3rd argument (ledgerSources) tells rebuildFromMarkdown which task
      // journals to read for op_ledger reconstruction.
      // RED: rebuildFromMarkdown does not yet accept this parameter — the
      // shadow will have no op_ledger table and T2a will fail.
      shadowStore5 = await rebuildFromMarkdown(featureDir5, REBUILD_OPTS, [
        { storyId: STORY_ID, taskStem: TASK_STEM },
      ]);
    });

    after(async () => {
      liveStore5?.close();
      shadowStore5?.close();
      if (featureDir5) await rm(featureDir5, { recursive: true, force: true });
    });

    test("rebuildFromMarkdown reconstructs op_ledger rows from markdown — shadow projection equals live projection", () => {
      const opLedgerEntry = PROJECTION_CONTRACT.tables["op_ledger"];
      if (opLedgerEntry === undefined) throw new Error("op_ledger not in projection contract");

      const liveRows = liveStore5.all<Record<string, unknown>>("SELECT * FROM op_ledger");
      const shadowRows = shadowStore5.all<Record<string, unknown>>("SELECT * FROM op_ledger");

      assert.equal(liveRows.length, 1, "live op_ledger must have one row");
      assert.equal(shadowRows.length, 1, "shadow op_ledger must have one row (rebuilt from markdown)");

      const liveProjected = liveRows.map(projectionOf);
      const shadowProjected = shadowRows.map(projectionOf);
      assert.deepEqual(
        shadowProjected,
        liveProjected,
        "shadow op_ledger projection must equal live op_ledger projection field-by-field",
      );
    });

    test("live-only request_id column does not cause op_ledger projection divergence", () => {
      // Add runtime-only request_id to live store (never in markdown — excluded by runtimeOnly)
      liveStore5.run("ALTER TABLE op_ledger ADD COLUMN request_id TEXT");
      liveStore5.run(
        "UPDATE op_ledger SET request_id = 'req-T2-live-001' WHERE op_id = ?",
        OP_ID,
      );

      const diffs = diffProjection(liveStore5, shadowStore5);
      const ledgerDiffs = diffs.filter((d) => d.table === "op_ledger");
      assert.deepEqual(
        ledgerDiffs,
        [],
        "live-only request_id must not cause op_ledger projection divergence",
      );
    });

    test("corrupting a markdown-derived ledger field in live op_ledger is reported by diffProjection", () => {
      // Corrupt verb in live op_ledger (verb is markdown-derived — must be detected)
      liveStore5.run("UPDATE op_ledger SET verb = 'CORRUPTED_VERB' WHERE op_id = ?", OP_ID);

      const diffs = diffProjection(liveStore5, shadowStore5);
      const ledgerDiffs = diffs.filter((d) => d.table === "op_ledger");
      assert.ok(
        ledgerDiffs.length > 0,
        "corrupting verb must produce at least one op_ledger divergence",
      );
      const fieldNames = ledgerDiffs.map((d) => d.field);
      assert.ok(
        fieldNames.includes("verb"),
        `divergence must name 'verb'; got: ${JSON.stringify(fieldNames)}`,
      );
    });
  });
});
