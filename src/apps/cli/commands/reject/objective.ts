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
    .option("--dry-run", "print the damage and exit without writing")
    .option(
      "--yes",
      "skip the confirmation prompt; the damage is still printed",
    )
    .option(
      "--expect-impact <digest>",
      "impact digest from a previous --dry-run",
    )
    .option("--json", "print the damage report as JSON")
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
        dryRun?: boolean;
        yes?: boolean;
        expectImpact?: string;
        json?: boolean;
      }) => {
        emitResult(
          await runRejectObjective(
            {
              id: opts.id,
              resolution: opts.resolution,
              reason: opts.reason,
              expectedCommit: opts.expectedCommit,
              dryRun: opts.dryRun,
              yes: opts.yes,
              expectImpact: opts.expectImpact,
              json: opts.json,
            },
            deps.rejectObjective,
            deps.retryObjective,
          ),
          io,
        );
      },
    );
}
