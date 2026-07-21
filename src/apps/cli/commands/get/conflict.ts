import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetConflict } from "../../task.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetConflictCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("conflict")
    .description("Show the conflict overview for a task awaiting confirmation.")
    .configureHelp({ commandUsage: () => "kanthord get conflict" })
    .requiredOption("--id <id>", "ID of the task to inspect")
    .addHelpText("after", "\nExample:\n  kanthord get conflict --id <taskId>\n")
    .action(async (opts: { id: string }) => {
      emitResult(await runGetConflict({ id: opts.id }, deps.getConflict), io);
    });
}
