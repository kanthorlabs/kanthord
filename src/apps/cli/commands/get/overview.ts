import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetProjectOverview } from "../../project.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetOverviewCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("overview")
    .description("Get a project's initiative overview and activity digest.")
    .configureHelp({ commandUsage: () => "kanthord get overview" })
    .requiredOption("--project <id>", "ID of the project to summarise")
    .option("--json", "print the overview as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get overview --project project-1 --json\n",
    )
    .action(async (opts: { project: string; json?: boolean }) => {
      emitResult(
        await runGetProjectOverview(
          { project: opts.project, ...(opts.json ? { json: true } : {}) },
          deps.getProjectOverview,
        ),
        io,
      );
    });
}
