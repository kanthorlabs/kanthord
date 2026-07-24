import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runGetResource } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

// Convenience alias for `get resource` — mirrors the `create/publish/land
// repository` noun so a repository can be read back by the same noun.
export function buildGetRepositoryCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("repository")
    .description("Get a repository (alias for `get resource`).")
    .configureHelp({ commandUsage: () => "kanthord get repository" })
    .requiredOption("--id <id>", "ID of the repository to get")
    .option("--json", "print the repository as JSON")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord get repository --id repository-1 --json\n",
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
