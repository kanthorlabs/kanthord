import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateFilesystem } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateFilesystemCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("filesystem")
    .description("Create a filesystem resource.")
    .configureHelp({ commandUsage: () => "kanthord create filesystem" })
    .requiredOption("--project <id>", "project that owns the filesystem")
    .requiredOption("--name <name>", "name for the filesystem")
    .requiredOption("--path <path>", "filesystem path")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create filesystem --project project-1 --name workspace --path ./work\n",
    )
    .action(async (opts: { project: string; name: string; path: string }) => {
      emitResult(
        await runCreateFilesystem(
          { project: opts.project, name: opts.name, path: opts.path },
          deps.addResource,
        ),
        io,
      );
    });
}
