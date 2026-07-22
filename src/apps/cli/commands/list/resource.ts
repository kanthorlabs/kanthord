import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import type { ResourceType } from "../../resource.ts";
import { runListResources } from "../../resource.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

function buildListResourceCommand(
  name: string,
  type: ResourceType,
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command(name)
    .description(`List ${name} resources in a project.`)
    .configureHelp({ commandUsage: () => `kanthord list ${name}` })
    .requiredOption("--project <id>", "ID of the project to list")
    .option("--json", `print ${name} resources as JSON`)
    .addHelpText(
      "after",
      `\nExample:\n  kanthord list ${name} --project project-1 --json\n`,
    )
    .action((opts: { project: string; json?: boolean }) => {
      emitResult(
        runListResources(
          {
            project: opts.project,
            ...(opts.json ? { json: true } : {}),
          },
          type,
          deps.listResources,
        ),
        io,
      );
    });
}

export function buildListCredentialCommand(deps: CliDeps, io: CliIo): Command {
  return buildListResourceCommand("credential", "credential", deps, io);
}

export function buildListAiProviderCommand(deps: CliDeps, io: CliIo): Command {
  return buildListResourceCommand("ai-provider", "ai_provider", deps, io);
}

export function buildListRepositoryCommand(deps: CliDeps, io: CliIo): Command {
  return buildListResourceCommand("repository", "repository", deps, io);
}
