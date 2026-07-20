import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runFindResource } from "../../find.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildFindResourceCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("resource")
    .description("Find a resource ID by project and name.")
    .configureHelp({ commandUsage: () => "kanthord find resource" })
    .requiredOption(
      "--project <id>",
      "ID of the project containing the resource",
    )
    .requiredOption("--name <name>", "name of the resource to find")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord find resource --project project-1 --name workspace\n",
    )
    .action(async (opts: { project: string; name: string }) => {
      emitResult(
        await runFindResource(
          { project: opts.project, name: opts.name },
          deps.findResource,
        ),
        io,
      );
    });
}
