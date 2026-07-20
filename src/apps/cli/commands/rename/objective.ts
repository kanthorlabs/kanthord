import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRenameObjective } from "../../objective.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRenameObjectiveCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("objective")
    .description("Rename an objective.")
    .configureHelp({ commandUsage: () => "kanthord rename objective" })
    .requiredOption("--id <id>", "ID of the objective to rename")
    .requiredOption("--name <name>", "new objective name")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord rename objective --id objective-1 --name routing\n",
    )
    .action(async (opts: { id: string; name: string }) => {
      emitResult(
        await runRenameObjective(
          { id: opts.id, name: opts.name },
          deps.renameObjective,
        ),
        io,
      );
    });
}
