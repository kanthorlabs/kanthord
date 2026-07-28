import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runAbandonTask } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildAbandonTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description(
      "Abandon a running task: revoke its run's lease and requeue it.",
    )
    .configureHelp({ commandUsage: () => "kanthord abandon task" })
    .requiredOption("--id <id>", "ID of the running task to abandon")
    .requiredOption("--reason <reason>", "why the run is being abandoned")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord abandon task --id task-1 --reason 'stuck on a slow tool'\n",
    )
    .action(async (opts: { id: string; reason: string }) => {
      emitResult(
        await runAbandonTask(
          { id: opts.id, reason: opts.reason },
          deps.abandonTask,
        ),
        io,
      );
    });
}
