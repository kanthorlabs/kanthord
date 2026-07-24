import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetInitiative } from "../../initiative.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetInitiativeCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("initiative")
    .description("Get an initiative.")
    .configureHelp({ commandUsage: () => "kanthord get initiative" })
    .requiredOption("--id <id>", "ID of the initiative to get")
    .option("--json", "print the initiative as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get initiative --id init-1 --json\n",
    )
    .action(async (opts: { id: string; json?: boolean }) => {
      emitResult(
        await runGetInitiative(
          { id: opts.id, ...(opts.json ? { json: true } : {}) },
          deps.getInitiative,
        ),
        io,
      );
    });
}
