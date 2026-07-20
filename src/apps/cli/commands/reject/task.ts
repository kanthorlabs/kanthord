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
    .addHelpText(
      "after",
      "\nExample:\n  kanthord reject task --id task-1 --resolution discard --reason 'Needs changes'\n",
    )
    .action(
      async (opts: { id: string; resolution: string; reason?: string }) => {
        emitResult(
          await runRejectTask(
            { id: opts.id, resolution: opts.resolution, reason: opts.reason },
            deps.rejectTask,
          ),
          io,
        );
      },
    );
}
