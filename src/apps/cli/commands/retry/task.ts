import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRetryTask } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildRetryTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description("Retry a task.")
    .configureHelp({ commandUsage: () => "kanthord retry task" })
    .requiredOption("--id <id>", "ID of the task to retry")
    .option("--note <text>", "guidance note for the retried task")
    .addHelpText(
      "after",
      '\nExample:\n  kanthord retry task --id task-1 --note "merge at anchor"\n',
    )
    .action(async (opts: { id: string; note?: string }) => {
      emitResult(
        await runRetryTask({ id: opts.id, note: opts.note }, deps.retryTask),
        io,
      );
    });
}
