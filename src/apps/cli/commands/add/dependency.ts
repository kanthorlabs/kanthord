import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runAddDependency } from "../../dependency.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildAddDependencyCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("dependency")
    .description("Add a dependency between tasks.")
    .configureHelp({ commandUsage: () => "kanthord add dependency" })
    .requiredOption(
      "--task <id>",
      "ID of the task that depends on another task",
    )
    .requiredOption("--depends-on <id>", "ID of the task to depend on")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord add dependency --task task-1 --depends-on task-2\n",
    )
    .action(async (opts: { task: string; dependsOn: string }) => {
      emitResult(
        await runAddDependency(
          { task: opts.task, "depends-on": opts.dependsOn },
          deps.addDependency,
        ),
        io,
      );
    });
}
