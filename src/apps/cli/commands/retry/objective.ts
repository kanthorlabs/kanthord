import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRetryObjective } from "../../objective.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRetryObjectiveCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("objective")
    .description("Retry an objective (re-queue or resolve a conflict).")
    .configureHelp({ commandUsage: () => "kanthord retry objective" })
    .requiredOption("--id <id>", "ID of the objective to retry")
    .option("--note <text>", "guidance note to attach to re-queued tasks")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord retry objective --id objective-1\n",
    )
    .action(async (opts: { id: string; note?: string }) => {
      emitResult(
        await runRetryObjective(
          { id: opts.id, note: opts.note },
          deps.retryObjective,
        ),
        io,
      );
    });
}
