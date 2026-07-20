import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runRepoLand } from "../../repo.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildLandRepositoryCommand(deps: CliDeps, io: CliIo): Command {
  return new Command("repository")
    .description("Land a repository candidate commit.")
    .configureHelp({ commandUsage: () => "kanthord land repository" })
    .requiredOption("--repository <id>", "ID of the repository resource")
    .requiredOption("--workspace <dir>", "workspace containing the candidate")
    .requiredOption("--base <branch>", "target branch to update")
    .requiredOption("--candidate <sha>", "candidate commit SHA to land")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord land repository --repository repository-1 --workspace ./work/repository --base main --candidate abc123\n",
    )
    .action(
      async (opts: {
        repository: string;
        workspace: string;
        base: string;
        candidate: string;
      }) => {
        emitResult(
          await runRepoLand(
            {
              repository: opts.repository,
              workspace: opts.workspace,
              base: opts.base,
              candidate: opts.candidate,
            },
            deps.repoLanding,
            deps.resolveHomeDir,
          ),
          io,
        );
      },
    );
}
