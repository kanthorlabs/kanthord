/**
 * src/verify/engine.ts
 *
 * Story 018-001 Task T1 — Verify engine: rebuild shadow, diff, report.
 *
 * Composes `rebuildFromMarkdown` (Epic 003) and `diffProjection` (rebuild.ts)
 * under the versioned PROJECTION_CONTRACT. The engine is read-only with respect
 * to the live store: it only creates and destroys an ephemeral shadow store.
 */

import type { Store } from "../foundations/sqlite-store.ts";
import type { CompileOptions } from "../compiler/compile.ts";
import { rebuildFromMarkdown, diffProjection } from "../store/rebuild.ts";
import type { Divergence } from "../store/rebuild.ts";
import { PROJECTION_CONTRACT_VERSION } from "../store/projection.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One field-level divergence found between the live store and the shadow store.
 * Mirrors `Divergence` from rebuild.ts but is re-exported as the public API
 * surface of the verify engine so callers do not depend on store internals.
 */
export type VerifyDivergence = {
  /** SQLite table name (one of PROJECTION_CONTRACT.tableScope). */
  table: string;
  /** The row's identity fields. */
  rowIdentity: Record<string, unknown>;
  /** The field that differs. */
  field: string;
  /** Value in the live store's projected row (undefined = row absent from live). */
  live: unknown;
  /** Value in the shadow store's projected row (undefined = row absent from shadow). */
  shadow: unknown;
};

/**
 * Result of a verify run: a list of field-level divergences between the live
 * database and the markdown-derived shadow rebuild. Empty means clean.
 */
export type VerifyReport = {
  divergences: VerifyDivergence[];
};

/**
 * Thrown by runVerify when the live store's stamped contract version does not
 * match the engine's built-in PROJECTION_CONTRACT_VERSION.
 * Exit-code contract: this condition maps to exit 2 (Epic 018).
 */
export type ContractVersionMismatchError = Error & {
  code: "contract-version-mismatch";
  liveVersion: string;
  engineVersion: string;
};

// ---------------------------------------------------------------------------
// runVerify
// ---------------------------------------------------------------------------

/**
 * Rebuilds a shadow store from the markdown files in `featureDir`, diffs its
 * projection against `live` under the PROJECTION_CONTRACT, and returns a typed
 * `VerifyReport`.
 *
 * The live store is never written to. The shadow store is an in-memory SQLite
 * database created and discarded within this call. Optional `ledgerSources`
 * enables op_ledger reconstruction in the shadow (Epic 005 Story 006 scope).
 *
 * @param featureDir    Path to the feature directory (contains epic.md and story subdirs).
 * @param live          The live Store to diff against.
 * @param opts          CompileOptions forwarded to rebuildFromMarkdown.
 * @param ledgerSources Optional ledger source locators for op_ledger shadow reconstruction.
 */
export async function runVerify(
  featureDir: string,
  live: Store,
  opts: CompileOptions,
  ledgerSources?: Array<{ storyId: string; taskStem: string }>,
): Promise<VerifyReport> {
  // Check contract version before doing any work.
  // When the _contract_meta table doesn't exist, treat as "no version stamped"
  // and skip the check (legacy or freshly-compiled store).
  let metaRow: { value: string } | undefined;
  try {
    metaRow = live.get<{ value: string }>(
      "SELECT value FROM _contract_meta WHERE key = 'contract_version'",
    );
  } catch (err) {
    // Only treat "no such table" as absent metadata; all other DB errors propagate.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("no such table")) {
      throw err;
    }
    metaRow = undefined;
  }
  if (metaRow !== undefined) {
    const liveVersion = metaRow.value;
    if (liveVersion !== PROJECTION_CONTRACT_VERSION) {
      const err = Object.assign(
        new Error(
          `Contract version mismatch: live store has '${liveVersion}', engine expects '${PROJECTION_CONTRACT_VERSION}'`,
        ),
        {
          code: "contract-version-mismatch" as const,
          liveVersion,
          engineVersion: PROJECTION_CONTRACT_VERSION,
        },
      );
      throw err;
    }
  }

  const shadow = await rebuildFromMarkdown(featureDir, opts, ledgerSources);

  let rawDivergences: Divergence[];
  try {
    rawDivergences = diffProjection(live, shadow);
  } finally {
    shadow.close();
  }

  const divergences: VerifyDivergence[] = rawDivergences.map((d) => ({
    table: d.table,
    rowIdentity: d.rowIdentity,
    field: d.field,
    live: d.live,
    shadow: d.shadow,
  }));

  return { divergences };
}
