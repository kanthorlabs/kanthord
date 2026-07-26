import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRemoveInitiativeDependency } from "../../sequencing.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRemoveInitiativeDependencyCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("initiative-dependency")
    .description("Remove a sequencing dependency between initiatives.")
    .configureHelp({
      commandUsage: () => "kanthord remove initiative-dependency",
    })
    .requiredOption(
      "--initiative <id>",
      "ID of the initiative to stop waiting for",
    )
    .requiredOption("--after <id>", "ID of the initiative to stop depending on")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord remove initiative-dependency --initiative initiative-3 --after initiative-2\n",
    )
    .action(async (opts: { initiative: string; after: string }) => {
      emitResult(
        await runRemoveInitiativeDependency(
          { initiative: opts.initiative, after: opts.after },
          deps.removeInitiativeDependency,
        ),
        io,
      );
    });
}
