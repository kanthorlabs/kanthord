// src/apps/cli/commands/set-default/ai-provider.ts — CLI leaf for `set-default ai-provider`
// (008.1 Story C: CLI set-default verb with --id).

import { Command } from "commander";

import type { CliDeps } from "../../deps.ts";
import { runSetDefaultAiProvider } from "../../ai-provider.ts";
import { emitResult } from "../action.ts";
import type { CliIo } from "../action.ts";

export function buildSetDefaultAiProviderCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("ai-provider")
    .description("Set the default AI provider.")
    .configureHelp({ commandUsage: () => "kanthord set-default ai-provider" })
    .requiredOption("--id <id>", "ID of the AI provider to set as default")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord set-default ai-provider --id <id>\n",
    )
    .action(async (opts: { id: string }) => {
      emitResult(
        runSetDefaultAiProvider({ id: opts.id }, deps.setDefaultAiProvider),
        io,
      );
    });
}
