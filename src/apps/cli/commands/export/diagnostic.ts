import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runDiagnosticsExport } from "../../diagnostics.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildExportDiagnosticCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("diagnostic")
    .description("Export diagnostic records for an initiative.")
    .configureHelp({ commandUsage: () => "kanthord export diagnostic" })
    .requiredOption("--initiative <id>", "initiative ID to diagnose")
    .requiredOption("--out <path>", "path for the diagnostic export")
    .option("--task <id>", "limit diagnostics to a task ID")
    .option("--debug", "include debug diagnostic records")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord export diagnostic --initiative initiative-1 --out ./diagnostics.json\n",
    )
    .action(
      async (opts: {
        initiative: string;
        out: string;
        task?: string;
        debug?: boolean;
      }) => {
        emitResult(
          await runDiagnosticsExport(
            {
              initiative: opts.initiative,
              out: opts.out,
              task: opts.task,
              debug: opts.debug,
            },
            deps.diagnosticsExport,
          ),
          io,
        );
      },
    );
}
