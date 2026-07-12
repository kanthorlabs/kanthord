/**
 * src/cli/run.ts
 *
 * kanthord run — thin CLI shell (Epic 019.2, Story 001, Task T4).
 *
 * Parses --slot <path>, --port <n>, --hold-point, --help; constructs the real
 * adapters (slot loader, store, system clock, pi surface, status-server factory)
 * and calls runDaemon(deps). Real adapters are constructed here only — runDaemon
 * itself is fully dependency-injected (Epic 009 DI pattern / PRD §7.7).
 *
 * Verification: `node src/cli/run.ts --help` exits 0 and prints usage.
 */

import { parseArgs } from "node:util";
import { loadRepoSlot } from "../slots/repo-slot.ts";
import { runDaemon } from "../daemon/run-loop.ts";
import { bootstrapLiveRun } from "./bootstrap-live-run.ts";
import { resolveDaemonProviderSession } from "./daemon-provider-session.ts";
import { resolveDataRoot, ensureDataRoot } from "../foundations/data-root.ts";
import { runGit as execRunGit } from "../git/exec.ts";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const USAGE = `kanthord run — start the kanthord daemon

Usage:
  node src/cli/run.ts --slot <path> [--account <label>] [--model <id>] [--port <n>] [--hold-point] [--help]

Options:
  --slot <path>      Path to the slot YAML file (required)
  --account <label>  Provider account label (default: sole logged-in account)
  --model <id>       Model id to use (default: account defaultModel)
  --port <n>         Status HTTP server port (default: OS-assigned on 127.0.0.1)
  --hold-point       Enable broker pre-submit hold-point (LP4 cutpoint)
  --help             Show this usage and exit 0`.trim();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      slot: { type: "string" },
      account: { type: "string" },
      model: { type: "string" },
      port: { type: "string" },
      "hold-point": { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (values.help === true) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }

  if (typeof values.slot !== "string" || values.slot.length === 0) {
    process.stderr.write("Error: --slot <path> is required\n\n" + USAGE + "\n");
    process.exit(3);
  }

  const slotYamlPath = values.slot;
  const slot = await loadRepoSlot(slotYamlPath);

  const holdPointEnabled = values["hold-point"] === true;

  // Resolve the provider account→session at boot; fail closed before daemon starts.
  const dataRoot = await ensureDataRoot(resolveDataRoot());
  let providerModel: Awaited<ReturnType<typeof resolveDaemonProviderSession>>["model"] | undefined;
  let providerStreamFn: Awaited<ReturnType<typeof resolveDaemonProviderSession>>["streamFn"] | undefined;
  try {
    const session = await resolveDaemonProviderSession({
      dataRoot,
      accountLabel: values.account,
      modelId: values.model,
    });
    providerModel = session.model;
    providerStreamFn = session.streamFn;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  // bootstrapLiveRun assembles the live-path deps: clones the repo, opens the
  // store, loads identity, wires verbAdapters + commitsAhead + worktreeSlot.
  const deps = await bootstrapLiveRun({
    slot,
    dataRoot,
    providerModel,
    providerStreamFn,
    runGit: execRunGit,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: bootstrap failed — ${msg}\n`);
    process.exit(1);
  });

  await runDaemon({ ...deps, holdPointEnabled });

  // runDaemon installs SIGTERM/SIGINT → handle.stop() internally (T2).
  // The HTTP server keeps the event loop alive until the signal fires.
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
