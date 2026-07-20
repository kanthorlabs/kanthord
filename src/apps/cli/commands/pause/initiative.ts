import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runPauseInitiative } from "../../initiative.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildPauseInitiativeCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("initiative")
    .description("Pause an initiative.")
    .configureHelp({ commandUsage: () => "kanthord pause initiative" })
    .requiredOption("--id <id>", "ID of the initiative to pause")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord pause initiative --id initiative-1\n",
    )
    .action(async (opts: { id: string }) => {
      emitResult(
        await runPauseInitiative({ id: opts.id }, deps.pauseInitiative),
        io,
      );
    });
}
