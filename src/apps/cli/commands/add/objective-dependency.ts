import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runAddObjectiveDependency } from "../../sequencing.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildAddObjectiveDependencyCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("objective-dependency")
    .description("Sequence one objective after another.")
    .configureHelp({ commandUsage: () => "kanthord add objective-dependency" })
    .requiredOption(
      "--objective <id>",
      "ID of the objective that must run later",
    )
    .requiredOption(
      "--after <id>",
      "ID of the objective that must be integrated first",
    )
    .addHelpText(
      "after",
      "\nExample:\n  kanthord add objective-dependency --objective objective-3 --after objective-2\n",
    )
    .action(async (opts: { objective: string; after: string }) => {
      emitResult(
        await runAddObjectiveDependency(
          { objective: opts.objective, after: opts.after },
          deps.addObjectiveDependency,
        ),
        io,
      );
    });
}
