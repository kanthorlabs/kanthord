import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateProject } from "../../project.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("Create a project.")
    .configureHelp({ commandUsage: () => "kanthord create project" })
    .requiredOption("--name <name>", "name for the new project")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create project --name roadmap\n",
    )
    .action(async (opts: { name: string }) => {
      emitResult(
        await runCreateProject({ name: opts.name }, deps.createProject),
        io,
      );
    });
}
