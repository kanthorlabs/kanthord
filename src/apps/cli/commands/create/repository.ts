import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runCreateRepository } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildCreateRepositoryCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("repository")
    .description("Create a repository resource.")
    .configureHelp({ commandUsage: () => "kanthord create repository" })
    .requiredOption("--project <id>", "project that owns the repository")
    .requiredOption("--name <name>", "name for the repository")
    .requiredOption("--remote-url <url>", "remote repository URL")
    .requiredOption("--branch <branch>", "branch to use")
    .option(
      "--auth <auth>",
      "repository authentication: ambient, https-token, or ssh-agent",
    )
    .option("--credential <id>", "credential for https-token authentication")
    .option("--path <path>", "local checkout path")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord create repository --project project-1 --name api --remote-url https://github.com/acme/api.git --branch main --auth ambient\n",
    )
    .action(
      async (opts: {
        project: string;
        name: string;
        remoteUrl: string;
        branch: string;
        auth?: string;
        credential?: string;
        path?: string;
      }) => {
        emitResult(
          await runCreateRepository(
            {
              project: opts.project,
              name: opts.name,
              "remote-url": opts.remoteUrl,
              branch: opts.branch,
              auth: opts.auth,
              credential: opts.credential,
              path: opts.path,
            },
            deps.addResource,
          ),
          io,
        );
      },
    );
}
