import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runImportResource } from "../../import.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildImportResourceCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("resource")
    .description("Import resources from a YAML file.")
    .configureHelp({ commandUsage: () => "kanthord import resource" })
    .requiredOption("--path <file>", "YAML file containing resources to import")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord import resource --path resources.yaml\n",
    )
    .action(async (opts: { path: string }) => {
      emitResult(
        await runImportResource({ path: opts.path }, deps.importResources),
        io,
      );
    });
}
