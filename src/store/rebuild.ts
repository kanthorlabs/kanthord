import {
  buildCorePlan,
  computeCompileHash,
  applyCompiledPlanMigration,
} from "../compiler/compile.ts";
import type { CompileOptions } from "../compiler/compile.ts";
import { openStore } from "../foundations/sqlite-store.ts";
import type { Store } from "../foundations/sqlite-store.ts";
import { PROJECTION_CONTRACT, RUNTIME_ONLY_SET } from "./projection.ts";
import { FeatureStore } from "./feature-store.ts";
import { recoverFromLedger } from "../broker/ledger.ts";

/**
 * Rebuilds the markdown-derived subset of the compiled-plan SQLite tables into
 * a fresh in-memory shadow store.
 *
 * Calls the pure `buildCorePlan` (no operational `compile`, no queue/runtime
 * init), applies the compiled-plan DDL, and writes graph rows. The
 * `plan_generation.compile_hash` is derived from the same markdown files using
 * the same deterministic algorithm the writer uses, so `projectionOf(shadow)`
 * equals `projectionOf(live)` for every table in PROJECTION_CONTRACT.tableScope
 * (runtime-only fields — generation, at, content_hash, snapshot_at — are
 * excluded by projectionOf per the v1 contract).
 *
 * The WAL PRAGMA is silently ignored by SQLite for in-memory databases; no WAL
 * file is created.
 *
 * @param ledgerSources  Optional list of `{ storyId, taskStem }` locators that
 *   name task journals to scan for `op_ledger` reconstruction.  When provided,
 *   the `op_ledger` table is created in the shadow store (idempotent DDL) and
 *   every recovered entry is inserted via `INSERT OR REPLACE`.  Callers that
 *   pass only 2 arguments are unaffected (no op_ledger table is created).
 */
export async function rebuildFromMarkdown(
  featureDir: string,
  opts: CompileOptions,
  ledgerSources?: Array<{ storyId: string; taskStem: string }>,
): Promise<Store> {
  // Compute the same deterministic hash the writer uses (compile: key stripped).
  const hash = await computeCompileHash(featureDir);

  // Pure derivation — reads markdown files, returns the graph, never writes to any store.
  const graph = await buildCorePlan(featureDir, opts);

  // Shadow store: in-memory SQLite.
  const shadow = openStore(":memory:", { busyTimeout: 1000 });

  // Apply the same compiled-plan DDL the writer uses.
  applyCompiledPlanMigration(shadow);

  // plan_node rows — generation=0 sentinel; runtime-only per the contract.
  for (const node of graph.nodes) {
    shadow.run(
      "INSERT INTO plan_node (id, kind, feature_id, repo, ticket_system, ticket_ref, major, lane, slug, generation, content_hash, snapshot_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      node.id,
      node.kind,
      node.feature_id,
      node.repo,
      node.ticket_system,
      node.ticket_ref,
      node.major,
      node.lane,
      node.slug,
      0,
      null,
      null,
    );
  }

  // plan_edge rows.
  for (const edge of graph.edges) {
    shadow.run(
      "INSERT INTO plan_edge (from_node_id, to_node_id, kind, semantics) VALUES (?, ?, ?, ?)",
      edge.from_node_id,
      edge.to_node_id,
      edge.kind,
      edge.semantics,
    );
  }

  // plan_gate rows.
  for (const gate of graph.gates) {
    shadow.run(
      "INSERT INTO plan_gate (node_id, phase, position, name, artifact_id, semantics) VALUES (?, ?, ?, ?, ?, ?)",
      gate.node_id,
      gate.phase,
      gate.position,
      gate.name,
      gate.artifact_id,
      gate.semantics,
    );
  }

  // plan_artifact rows.
  for (const artifact of graph.artifacts) {
    shadow.run(
      "INSERT INTO plan_artifact (id, publisher_node_id, kind, path) VALUES (?, ?, ?, ?)",
      artifact.id,
      artifact.publisher_node_id,
      artifact.kind,
      artifact.path,
    );
  }

  // plan_artifact_consumer rows.
  for (const consumer of graph.artifactConsumers) {
    shadow.run(
      "INSERT INTO plan_artifact_consumer (artifact_id, consumer_node_id) VALUES (?, ?)",
      consumer.artifact_id,
      consumer.consumer_node_id,
    );
  }

  // plan_deploy_stage rows.
  for (const ds of graph.deployStages ?? []) {
    shadow.run(
      "INSERT INTO plan_deploy_stage (node_id, handlers, success_criteria, soak_duration) VALUES (?, ?, ?, ?)",
      ds.node_id,
      ds.handlers,
      ds.success_criteria,
      ds.soak_duration,
    );
  }

  // plan_generation row — compile_hash matches the live store because both
  // derive it from the same markdown files via the same deterministic algorithm.
  // generation=0 and at=now are runtime-only and excluded by projectionOf.
  const epicNode = graph.nodes.find((n) => n.kind === "epic");
  const featureId = epicNode?.feature_id ?? "";
  shadow.run(
    "INSERT INTO plan_generation (generation, compile_hash, feature_id, at) VALUES (?, ?, ?, ?)",
    0,
    hash,
    featureId,
    new Date().toISOString(),
  );

  // op_ledger reconstruction — only when callers pass ledgerSources (B1 / Epic 005 Story 006).
  // Creates the op_ledger table idempotently and inserts each recovered entry so that
  // diffProjection's "rebuild == projection" gate covers durable ledger state (PRD §6.1).
  if (ledgerSources !== undefined && ledgerSources.length > 0) {
    // Idempotent DDL — sqlite-gotchas.md: use IF NOT EXISTS, never try/catch.
    shadow.run(
      "CREATE TABLE IF NOT EXISTS op_ledger " +
        "(op_id TEXT PRIMARY KEY, verb TEXT, idempotency_key TEXT, " +
        "correlation TEXT, desired_effect_hash TEXT, status TEXT)",
    );
    const featureStore = new FeatureStore(featureDir);
    for (const { storyId, taskStem } of ledgerSources) {
      const entries = await recoverFromLedger(featureStore, storyId, taskStem);
      for (const entry of entries) {
        shadow.run(
          "INSERT OR REPLACE INTO op_ledger " +
            "(op_id, verb, idempotency_key, correlation, desired_effect_hash, status) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
          entry.op_id,
          entry.verb,
          entry.idempotency_key,
          entry.correlation,
          entry.desired_effect_hash,
          entry.status,
        );
      }
    }
  }

  return shadow;
}

