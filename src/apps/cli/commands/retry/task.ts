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
    .addHelpText("after", "\nExample:\n  kanthord retry task --id task-1\n")
    .action(async (opts: { id: string }) => {
      emitResult(await runRetryTask({ id: opts.id }, deps.retryTask), io);
    });
}
