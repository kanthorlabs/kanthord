import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runUpdateRepository } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

type UpdateRepositoryDeps = Pick<CliDeps, "updateRepository">;

export function buildUpdateRepositoryCommand(
  deps: UpdateRepositoryDeps,
  io: CliIo,
): Command {
  return new Command("repository")
    .description("Update a repository resource.")
    .configureHelp({ commandUsage: () => "kanthord update repository" })
    .requiredOption("--id <id>", "ID of the repository resource to update")
    .option("--name <name>", "new name for the repository")
    .option("--branch <branch>", "new branch to use")
    .option("--remote-url <url>", "new remote repository URL")
    .option("--reclone", "reclone the repository after updating it")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord update repository --id repository-1 --branch main --remote-url https://github.com/acme/api.git --reclone\n",
    )
    .action(
      async (opts: {
        id: string;
        name?: string;
        branch?: string;
        remoteUrl?: string;
        reclone?: boolean;
      }) => {
        emitResult(
          await runUpdateRepository(
            {
              id: opts.id,
              name: opts.name,
              branch: opts.branch,
              "remote-url": opts.remoteUrl,
              reclone: opts.reclone,
            },
            deps.updateRepository,
          ),
          io,
        );
      },
    );
}
