import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateObjective } from "../../objective.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateObjectiveCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("objective")
    .description("Create an objective in an initiative.")
    .configureHelp({ commandUsage: () => "kanthord create objective" })
    .requiredOption("--initiative <id>", "initiative ID for the new objective")
    .requiredOption("--name <name>", "name for the new objective")
    .option(
      "--after <id>",
      "sequence this node after an existing one; repeat for each prerequisite",
      (value: string, values: string[]) => (values.push(value), values),
      [] as string[],
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create objective --initiative initiative-1 --name routing\n",
    )
    .action(
      async (opts: { initiative: string; name: string; after: string[] }) => {
        emitResult(
          await runCreateObjective(
            {
              initiative: opts.initiative,
              name: opts.name,
              after: opts.after,
            },
            deps.createObjective,
          ),
          io,
        );
      },
    );
}
