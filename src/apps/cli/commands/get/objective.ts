import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetObjective } from "../../objective.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetObjectiveCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("objective")
    .description("Get an objective.")
    .configureHelp({ commandUsage: () => "kanthord get objective" })
    .requiredOption("--id <id>", "ID of the objective to get")
    .option("--json", "print the objective as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get objective --id obj-1 --json\n",
    )
    .action(async (opts: { id: string; json?: boolean }) => {
      emitResult(
        await runGetObjective(
          { id: opts.id, ...(opts.json ? { json: true } : {}) },
          deps.getObjective,
        ),
        io,
      );
    });
}
