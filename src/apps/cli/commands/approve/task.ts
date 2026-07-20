import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runApproveTask } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildApproveTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description("Approve a task.")
    .configureHelp({ commandUsage: () => "kanthord approve task" })
    .requiredOption("--id <id>", "ID of the task to approve")
    .addHelpText("after", "\nExample:\n  kanthord approve task --id task-1\n")
    .action(async (opts: { id: string }) => {
      emitResult(await runApproveTask({ id: opts.id }, deps.approveTask), io);
    });
}
