import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateInitiative } from "../../initiative.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateInitiativeCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("initiative")
    .description("Create an initiative in a project.")
    .configureHelp({ commandUsage: () => "kanthord create initiative" })
    .requiredOption("--project <id>", "project ID for the new initiative")
    .requiredOption("--name <name>", "name for the new initiative")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create initiative --project project-1 --name cli\n",
    )
    .action(async (opts: { project: string; name: string }) => {
      emitResult(
        await runCreateInitiative(
          { project: opts.project, name: opts.name },
          deps.createInitiative,
        ),
        io,
      );
    });
}
