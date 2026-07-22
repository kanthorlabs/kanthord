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
    .option(
      "--rebuild",
      "explicitly rebuild a stale (pending) candidate from awaiting_confirmation",
    )
    .addHelpText(
      "after",
      '\nExample:\n  kanthord retry task --id task-1 --note "merge at anchor"\n',
    )
    .action(async (opts: { id: string; note?: string; rebuild?: boolean }) => {
      emitResult(
        await runRetryTask(
          { id: opts.id, note: opts.note, rebuild: opts.rebuild },
          deps.retryTask,
        ),
        io,
      );
    });
}
