import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetConflict } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetConflictCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("conflict")
    .description("Show the conflict overview for a task awaiting confirmation.")
    .configureHelp({ commandUsage: () => "kanthord get conflict" })
    .option("--id <id>", "ID of the task to inspect")
    .option("--objective <id>", "ID of the objective to inspect")
    .option("--json", "Emit JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get conflict --id <taskId>\n  kanthord get conflict --objective <objectiveId>\n",
    )
    .action(
      async (opts: { id?: string; objective?: string; json?: boolean }) => {
        emitResult(
          await runGetConflict(
            { id: opts.id, objective: opts.objective, json: opts.json },
            deps.getConflict,
            deps.getObjectiveConflict,
          ),
          io,
        );
      },
    );
}
