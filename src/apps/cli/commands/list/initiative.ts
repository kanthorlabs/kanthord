import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runListInitiatives } from "../../initiative.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildListInitiativeCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("initiative")
    .description("List initiatives in a project.")
    .configureHelp({ commandUsage: () => "kanthord list initiative" })
    .requiredOption("--project <id>", "ID of the project to list")
    .option("--json", "print initiatives as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord list initiative --project project-1 --json\n",
    )
    .action(async (opts: { project: string; json?: boolean }) => {
      emitResult(
        runListInitiatives(
          {
            project: opts.project,
            ...(opts.json ? { json: true } : {}),
          },
          deps.listInitiatives,
        ),
        io,
      );
    });
}
