import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runAddInitiativeDependency } from "../../sequencing.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildAddInitiativeDependencyCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("initiative-dependency")
    .description("Sequence one initiative after another.")
    .configureHelp({ commandUsage: () => "kanthord add initiative-dependency" })
    .requiredOption(
      "--initiative <id>",
      "ID of the initiative that must run later",
    )
    .requiredOption("--after <id>", "ID of the initiative that must land first")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord add initiative-dependency --initiative initiative-3 --after initiative-2\n",
    )
    .action(async (opts: { initiative: string; after: string }) => {
      emitResult(
        await runAddInitiativeDependency(
          { initiative: opts.initiative, after: opts.after },
          deps.addInitiativeDependency,
        ),
        io,
      );
    });
}
