import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runListObjectives } from "../../objective.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildListObjectiveCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("objective")
    .description("List objectives in an initiative.")
    .configureHelp({ commandUsage: () => "kanthord list objective" })
    .requiredOption("--initiative <id>", "ID of the initiative to list")
    .option("--json", "print objectives as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord list objective --initiative initiative-1 --json\n",
    )
    .action(async (opts: { initiative: string; json?: boolean }) => {
      emitResult(
        runListObjectives(
          {
            initiative: opts.initiative,
            ...(opts.json ? { json: true } : {}),
          },
          deps.listObjectives,
        ),
        io,
      );
    });
}
