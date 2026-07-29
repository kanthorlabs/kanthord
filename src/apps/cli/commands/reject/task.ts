import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRejectTask } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRejectTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description("Reject a task.")
    .configureHelp({ commandUsage: () => "kanthord reject task" })
    .requiredOption("--id <id>", "ID of the task to reject")
    .requiredOption(
      "--resolution <resolution>",
      "resolution after rejection: retry or discard",
    )
    .option("--reason <reason>", "reason for rejecting the task")
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
      "\nExample:\n  kanthord reject task --id task-1 --resolution discard --reason 'Needs changes'\n",
    )
    .action(
      async (opts: {
        id: string;
        resolution: string;
        reason?: string;
        dryRun?: boolean;
        yes?: boolean;
        expectImpact?: string;
        json?: boolean;
      }) => {
        emitResult(
          await runRejectTask(
            {
              id: opts.id,
              resolution: opts.resolution,
              reason: opts.reason,
              dryRun: opts.dryRun,
              yes: opts.yes,
              expectImpact: opts.expectImpact,
              json: opts.json,
            },
            deps.rejectTask,
          ),
          io,
        );
      },
    );
}
