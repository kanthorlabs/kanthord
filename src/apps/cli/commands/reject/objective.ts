import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRejectObjective } from "../../objective.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRejectObjectiveCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("objective")
    .description("Reject an objective.")
    .configureHelp({ commandUsage: () => "kanthord reject objective" })
    .requiredOption("--id <id>", "ID of the objective to reject")
    .requiredOption(
      "--resolution <resolution>",
      "resolution after rejection: retry or discard",
    )
    .requiredOption(
      "--expected-commit <oid>",
      "the candidate commit OID read from `get objective --json`",
    )
    .option("--reason <reason>", "reason for rejecting the objective")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord reject objective --id objective-1 --resolution discard --expected-commit <oid> --reason 'unachievable'\n",
    )
    .action(
      async (opts: {
        id: string;
        resolution: string;
        reason?: string;
        expectedCommit: string;
      }) => {
        emitResult(
          await runRejectObjective(
            {
              id: opts.id,
              resolution: opts.resolution,
              reason: opts.reason,
              expectedCommit: opts.expectedCommit,
            },
            deps.rejectObjective,
            deps.retryObjective,
          ),
          io,
        );
      },
    );
}
