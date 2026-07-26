// src/apps/cli/commands/assign/ai-provider.ts — CLI leaf for `assign ai-provider`
// (008.2 Story B: CLI assign verb with --project --provider [--rank]).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runAssignAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildAssignAiProviderCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Assign an AI provider to a project.")
    .configureHelp({ commandUsage: () => "kanthord assign ai-provider" })
    .requiredOption("--project <id>", "ID of the project")
    .requiredOption("--provider <id>", "ID of the AI provider")
    .option("--rank <number>", "Rank position", (val) => parseInt(val, 10))
    .addHelpText(
      "after",
      "\nExample:\n  kanthord assign ai-provider --project proj-1 --provider aip-1 --rank 0\n",
    )
    .action((opts: { project: string; provider: string; rank?: number }) => {
      emitResult(
        runAssignAiProvider(
          {
            project: opts.project,
            provider: opts.provider,
            ...(opts.rank !== undefined ? { rank: opts.rank } : {}),
          },
          deps.assignAiProvider,
        ),
        io,
      );
    });
}
