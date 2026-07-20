import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runFindProject } from "../../find.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildFindProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("Find a project ID by name.")
    .configureHelp({ commandUsage: () => "kanthord find project" })
    .requiredOption("--name <name>", "name of the project to find")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord find project --name roadmap\n",
    )
    .action(async (opts: { name: string }) => {
      emitResult(
        await runFindProject({ name: opts.name }, deps.findProject),
        io,
      );
    });
}
