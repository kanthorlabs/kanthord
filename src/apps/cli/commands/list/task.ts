import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runListTasks } from "../../list-tasks.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildListTaskCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("task")
    .description("List tasks in an initiative.")
    .configureHelp({ commandUsage: () => "kanthord list task" })
    .requiredOption("--initiative <id>", "ID of the initiative to list")
    .option("--objective <id>", "limit tasks to an objective")
    .option("--status <status>", "limit tasks to a status")
    .option("--json", "print tasks as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord list task --initiative initiative-1 --json\n",
    )
    .action(
      async (opts: {
        initiative: string;
        objective?: string;
        status?: string;
        json?: boolean;
      }) => {
        emitResult(
          await runListTasks(
            {
              initiative: opts.initiative,
              ...(opts.objective ? { objective: opts.objective } : {}),
              ...(opts.status ? { status: opts.status } : {}),
              ...(opts.json ? { json: true } : {}),
            },
            deps.listTasks,
          ),
          io,
        );
      },
    );
}
