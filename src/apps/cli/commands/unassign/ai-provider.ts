// src/apps/cli/commands/unassign/ai-provider.ts — CLI leaf for `unassign ai-provider`
// (008.2 Story B: CLI unassign verb with --project --provider).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runUnassignAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildUnassignAiProviderCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Unassign an AI provider from a project.")
    .configureHelp({ commandUsage: () => "kanthord unassign ai-provider" })
    .requiredOption("--project <id>", "ID of the project")
    .requiredOption("--provider <id>", "ID of the AI provider")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord unassign ai-provider --project proj-1 --provider aip-1\n",
    )
    .action((opts: { project: string; provider: string }) => {
      emitResult(
        runUnassignAiProvider(
          { project: opts.project, provider: opts.provider },
          deps.unassignAiProvider,
        ),
        io,
      );
    });
}
