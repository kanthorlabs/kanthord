import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runFindInitiative } from "../../find.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildFindInitiativeCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("initiative")
    .description("Find an initiative ID by project and name.")
    .configureHelp({ commandUsage: () => "kanthord find initiative" })
    .requiredOption(
      "--project <id>",
      "ID of the project containing the initiative",
    )
    .requiredOption("--name <name>", "name of the initiative to find")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord find initiative --project project-1 --name cli\n",
    )
    .action(async (opts: { project: string; name: string }) => {
      emitResult(
        await runFindInitiative(
          { project: opts.project, name: opts.name },
          deps.findInitiative,
        ),
        io,
      );
    });
}
