import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetProject } from "../../get.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("Get a project.")
    .configureHelp({ commandUsage: () => "kanthord get project" })
    .requiredOption("--id <id>", "ID of the project to get")
    .option("--json", "print the project as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get project --id project-1 --json\n",
    )
    .action(async (opts: { id: string; json?: boolean }) => {
      emitResult(
        await runGetProject(
          { id: opts.id, ...(opts.json ? { json: true } : {}) },
          deps.getProject,
        ),
        io,
      );
    });
}
