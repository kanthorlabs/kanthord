import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRenameInitiative } from "../../initiative.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRenameInitiativeCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("initiative")
    .description("Rename an initiative.")
    .configureHelp({ commandUsage: () => "kanthord rename initiative" })
    .requiredOption("--id <id>", "ID of the initiative to rename")
    .requiredOption("--name <name>", "new initiative name")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord rename initiative --id initiative-1 --name cli\n",
    )
    .action(async (opts: { id: string; name: string }) => {
      emitResult(
        await runRenameInitiative(
          { id: opts.id, name: opts.name },
          deps.renameInitiative,
        ),
        io,
      );
    });
}
