import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetTask } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description("Get a task.")
    .configureHelp({ commandUsage: () => "kanthord get task" })
    .requiredOption("--id <id>", "ID of the task to get")
    .option("--json", "print the task as JSON")
    .option("--result", "print the task result")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get task --id task-1 --json\n",
    )
    .action(async (opts: { id: string; json?: boolean; result?: boolean }) => {
      emitResult(
        await runGetTask(
          {
            id: opts.id,
            ...(opts.json ? { json: true } : {}),
            ...(opts.result ? { result: true } : {}),
          },
          deps.getTask,
        ),
        io,
      );
    });
}
