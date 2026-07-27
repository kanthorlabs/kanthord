import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runListProjects } from "../../project.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildListProjectCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("project")
    .description("List projects.")
    .configureHelp({ commandUsage: () => "kanthord list project" })
    .option("--json", "print projects as JSON")
    .addHelpText("after", "\nExample:\n  kanthord list project --json\n")
    .action((opts: { json?: boolean }) => {
      emitResult(
        runListProjects(
          { ...(opts.json ? { json: true } : {}) },
          deps.listProjects,
        ),
        io,
      );
    });
}
