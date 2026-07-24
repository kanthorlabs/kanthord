import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runApproveObjective } from "../../objective.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildApproveObjectiveCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("objective")
    .description("Approve an objective (broker its commit into home).")
    .configureHelp({ commandUsage: () => "kanthord approve objective" })
    .requiredOption("--id <id>", "ID of the objective to approve")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord approve objective --id objective-1\n",
    )
    .action(async (opts: { id: string }) => {
      emitResult(
        await runApproveObjective({ id: opts.id }, deps.approveObjective),
        io,
      );
    });
}
