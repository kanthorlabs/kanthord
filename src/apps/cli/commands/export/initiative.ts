import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runExportInitiative } from "../../export.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildExportInitiativeCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("initiative")
    .description("Export an initiative graph package.")
    .configureHelp({ commandUsage: () => "kanthord export initiative" })
    .argument("<id>", "initiative ID to export")
    .requiredOption("--out <dir>", "directory for the exported package")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord export initiative initiative-1 --out ./exports\n",
    )
    .action(async (id: string, opts: { out: string }) => {
      emitResult(
        await runExportInitiative({ id, out: opts.out }, deps.exportInitiative),
        io,
      );
    });
}
