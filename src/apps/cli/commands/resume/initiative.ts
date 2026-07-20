import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runResumeInitiative } from "../../initiative.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildResumeInitiativeCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("initiative")
    .description("Resume an initiative.")
    .configureHelp({ commandUsage: () => "kanthord resume initiative" })
    .requiredOption("--id <id>", "ID of the initiative to resume")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord resume initiative --id initiative-1\n",
    )
    .action(async (opts: { id: string }) => {
      emitResult(
        await runResumeInitiative({ id: opts.id }, deps.resumeInitiative),
        io,
      );
    });
}
