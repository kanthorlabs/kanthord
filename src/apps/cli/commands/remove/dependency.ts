import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRemoveDependency } from "../../dependency.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRemoveDependencyCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("dependency")
    .description("Remove a dependency between tasks.")
    .configureHelp({ commandUsage: () => "kanthord remove dependency" })
    .requiredOption(
      "--task <id>",
      "ID of the task that depends on another task",
    )
    .requiredOption("--depends-on <id>", "ID of the task to stop depending on")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord remove dependency --task task-1 --depends-on task-2\n",
    )
    .action(async (opts: { task: string; dependsOn: string }) => {
      emitResult(
        await runRemoveDependency(
          { task: opts.task, "depends-on": opts.dependsOn },
          deps.removeDependency,
        ),
        io,
      );
    });
}
