import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetResource } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildGetResourceCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("resource")
    .description("Get a resource.")
    .configureHelp({ commandUsage: () => "kanthord get resource" })
    .requiredOption("--id <id>", "ID of the resource to get")
    .option("--json", "print the resource as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get resource --id resource-1 --json\n",
    )
    .action(async (opts: { id: string; json?: boolean }) => {
      emitResult(
        await runGetResource(
          { id: opts.id, ...(opts.json ? { json: true } : {}) },
          deps.getResource,
        ),
        io,
      );
    });
}