// ---------------------------------------------------------------------------
// Divergence type + diffProjection — S003-T2
// ---------------------------------------------------------------------------

/**
 * One field-level difference found between the live store's projection and
 * the shadow store's projection for a given table row.
 */
export type Divergence = {
  /** SQLite table name (one of PROJECTION_CONTRACT.tableScope). */
  table: string;
  /** The row's identity fields (raw values from whichever store holds the row). */
  rowIdentity: Record<string, unknown>;
  /** The field that differs after projectionOf. */
  field: string;
  /** Value in the live store's projected row. */
  live: unknown;
  /** Value in the shadow store's projected row. */
  shadow: unknown;
};

/**
 * Returns all rows from `table` if the table exists in `store`, or `[]` if
 * the table is absent.  Uses `sqlite_master` as a declarative existence check
 * so that a missing table is treated as 0 rows rather than throwing
 * `ERR_SQLITE_ERROR: no such table` — necessary because `PROJECTION_CONTRACT`
 * may reference tables (e.g. `op_ledger`) that only exist in broker-managed
 * stores, not in plain compiled-plan stores.
 */
function getTableRows(store: Store, table: string): Record<string, unknown>[] {
  const exists = store.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?",
    table,
  );
  if ((exists?.n ?? 0) === 0) return [];
  return store.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
}

/**
 * Compares the projection of `live` against the projection of `shadow` for
 * every table in PROJECTION_CONTRACT.tableScope. Returns one `Divergence`
 * entry per differing field per matched row pair. Returns `[]` when equal.
 *
 * Rows are matched by their raw rowIdentityKey values (before projectionOf so
 * that identity fields that happen to be runtime-only still uniquely address
 * rows). Unmatched rows (exist in live but not shadow) are reported as
 * divergences with `shadow: undefined` for each projected field.
 *
 * Tables absent from a store are treated as having 0 rows (no crash).
 *
 * Never throws; assigns no severity (severity is Phase 3).
 */
/**
 * Returns a copy of `row` restricted to columns that are declared in
 * `contractCols` and are not runtime-only. This is the contract-aware
 * projection used by `diffProjection`: it strips both runtime-only fields
 * (via `RUNTIME_ONLY_SET`) AND any columns not declared in the per-table
 * contract, so that an extra live DB column never leaks into the diff output.
 */
