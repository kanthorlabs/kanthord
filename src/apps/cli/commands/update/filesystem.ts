import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runUpdateFilesystem } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

type UpdateFilesystemDeps = Pick<CliDeps, "updateFilesystem">;

export function buildUpdateFilesystemCommand(
  deps: UpdateFilesystemDeps,
  io: CliIo,
): Command {
  return new Command("filesystem")
    .description("Update a filesystem resource.")
    .configureHelp({ commandUsage: () => "kanthord update filesystem" })
    .requiredOption("--id <id>", "ID of the filesystem resource to update")
    .option("--name <name>", "new name for the filesystem")
    .option("--path <path>", "new filesystem path")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord update filesystem --id filesystem-1 --path ./work\n",
    )
    .action(async (opts: { id: string; name?: string; path?: string }) => {
      emitResult(
        await runUpdateFilesystem(
          { id: opts.id, name: opts.name, path: opts.path },
          deps.updateFilesystem,
        ),
        io,
      );
    });
}
