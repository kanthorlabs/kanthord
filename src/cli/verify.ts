/**
 * src/cli/verify.ts
 *
 * Story 018-002 Task T1 — Verify CLI entrypoint.
 *
 * Parses --from-markdown --read-only --store <path> --db <path> and delegates
 * to the injected runVerify engine. The live store and store root are opened
 * via injected seams so this module never acquires a writer lock.
 *
 * Exit codes:
 *   0  — clean (0 divergences)
 *   1  — divergences found
 *   2  — contract-version mismatch
 *   3  — usage error (missing required flags)
 */

import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Store } from "../foundations/sqlite-store.ts";
import type { VerifyReport, VerifyDivergence } from "../verify/engine.ts";
import { runVerify as runVerifyEngine } from "../verify/engine.ts";
import { GitStore } from "../store/git-store.ts";
import { walkFeature } from "../compiler/grammar.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type RunVerifyFn = (
  featureDir: string,
  live: Store,
  opts: object,
  ledgerSources?: Array<{ storyId: string; taskStem: string }>,
) => Promise<VerifyReport>;

type WritableOutput = { write(chunk: string): void };

export type CliDeps = {
  /** Engine function — injectable for test doubles. */
  runVerify: RunVerifyFn;
  /** Live store factory: must open the DB read-only. */
  openLiveStore: (dbPath: string) => Store;
  /** Store root factory: must open the git store read-only (no writer lock). */
  openStoreRoot: (storeRoot: string) => { close(): void };
  /**
   * Discovers ledger source locators from the store root directory.
   * Returns a list of { storyId, taskStem } for every task file present.
   * When absent from deps, defaults to returning [].
   */
  discoverLedgerSources?: (storeRoot: string) => Promise<Array<{ storyId: string; taskStem: string }>>;
  /** Output sink (defaults to process.stdout). */
  stdout: WritableOutput;
  /** Error sink (defaults to process.stderr). */
  stderr: WritableOutput;
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * Parse CLI args and run the verify engine.
 *
 * @param args  argv slice (no node/script prefix).
 * @param deps  Injected seams.
 * @returns     Exit code: 0 (clean), 1 (divergences), 2 (version mismatch), 3 (usage).
 */
export async function main(args: string[], deps: CliDeps): Promise<number> {
  // -------------------------------------------------------------------------
  // Parse args
  // -------------------------------------------------------------------------
  let fromMarkdown = false;
  let readOnly = false;
  let storePath: string | undefined;
  let dbPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--from-markdown") {
      fromMarkdown = true;
    } else if (arg === "--read-only") {
      readOnly = true;
    } else if (arg === "--store") {
      storePath = args[i + 1];
      i++;
    } else if (arg === "--db") {
      dbPath = args[i + 1];
      i++;
    }
  }

  // -------------------------------------------------------------------------
  // Validate required flags
  // -------------------------------------------------------------------------
  if (!fromMarkdown || !readOnly || storePath === undefined || storePath.length === 0 || dbPath === undefined || dbPath.length === 0) {
    const missing: string[] = [];
    if (!fromMarkdown) missing.push("--from-markdown");
    if (!readOnly) missing.push("--read-only");
    if (storePath === undefined || storePath.length === 0) missing.push("--store");
    if (dbPath === undefined || dbPath.length === 0) missing.push("--db");
    deps.stderr.write(`verify: missing required options: ${missing.join(", ")}\n`);
    deps.stderr.write("Usage: verify --from-markdown --read-only --store <path> --db <path>\n");
    return 3;
  }

  const resolvedStore = storePath;
  const resolvedDb = dbPath;

  // -------------------------------------------------------------------------
  // Open stores via injected seams (read-only — no writer lock)
  // storeRoot is opened first; openLiveStore is inside the try so that
  // storeRoot.close() is always called even when openLiveStore throws (S1).
  // -------------------------------------------------------------------------
  const storeRoot = deps.openStoreRoot(resolvedStore);
  let live: Store;
  try {
    live = deps.openLiveStore(resolvedDb);
  } catch (err) {
    storeRoot.close();
    throw err;
  }

  try {
    // -----------------------------------------------------------------------
    // Discover ledger sources and run verify engine
    // ledgerSources discovery ensures op_ledger rows are rebuilt in shadow (B1).
    // -----------------------------------------------------------------------
    const ledgerSources = deps.discoverLedgerSources
      ? await deps.discoverLedgerSources(resolvedStore)
      : [];

    let report: VerifyReport;
    try {
      report = await deps.runVerify(resolvedStore, live, {}, ledgerSources);
    } catch (err: unknown) {
      // Contract version mismatch — exit 2
      if (
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: unknown }).code === "contract-version-mismatch"
      ) {
        const mismatch = err as unknown as { liveVersion: string; engineVersion: string; message: string };
        deps.stderr.write(`verify: contract version mismatch\n`);
        deps.stderr.write(`  live version:   ${mismatch.liveVersion}\n`);
        deps.stderr.write(`  engine version: ${mismatch.engineVersion}\n`);
        return 2;
      }
      // Unexpected error — re-throw
      throw err;
    }

    // -----------------------------------------------------------------------
    // Report results
    // -----------------------------------------------------------------------
    if (report.divergences.length === 0) {
      deps.stdout.write("verify: 0 divergences — store matches markdown source\n");
      return 0;
    }

    deps.stdout.write(`verify: ${report.divergences.length} divergence(s) found\n`);
    for (const d of report.divergences) {
      deps.stdout.write(
        `  [${d.table}] field=${d.field}` +
          ` live=${JSON.stringify(d.live)}` +
          ` shadow=${JSON.stringify(d.shadow)}` +
          ` identity=${JSON.stringify(d.rowIdentity)}\n`,
      );
    }
    return 1;
  } finally {
    storeRoot.close();
    live.close();
  }
}

// ---------------------------------------------------------------------------
// Top-level entry point (when script is run directly via `node src/cli/verify.ts`)
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const realDeps: CliDeps = {
    runVerify: runVerifyEngine,
    openLiveStore: (dbPath: string): Store => {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      return {
        get<T>(sql: string, ...params: unknown[]): T | undefined {
          return db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
        },
        run(sql: string, ...params: unknown[]): void {
          db.prepare(sql).run(...(params as SQLInputValue[]));
        },
        all<T>(sql: string, ...params: unknown[]): T[] {
          return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
        },
        close(): void {
          db.close();
        },
      };
    },
    openStoreRoot: (storeRoot: string) => {
      const store = new GitStore(storeRoot, { readOnly: true });
      // Open is async; we return a sync handle with a close no-op.
      // The actual open is done lazily by runVerify via the injected store root seam.
      // For the real path, openStoreRoot just needs to signal read-only intent.
      return { close: () => void store };
    },
    discoverLedgerSources: async (storeRoot: string): Promise<Array<{ storyId: string; taskStem: string }>> => {
      const walk = await walkFeature(storeRoot);
      const sources: Array<{ storyId: string; taskStem: string }> = [];
      for (const group of walk.groups) {
        for (const story of group.stories) {
          for (const file of story.files) {
            if (file.kind === "task") {
              const taskStem = file.name.slice(0, file.name.length - ".md".length);
              sources.push({ storyId: story.name, taskStem });
            }
          }
        }
      }
      return sources;
    },
    stdout: process.stdout,
    stderr: process.stderr,
  };

  main(process.argv.slice(2), realDeps)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`verify: unexpected error: ${msg}\n`);
      process.exit(1);
    });
}
