import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runFindObjective } from "../../find.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildFindObjectiveCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("objective")
    .description("Find an objective ID by initiative and name.")
    .configureHelp({ commandUsage: () => "kanthord find objective" })
    .requiredOption(
      "--initiative <id>",
      "ID of the initiative containing the objective",
    )
    .requiredOption("--name <name>", "name of the objective to find")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord find objective --initiative initiative-1 --name routing\n",
    )
    .action(async (opts: { initiative: string; name: string }) => {
      emitResult(
        await runFindObjective(
          { initiative: opts.initiative, name: opts.name },
          deps.findObjective,
        ),
        io,
      );
    });
}
