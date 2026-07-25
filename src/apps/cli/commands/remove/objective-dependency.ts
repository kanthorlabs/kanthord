import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRemoveObjectiveDependency } from "../../sequencing.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRemoveObjectiveDependencyCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("objective-dependency")
    .description("Remove a sequencing dependency between objectives.")
    .configureHelp({
      commandUsage: () => "kanthord remove objective-dependency",
    })
    .requiredOption(
      "--objective <id>",
      "ID of the objective to stop waiting for",
    )
    .requiredOption("--after <id>", "ID of the objective to stop depending on")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord remove objective-dependency --objective objective-3 --after objective-2\n",
    )
    .action(async (opts: { objective: string; after: string }) => {
      emitResult(
        await runRemoveObjectiveDependency(
          { objective: opts.objective, after: opts.after },
          deps.removeObjectiveDependency,
        ),
        io,
      );
    });
}
