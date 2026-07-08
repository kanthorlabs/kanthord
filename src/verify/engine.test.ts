/**
 * src/verify/engine.test.ts
 *
 * Story 018-001 Tasks T1 + T2 — RED tests for the verify engine.
 *
 * T1: The engine rebuilds a shadow store, diffs live vs shadow per the
 * PROJECTION_CONTRACT, and returns a typed VerifyReport.
 * Tests: (a) clean golden ⇒ empty; (b) mutated ticket_ref ⇒ entry with
 * entity/field/live/shadow; (c) mutated lease_holder (runtime-only) ⇒ empty;
 * (d) divergent op_ledger row ⇒ reported.
 *
 * T2: The engine asserts the projection-contract version it was built for
 * against the store's stamped version; a mismatch is a typed
 * ContractVersionMismatchError naming both versions, and no diff is attempted.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { compile } from "../compiler/compile.ts";
import type { CompileOptions } from "../compiler/compile.ts";
import { runVerify } from "./engine.ts";
import type { VerifyReport, VerifyDivergence, ContractVersionMismatchError } from "./engine.ts";
import { PROJECTION_CONTRACT_VERSION, PROJECTION_CONTRACT } from "../store/projection.ts";
import { diffProjection } from "../store/rebuild.ts";

// ---------------------------------------------------------------------------
// Minimal golden feature fixture (single story, two tasks)
// ---------------------------------------------------------------------------

const OPTS: CompileOptions = { includeDraftLanes: false };

const EPIC_MD = `---
id: feat-018
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
id: task-018-alpha
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-018
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
id: task-018-beta
workflow: tdd@1
repo: backend
ticket_system: jira
ticket: JIRA-019
---

## Prerequisites

echo "setup"

## Inputs

Nothing required.

## Outputs

- output-b

## Tests

Integration tests.
`;

// ---------------------------------------------------------------------------
// Suite (a) — clean golden feature yields an empty divergence list
// ---------------------------------------------------------------------------

describe("src/verify/engine — clean golden feature", () => {
  let featureDir = "";
  let liveStore: Store;

  before(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-verify-engine-a-"));
    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    const storyDir = join(featureDir, "001-story-018");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story 018\n");
    await writeFile(join(storyDir, "001-task-018-alpha.md"), TASK_ALPHA_MD);
    await writeFile(join(storyDir, "002-task-018-beta.md"), TASK_BETA_MD);

    const liveDbPath = join(featureDir, "live.db");
    liveStore = openStore(liveDbPath, { busyTimeout: 1000 });
    await compile(featureDir, liveStore, OPTS);
  });

  after(async () => {
    liveStore?.close();
    if (featureDir) await rm(featureDir, { recursive: true, force: true });
  });

  test("clean golden feature yields an empty divergence list", async () => {
    const report: VerifyReport = await runVerify(featureDir, liveStore, OPTS);
    assert.equal(report.divergences.length, 0, "clean feature must yield zero divergences");
  });
});

// ---------------------------------------------------------------------------
// Suite (b) — mutated markdown-derived field yields one divergence entry
// ---------------------------------------------------------------------------

describe("src/verify/engine — mutated markdown-derived field (ticket_ref)", () => {
  let featureDir = "";
  let liveStore: Store;

  before(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-verify-engine-b-"));
    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    const storyDir = join(featureDir, "001-story-018");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story 018\n");
    await writeFile(join(storyDir, "001-task-018-alpha.md"), TASK_ALPHA_MD);
    await writeFile(join(storyDir, "002-task-018-beta.md"), TASK_BETA_MD);

    const liveDbPath = join(featureDir, "live.db");
    liveStore = openStore(liveDbPath, { busyTimeout: 1000 });
    await compile(featureDir, liveStore, OPTS);

    // Corrupt ticket_ref directly in the live DB (markdown-derived field, not in markdown)
    liveStore.run(
      "UPDATE plan_node SET ticket_ref = 'MUTATED-018' WHERE id = 'task-018-alpha'",
    );
  });

  after(async () => {
    liveStore?.close();
    if (featureDir) await rm(featureDir, { recursive: true, force: true });
  });

  test("mutated ticket_ref yields at least one divergence entry", async () => {
    const report: VerifyReport = await runVerify(featureDir, liveStore, OPTS);
    assert.ok(report.divergences.length > 0, "mutated ticket_ref must produce divergences");
  });

  test("divergence entry names the entity id, field, live value, and shadow value", async () => {
    const report: VerifyReport = await runVerify(featureDir, liveStore, OPTS);
    const d = report.divergences.find(
      (e: VerifyDivergence) => e.field === "ticket_ref",
    );
    assert.ok(d !== undefined, "divergence for 'ticket_ref' field must be present");
    assert.equal(d.live, "MUTATED-018", "live value must reflect the direct SQLite mutation");
    assert.equal(d.shadow, "JIRA-018", "shadow value must reflect the markdown-derived value");
  });
});

// ---------------------------------------------------------------------------
// Suite (c) — mutated runtime-only field (lease_holder) yields no divergences
// ---------------------------------------------------------------------------

describe("src/verify/engine — mutated runtime-only field (lease_holder)", () => {
  let featureDir = "";
  let liveStore: Store;

  before(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-verify-engine-c-"));
    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    const storyDir = join(featureDir, "001-story-018");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story 018\n");
    await writeFile(join(storyDir, "001-task-018-alpha.md"), TASK_ALPHA_MD);
    await writeFile(join(storyDir, "002-task-018-beta.md"), TASK_BETA_MD);

    const liveDbPath = join(featureDir, "live.db");
    liveStore = openStore(liveDbPath, { busyTimeout: 1000 });
    await compile(featureDir, liveStore, OPTS);

    // Add and populate a runtime-only column not in markdown
    liveStore.run("ALTER TABLE plan_node ADD COLUMN lease_holder TEXT");
    liveStore.run(
      "UPDATE plan_node SET lease_holder = 'daemon-018' WHERE id = 'task-018-alpha'",
    );
  });

  after(async () => {
    liveStore?.close();
    if (featureDir) await rm(featureDir, { recursive: true, force: true });
  });

  test("mutated lease_holder (runtime-only) yields zero divergences", async () => {
    const report: VerifyReport = await runVerify(featureDir, liveStore, OPTS);
    assert.equal(
      report.divergences.length,
      0,
      "lease_holder mutation must not produce any divergences (contract exclusion)",
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (d) — divergent op_ledger row is reported (Epic 005 Story 006 scope)
// ---------------------------------------------------------------------------

describe("src/verify/engine — divergent op_ledger row", () => {
  let featureDir = "";
  let liveStore: Store;

  before(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-verify-engine-d-"));
    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    const storyDir = join(featureDir, "001-story-018");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story 018\n");
    await writeFile(join(storyDir, "001-task-018-alpha.md"), TASK_ALPHA_MD);
    await writeFile(join(storyDir, "002-task-018-beta.md"), TASK_BETA_MD);

    const liveDbPath = join(featureDir, "live.db");
    liveStore = openStore(liveDbPath, { busyTimeout: 1000 });
    await compile(featureDir, liveStore, OPTS);

    // Create op_ledger in the live store and insert a row that has no markdown
    // counterpart — this simulates a live ledger row that was never flushed to
    // the task journal (i.e., the shadow rebuild will not find it).
    liveStore.run(
      "CREATE TABLE IF NOT EXISTS op_ledger " +
        "(op_id TEXT PRIMARY KEY, verb TEXT, idempotency_key TEXT, " +
        "correlation TEXT, desired_effect_hash TEXT, status TEXT)",
    );
    liveStore.run(
      "INSERT INTO op_ledger " +
        "(op_id, verb, idempotency_key, correlation, desired_effect_hash, status) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
      "op-018-test-id",
      "deploy",
      "idem-018",
      "corr-018",
      "hash-018",
      "done",
    );
  });

  after(async () => {
    liveStore?.close();
    if (featureDir) await rm(featureDir, { recursive: true, force: true });
  });

  test("live-only op_ledger row yields at least one divergence", async () => {
    const report: VerifyReport = await runVerify(featureDir, liveStore, OPTS);
    assert.ok(
      report.divergences.length > 0,
      "live-only op_ledger row must produce at least one divergence",
    );
  });

  test("op_ledger divergence entry references the op_ledger table", async () => {
    const report: VerifyReport = await runVerify(featureDir, liveStore, OPTS);
    const tables = report.divergences.map((d: VerifyDivergence) => d.table);
    assert.ok(
      tables.includes("op_ledger"),
      `divergence must reference table 'op_ledger'; got: ${JSON.stringify(tables)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite (e) — contract-version mismatch yields a typed error, not a diff
// ---------------------------------------------------------------------------

describe("src/verify/engine — contract-version mismatch", () => {
  let featureDir = "";
  let liveStore: Store;

  before(async () => {
    featureDir = await mkdtemp(join(tmpdir(), "kanthord-verify-engine-e-"));
    await writeFile(join(featureDir, "epic.md"), EPIC_MD);
    await writeFile(join(featureDir, "RUNBOOK.md"), "# Runbook\n");
    const storyDir = join(featureDir, "001-story-018");
    await mkdir(storyDir);
    await writeFile(join(storyDir, "INDEX.md"), "# Story 018\n");
    await writeFile(join(storyDir, "001-task-018-alpha.md"), TASK_ALPHA_MD);
    await writeFile(join(storyDir, "002-task-018-beta.md"), TASK_BETA_MD);

    const liveDbPath = join(featureDir, "live.db");
    liveStore = openStore(liveDbPath, { busyTimeout: 1000 });
    await compile(featureDir, liveStore, OPTS);

    // Stamp the live store with a stale contract version to simulate mismatch.
    // The engine reads this and must reject with ContractVersionMismatchError
    // before attempting a diff.
    liveStore.run(
      "CREATE TABLE IF NOT EXISTS _contract_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    liveStore.run(
      "INSERT INTO _contract_meta (key, value) VALUES ('contract_version', 'stale-version-0') " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
  });

  after(async () => {
    liveStore?.close();
    if (featureDir) await rm(featureDir, { recursive: true, force: true });
  });

  test("version mismatch throws ContractVersionMismatchError", async () => {
    await assert.rejects(
      () => runVerify(featureDir, liveStore, OPTS),
      (err: unknown) => {
        assert.ok(err instanceof Error, "error must be an Error instance");
        assert.equal(
          (err as ContractVersionMismatchError).code,
          "contract-version-mismatch",
          "error.code must be 'contract-version-mismatch'",
        );
        return true;
      },
    );
  });

  test("version mismatch error names both the live version and the engine version", async () => {
    try {
      await runVerify(featureDir, liveStore, OPTS);
      assert.fail("runVerify must throw on version mismatch");
    } catch (err: unknown) {
      assert.ok(err instanceof Error, "error must be an Error instance");
      const e = err as ContractVersionMismatchError;
      assert.equal(e.liveVersion, "stale-version-0", "liveVersion must reflect the store's stamped value");
      assert.equal(e.engineVersion, PROJECTION_CONTRACT_VERSION, "engineVersion must be the built-in contract version");
    }
  });

  test("version mismatch — no divergences array in the thrown error (diff not attempted)", async () => {
    try {
      await runVerify(featureDir, liveStore, OPTS);
      assert.fail("runVerify must throw on version mismatch");
    } catch (err: unknown) {
      // Ensure the error is the mismatch error (not a VerifyReport being returned)
      assert.ok(err instanceof Error, "thrown value must be an Error");
      assert.equal(
        (err as ContractVersionMismatchError).code,
        "contract-version-mismatch",
        "thrown error must be a ContractVersionMismatchError, not a partial report",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Suite (f.pre) — B2: version guard must not swallow unexpected live DB errors
// ---------------------------------------------------------------------------
//
// Reviewer blocker B2: the bare `catch {}` in runVerify's version-check guard
// swallows every error thrown by `live.get(...)`, including a locked/closed/
// corrupt DB.  Only a missing-table error (SQLITE_ERROR 'no such table') is a
// legitimate "no version stamped" sentinel; all other errors must propagate.
//
// Test seam: inject a Store whose `get()` throws an arbitrary non-table-not-found
// error and assert runVerify rejects with that same error (not exits 0 silently).

describe("src/verify/engine — version guard must rethrow unexpected live DB errors (B2)", () => {
  test("runVerify rejects when live.get throws an error that is not 'no such table'", async () => {
    const SENTINEL_ERROR = new Error("SQLITE_BUSY: database is locked");
    // Inject a minimal Store stub whose get() always throws the sentinel.
    const brokenLive: Store = {
      get<T>(_sql: string, ..._params: unknown[]): T | undefined {
        throw SENTINEL_ERROR;
      },
      run(_sql: string, ..._params: unknown[]): void {},
      all<T>(_sql: string, ..._params: unknown[]): T[] { return []; },
      close(): void {},
    };

    // runVerify must NOT return cleanly — the live DB error must propagate.
    await assert.rejects(
      () => runVerify("/irrelevant-dir", brokenLive, OPTS),
      (err: unknown) => {
        assert.strictEqual(
          err,
          SENTINEL_ERROR,
          "runVerify must rethrow the live DB error, not swallow it",
        );
        return true;
      },
      "runVerify must reject when live.get() throws a non-table-not-found error",
    );
  });

  test("runVerify treats 'no such table' error as absent metadata and proceeds to rebuild", async () => {
    // A store that throws the SQLite no-such-table message is the legitimate
    // 'absent _contract_meta' path; runVerify should NOT throw here.
    // We cannot easily assert it completes (featureDir is irrelevant), but we
    // can assert it does NOT throw the sentinel error itself.
    const noSuchTableError = new Error("no such table: _contract_meta");
    let rebuildAttempted = false;
    const missingTableLive: Store = {
      get<T>(_sql: string, ..._params: unknown[]): T | undefined {
        throw noSuchTableError;
      },
      run(_sql: string, ..._params: unknown[]): void {},
      all<T>(_sql: string, ..._params: unknown[]): T[] { return []; },
      close(): void {},
    };

    // The call will fail during rebuildFromMarkdown (invalid featureDir) rather
    // than at the version-check guard. The important thing: it must NOT reject
    // with `noSuchTableError` — meaning the guard let the no-such-table case through.
    try {
      await runVerify("/irrelevant-dir-for-b2", missingTableLive, OPTS);
    } catch (err: unknown) {
      // Must not be the no-such-table sentinel — if it is, the guard is re-throwing it.
      assert.notStrictEqual(
        err,
        noSuchTableError,
        "runVerify must treat 'no such table' as absent metadata, not rethrow it",
      );
      rebuildAttempted = true;
    }
    // If no error at all (unexpected), rebuildAttempted stays false — that's fine
    // too, though unlikely for an invalid featureDir.
    // The test's value is the notStrictEqual assertion above.
    void rebuildAttempted;
  });
});

// ---------------------------------------------------------------------------
// Suite (f) — contract field coverage: diff enumerates exactly the contract's
// field list for ALL tables in PROJECTION_CONTRACT.tableScope
// (B3/B2 — stale enumeration cannot pass silently for any table)
// ---------------------------------------------------------------------------

describe("src/verify/engine — contract field coverage (all tableScope tables)", () => {
  /**
   * Derives the set of markdown-derived (non-runtimeOnly) column names from
   * the PROJECTION_CONTRACT for a given table. These are the only fields the
   * diff must inspect; inspecting extras or missing any is a contract violation.
   */
  function contractDerivedFields(table: string): Set<string> {
    const entry = PROJECTION_CONTRACT.tables[table];
    assert.ok(entry !== undefined, `table '${table}' must exist in PROJECTION_CONTRACT`);
    const runtimeOnly = new Set(PROJECTION_CONTRACT.runtimeOnly);
    const derived = new Set<string>();
    for (const [col, classification] of Object.entries(entry.columns)) {
      if (!("runtimeOnly" in classification) && !runtimeOnly.has(col)) {
        derived.add(col);
      }
    }
    return derived;
  }

  /**
   * For each table in PROJECTION_CONTRACT.tableScope, verify that diffProjection
   * enumerates exactly the contract's derived field list — no extras (runtime-only
   * excluded), no omissions (every derived field reported when live ≠ shadow).
   *
   * Strategy: insert one row in the live store with all columns = "live-val";
   * leave the shadow store empty for this table (shadow has no matching row).
   * diffProjection takes the "live row present, shadow absent" path and reports
   * ALL projected (derived) fields for the live row. This verifies every derived
   * field is included and no runtime-only field leaks through.
   *
   * This is the B2/B3 coverage gate: a stale contract field list under an unchanged
   * version is caught because the test compares diff output against the live contract
   * enumeration, not against a hardcoded list.
   */
  for (const table of PROJECTION_CONTRACT.tableScope) {
    test(`diffProjection for ${table} enumerates exactly the contract's derived field list`, () => {
      const entry = PROJECTION_CONTRACT.tables[table];
      assert.ok(entry !== undefined, `PROJECTION_CONTRACT.tables must contain entry for '${table}'`);

      // Collect all column names declared in the contract for this table.
      const contractCols = Object.keys(entry.columns);

      const liveDb = openStore(":memory:", { busyTimeout: 100 });
      const shadowDb = openStore(":memory:", { busyTimeout: 100 });

      // Create the table in live with all contract-declared columns.
      // Shadow store intentionally has no table for this name, so diffProjection
      // treats the shadow as having 0 rows and reports all projected live fields.
      const colDefs = contractCols.map((c) => `${c} TEXT`).join(", ");
      liveDb.run(`CREATE TABLE ${table} (${colDefs})`);

      const placeholders = contractCols.map(() => "?").join(", ");
      const colList = contractCols.join(", ");

      // Insert one live row with all columns = "live-val".
      liveDb.run(
        `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
        ...contractCols.map(() => "live-val"),
      );

      const divergences = diffProjection(liveDb, shadowDb);
      liveDb.close();
      shadowDb.close();

      // Collect the field names the diff enumerated for this table.
      const diffFields = new Set(
        divergences.filter((d) => d.table === table).map((d) => d.field),
      );

      const contractFields = contractDerivedFields(table);

      // Every contract-derived field must appear in the diff output.
      for (const f of contractFields) {
        assert.ok(
          diffFields.has(f),
          `diffProjection must enumerate contract-derived field '${f}' for ${table}`,
        );
      }

      // No field outside the contract's derived list must appear in the diff.
      for (const f of diffFields) {
        assert.ok(
          contractFields.has(f),
          `diffProjection must not enumerate non-contract field '${f}' for ${table} (runtime-only or unlisted)`,
        );
      }
    });
  }

  /**
   * B1 extra-column exclusion: a live table column that is neither runtime-only
   * nor declared in the contract must NOT appear in the diff output.
   *
   * This is the negative-coverage gate the reviewer required: the previous loop
   * only creates contract-declared columns so it can never fail on a spurious
   * extra-column leak. This test creates one live table with all contract columns
   * PLUS one extra column `__extra_unlisted__` that is not in RUNTIME_ONLY_SET
   * and not declared in PROJECTION_CONTRACT, then asserts the diff enumerates
   * exactly the derived contract fields and excludes the extra column.
   */
  test("diffProjection excludes extra non-runtime non-contract live columns from plan_node", () => {
    const table = "plan_node";
    const entry = PROJECTION_CONTRACT.tables[table];
    assert.ok(entry !== undefined, `PROJECTION_CONTRACT.tables must contain entry for '${table}'`);

    const contractCols = Object.keys(entry.columns);
    const extraCol = "__extra_unlisted__";

    const liveDb = openStore(":memory:", { busyTimeout: 100 });
    const shadowDb = openStore(":memory:", { busyTimeout: 100 });

    // Create live table with all contract columns PLUS one extra non-contract column.
    const colDefs = [...contractCols, extraCol].map((c) => `${c} TEXT`).join(", ");
    liveDb.run(`CREATE TABLE ${table} (${colDefs})`);

    const allCols = [...contractCols, extraCol];
    const placeholders = allCols.map(() => "?").join(", ");
    const colList = allCols.join(", ");
    liveDb.run(
      `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
      ...allCols.map(() => "live-val"),
    );

    const divergences = diffProjection(liveDb, shadowDb);
    liveDb.close();
    shadowDb.close();

    const diffFields = new Set(
      divergences.filter((d) => d.table === table).map((d) => d.field),
    );

    assert.ok(
      !diffFields.has(extraCol),
      `diffProjection must NOT enumerate extra non-contract column '${extraCol}' for ${table}`,
    );

    // All contract-derived fields must still appear.
    const contractFields = contractDerivedFields(table);
    for (const f of contractFields) {
      assert.ok(
        diffFields.has(f),
        `diffProjection must still enumerate contract-derived field '${f}' for ${table}`,
      );
    }
  });
});
