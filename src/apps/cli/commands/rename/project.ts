import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRenameProject } from "../../project.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRenameProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("Rename a project.")
    .configureHelp({ commandUsage: () => "kanthord rename project" })
    .requiredOption("--id <id>", "ID of the project to rename")
    .requiredOption("--name <name>", "new project name")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord rename project --id project-1 --name roadmap\n",
    )
    .action(async (opts: { id: string; name: string }) => {
      emitResult(
        await runRenameProject(
          { id: opts.id, name: opts.name },
          deps.renameProject,
        ),
        io,
      );
    });
}
