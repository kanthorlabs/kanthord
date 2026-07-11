/**
 * Guard: no timestamp-named column may be declared TEXT.
 *
 * Covers every table created by initSchema() plus the compiler's
 * applyCompiledPlanMigration() tables (which include plan_node.snapshot_at).
 *
 * Timestamp-pattern column names (per Story 001 T3 AC):
 *   ts | *_ts | *_at | *expires* | *timestamp*
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "./schema.ts";
import { applyCompiledPlanMigration } from "../compiler/compile.ts";

function isTimestampColumn(name: string): boolean {
  return (
    name === "ts" ||
    name.endsWith("_ts") ||
    name.endsWith("_at") ||
    name.includes("expires") ||
    name.includes("timestamp")
  );
}

test("no timestamp-named column is declared TEXT", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanthord-ts-guard-"));
  const dbPath = join(dir, "guard.db");
  try {
    const store = openStore(dbPath, { busyTimeout: 3000 });
    try {
      initSchema(store);
      applyCompiledPlanMigration(store);

      // Collect all user tables
      const tables = store.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_version'",
      );
      assert.ok(tables.length > 0, "expected at least one table");

      type ColInfo = { name: string; type: string };
      const violations: string[] = [];

      for (const { name: table } of tables) {
        const cols = store.all<ColInfo>(`PRAGMA table_info(${table})`);
        for (const col of cols) {
          if (isTimestampColumn(col.name) && col.type.toUpperCase() === "TEXT") {
            violations.push(`${table}.${col.name} (TEXT)`);
          }
        }
      }

      assert.deepEqual(
        violations,
        [],
        `timestamp-named columns declared TEXT: ${violations.join(", ")}`,
      );
    } finally {
      store.close();
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
