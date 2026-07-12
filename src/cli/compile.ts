/**
 * src/cli/compile.ts
 *
 * kanthord compile — standalone feature-plan compile CLI (Epic 019.9 S002 T1)
 *
 * Exports:
 *   runCompileCommand({ featureDir, store, opts, out }) — compile the feature
 *     plan into the store, write a summary line to out, return exit code (0 on
 *     success, non-zero on error).
 *   main(argv) — thin CLI entry point: parses --slot/--feature-dir/--checkout/
 *     --help, resolves store + featureDir via the bootstrap-live-run path
 *     convention, then delegates to runCompileCommand.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Store } from "../foundations/sqlite-store.ts";
import { openStore } from "../foundations/sqlite-store.ts";
import { initSchema } from "../store/schema.ts";
import { compile } from "../compiler/compile.ts";
import type { CompileOptions } from "../compiler/compile.ts";
import { resolveDataRoot, ensureDataRoot } from "../foundations/data-root.ts";
import { loadRepoSlot } from "../slots/repo-slot.ts";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const USAGE = `kanthord compile — compile feature plan into the daemon store

Usage:
  node src/cli/compile.ts --checkout <dir> [--feature-dir <dir>] [--slot <path>] [--help]

Options:
  --checkout <dir>    Local checkout directory (default: <data-root>/checkout)
  --feature-dir <dir> Feature directory (default: <checkout>/.kanthord/features)
  --slot <path>       Slot YAML file path (used to derive repoRegistry)
  --help              Show this usage and exit 0`.trim();

// ---------------------------------------------------------------------------
// runCompileCommand
// ---------------------------------------------------------------------------

export type RunCompileCommandArgs = {
  featureDir: string;
  store: Store;
  opts?: CompileOptions;
  out: (line: string) => void;
};

export async function runCompileCommand(args: RunCompileCommandArgs): Promise<number> {
  const { featureDir, store, out } = args;
  const opts = args.opts ?? {};
  try {
    await compile(featureDir, store, opts);
    // Query the most recently compiled feature for the summary line
    const genRow = store.get<{ feature_id: string }>(
      "SELECT feature_id FROM plan_generation ORDER BY generation DESC LIMIT 1",
    );
    const featureId = genRow?.feature_id ?? "(unknown)";
    const countRow = store.get<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM plan_node WHERE feature_id = ? AND kind = 'task'",
      featureId,
    );
    const taskCount = countRow?.cnt ?? 0;
    out(`compiled ${featureId}: ${taskCount} task(s)`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out(`compile error: ${msg}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// main — CLI entry point
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      slot: { type: "string" },
      "feature-dir": { type: "string" },
      checkout: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help === true) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }

  // Resolve checkout dir: from --checkout arg or fall back to data-root default
  let checkoutDir: string;
  if (typeof values.checkout === "string" && values.checkout.length > 0) {
    checkoutDir = values.checkout;
  } else {
    const dataRoot = await ensureDataRoot(resolveDataRoot());
    checkoutDir = join(dataRoot, "checkout");
  }

  const kanthordDir = join(checkoutDir, ".kanthord");
  const featureDirArg = values["feature-dir"];
  const featureDir =
    typeof featureDirArg === "string" && featureDirArg.length > 0
      ? featureDirArg
      : join(kanthordDir, "features");
  const dbPath = join(kanthordDir, "db.sqlite");

  // Derive repoRegistry from slot YAML when --slot is provided
  let repoRegistry: string[] | undefined;
  const slotArg = values.slot;
  if (typeof slotArg === "string" && slotArg.length > 0) {
    try {
      const slot = await loadRepoSlot(slotArg);
      const { pathname } = new URL(slot.repo);
      const slug = pathname.replace(/^\//, "").replace(/\.git$/, "");
      if (slug.length > 0) repoRegistry = [slug];
    } catch {
      // non-HTTPS URL or unreadable slot — skip repo registry check
    }
  }

  const store = openStore(dbPath, { busyTimeout: 5000 });
  initSchema(store);

  const code = await runCompileCommand({
    featureDir,
    store,
    opts: { repoRegistry },
    out: (line) => process.stdout.write(line + "\n"),
  });
  store.close();
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Run only when invoked directly (not when imported as a module)
// ---------------------------------------------------------------------------

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
