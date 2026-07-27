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
    .option(
      "--after <id>",
      "sequence this node after an existing one; repeat for each prerequisite",
      (value: string, values: string[]) => (values.push(value), values),
      [] as string[],
    )
    .option(
      "--paused",
      "create the initiative paused; nothing runs until `resume initiative`",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create initiative --project project-1 --name cli\n",
    )
    .action(
      async (opts: {
        project: string;
        name: string;
        after: string[];
        paused?: boolean;
      }) => {
        emitResult(
          await runCreateInitiative(
            {
              project: opts.project,
              name: opts.name,
              after: opts.after,
              paused: opts.paused ?? false,
            },
            deps.createInitiative,
          ),
          io,
        );
      },
    );
}
