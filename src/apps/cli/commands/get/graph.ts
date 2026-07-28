import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetInitiativeGraph } from "../../initiative.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetGraphCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("graph")
    .description("Get an initiative's task graph.")
    .configureHelp({ commandUsage: () => "kanthord get graph" })
    .requiredOption(
      "--initiative <id>",
      "ID of the initiative whose graph to get",
    )
    .option("--json", "print the graph as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get graph --initiative init-1 --json\n",
    )
    .action(async (opts: { initiative: string; json?: boolean }) => {
      emitResult(
        await runGetInitiativeGraph(
          { initiative: opts.initiative, ...(opts.json ? { json: true } : {}) },
          deps.getInitiativeGraph,
        ),
        io,
      );
    });
}