function contractProjectionOf(
  row: Record<string, unknown>,
  contractCols: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!RUNTIME_ONLY_SET.has(key) && contractCols.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

export function diffProjection(live: Store, shadow: Store): Divergence[] {
  const divergences: Divergence[] = [];

  for (const table of PROJECTION_CONTRACT.tableScope) {
    const tableEntry = PROJECTION_CONTRACT.tables[table];
    if (tableEntry === undefined) continue;

    // Compute the set of contract-declared derived (non-runtimeOnly) columns
    // for this table. Only these columns participate in the diff; any extra
    // live DB column not in the contract is excluded from the output.
    const contractDerivedCols = new Set<string>();
    for (const [col, classification] of Object.entries(tableEntry.columns)) {
      if (!("runtimeOnly" in classification) && !RUNTIME_ONLY_SET.has(col)) {
        contractDerivedCols.add(col);
      }
    }

    // Strip runtime-only fields from the identity key so that rows whose only
    // identity difference is a runtime-only field (e.g. plan_generation.generation
    // is 1 in live vs 0 in shadow) still resolve to the same map key and match.
    const projectedIdentityKeys = tableEntry.rowIdentityKey.filter(
      (k) => !RUNTIME_ONLY_SET.has(k),
    );

    // Treat a missing table in either store as having 0 rows — avoids
    // ERR_SQLITE_ERROR when op_ledger is absent from compiled-plan stores.
    const liveRows = getTableRows(live, table);
    const shadowRows = getTableRows(shadow, table);

    // Build a map from serialised projected row identity to the shadow row's
    // contract-projected form. Using projected identity keys means runtime-only
    // fields (e.g. generation=0 sentinel in shadow vs generation=1 in live) do
    // not prevent rows from matching.
    const shadowMap = new Map<string, Record<string, unknown>>();
    for (const row of shadowRows) {
      shadowMap.set(
        serializeRowIdentity(row, projectedIdentityKeys),
        contractProjectionOf(row, contractDerivedCols),
      );
    }

    // Track which shadow identity keys are matched by a live row so the
    // shadow-only pass below can report the remainder.
    const matchedShadowKeys = new Set<string>();

    for (const liveRow of liveRows) {
      const identityKey = serializeRowIdentity(liveRow, projectedIdentityKeys);
      matchedShadowKeys.add(identityKey);
      const rowIdentity = extractRowIdentity(liveRow, projectedIdentityKeys);
      const liveProjected = contractProjectionOf(liveRow, contractDerivedCols);
      const shadowProjected = shadowMap.get(identityKey);

      if (shadowProjected === undefined) {
        // Row present in live but absent from shadow — report each projected field.
        for (const [field, liveVal] of Object.entries(liveProjected)) {
          divergences.push({ table, rowIdentity, field, live: liveVal, shadow: undefined });
        }
        continue;
      }

      // Compare every projected field present in either row.
      const allFields = new Set([
        ...Object.keys(liveProjected),
        ...Object.keys(shadowProjected),
      ]);
      for (const field of allFields) {
        const liveVal = liveProjected[field];
        const shadowVal = shadowProjected[field];
        if (liveVal !== shadowVal) {
          divergences.push({ table, rowIdentity, field, live: liveVal, shadow: shadowVal });
        }
      }
    }

    // Shadow-only pass: scan shadow rows for identity keys that no live row
    // matched; report each projected field as a divergence (live: undefined).
    for (const shadowRow of shadowRows) {
      const key = serializeRowIdentity(shadowRow, projectedIdentityKeys);
      if (matchedShadowKeys.has(key)) continue;
      const rowIdentity = extractRowIdentity(shadowRow, projectedIdentityKeys);
      const shadowProjected = contractProjectionOf(shadowRow, contractDerivedCols);
      for (const [field, shadowVal] of Object.entries(shadowProjected)) {
        divergences.push({ table, rowIdentity, field, live: undefined, shadow: shadowVal });
      }
    }
  }

  return divergences;
}

/** Serialises the rowIdentityKey fields of a raw row into a stable string key. */
function serializeRowIdentity(row: Record<string, unknown>, keys: string[]): string {
  return keys.map((k) => JSON.stringify(row[k])).join("\0");
}

/** Extracts the rowIdentityKey fields from a raw row into a plain object. */
function extractRowIdentity(
  row: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    result[k] = row[k];
  }
  return result;
}
